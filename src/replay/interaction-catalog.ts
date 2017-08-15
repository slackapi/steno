import Debug = require('debug');
import { EventEmitter } from 'events';
import { Request } from 'express';
import fs = require('fs');
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { basename, resolve as resolvePath } from 'path';
import getRawBody = require('raw-body');
import { RequestInfo, ResponseInfo } from 'steno';
import { promisify } from 'util';
import uuid = require('uuid/v4');

const log = Debug('steno:interaction-catalog');

const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);

export interface Interaction {
  request: RequestInfo;
  response: ResponseInfo;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}

function parseRequestData(requestData: string): RequestInfo {
  const [firstLine, ...lines] = requestData.split('\n');
  const [method, url, httpData] = firstLine.split(' ');
  let [_, httpVersion] = httpData.split('/'); // tslint:disable-line prefer-const
  if (!httpVersion) { httpVersion = '1.1'; }

  const emptyLineIndex = lines.indexOf('');
  if (emptyLineIndex === -1) {
    throw new Error('Invalid request data');
  }
  const headerLines = lines.slice(0, emptyLineIndex);
  const headers = headerLines.reduce((h, line) => {
    const [key, valData] = line.split(': ');
    const val = valData.indexOf(', ') === -1 ? valData : valData.split(', ');
    h[key] = val;
    return h;
  }, ({} as IncomingHttpHeaders));

  let body;
  if (emptyLineIndex < lines.length) {
    const bodyData = lines[emptyLineIndex + 1];
    body = JSON.parse(bodyData);
  }

  return {
    body: Buffer.from(body),
    headers,
    httpVersion,
    id: uuid(),
    method,
    // TODO: trailers?
    trailers: undefined,
    url,
  };
}

function parseResponseData(responseData: string, requestId: string): ResponseInfo {
  log(`response data: ${responseData}`);
  const [_, __, firstLine, ...lines] = responseData.split('\n');
  const firstLineMatch = /^HTTP\/([\w.]+) (\d+) ([\w ]+)$/ig.exec(firstLine);
  if (!firstLineMatch) {
    log(`first line: ${firstLine}`);
    throw Error('Invalid response data: first line does not match format');
  }
  const [___, httpVersion, statusCodeData, statusMessage] = firstLineMatch;
  const statusCode = parseInt(statusCodeData, 10);

  const emptyLineIndex = lines.indexOf('');
  if (emptyLineIndex === -1) {
    throw new Error('Invalid response data: cannot find end of headers');
  }
  const headerLines = lines.slice(0, emptyLineIndex);
  const headers = headerLines.reduce((h, line) => {
    const [key, valData] = line.split(': ');
    const val = valData.indexOf(', ') === -1 ? valData : valData.split(', ');
    h[key] = val;
    return h;
  }, ({} as IncomingHttpHeaders));

  let body;
  if (emptyLineIndex < lines.length) {
    const bodyData = lines[emptyLineIndex + 1];
    body = JSON.parse(bodyData);
  }

  // HACK: removing content-encoding so that we don't need to deflate or gzip the body before transporting
  if (headers['content-encoding']) {
    delete headers['content-encoding'];
    delete headers['content-length'];
  }

  return {
    body: Buffer.from(body),
    headers,
    httpVersion,
    requestId,
    statusCode,
    statusMessage,
    // TODO: trailers?
    trailers: undefined,
  };
}

function parseFile(filename: string): Promise<Interaction | undefined> {
  const [timestampStr, direction] = basename(filename).split('_');
  const timestamp = parseInt(timestampStr, 10);
  return readFile(filename, 'utf-8')
    .then((fileContents): Promise<Interaction | undefined> => {
      // TODO: shared constants between here and serializer?
      const [requestData, responseData] = fileContents.split('-----');
      // NOTE: why won't typescript acknowledge the fact that any of the destructured values could be undefined?
      if (!requestData || !responseData) {
        log(`cannot parse interaction from ${filename}`);
        // skip
        return Promise.resolve(undefined);
      }

      const requestInfo = parseRequestData(requestData);
      const responseInfo = parseResponseData(responseData, requestInfo.id);

      return Promise.resolve({
        direction: (direction as 'incoming' | 'outgoing'),
        request: requestInfo,
        response: responseInfo,
        timestamp,
      });
    });
}

// TODO: populate the ignored headers
const ignoredHeaders = ['host'];
function matchHeaders(pattern: IncomingHttpHeaders, actual: IncomingHttpHeaders): boolean {
  for (const key in pattern) {
    if (pattern.hasOwnProperty(key)) {
      if (ignoredHeaders.includes(key)) { continue; }
      if (!actual[key]) { return false; }
      let patternValue = pattern[key];
      let actualValue = actual[key];
      if (key === 'set-cookie' && !Array.isArray(patternValue)) {
        patternValue = [patternValue];
      }
      if (Array.isArray(patternValue) && !Array.isArray(actualValue)) {
        if (actualValue.indexOf(', ') === -1) { return false; }
        actualValue = actualValue.split(', ');
        const matches = patternValue.every((pv) => actualValue.includes(pv));
        if (!matches) { return false; }
      }
    }
  }
  return true;
}

export class InteractionCatalog extends EventEmitter {
  public interactionHistory: Interaction[];
  public interactions: Interaction[];
  public previouslyMatched: Set<string>;
  private storagePath: string;

  constructor(storagePath: string) {
    super();
    this.storagePath = storagePath;
    this.previouslyMatched = new Set();
    this.interactionHistory = [];
  }

  public loadPath(newStoragePath?: string): Promise<void> {
    if (newStoragePath) {
      this.storagePath = newStoragePath;
    }
    return readDir(this.storagePath)
      .then((filenames) => {
        return Promise.all(filenames.map((f) => parseFile(resolvePath(this.storagePath, f))));
      })
      .then((interactionsAndSkipped) => interactionsAndSkipped.filter((i) => !!i))
      .then((interactions) => {
        log('interactions loaded from path');
        this.interactions = interactions as Interaction[];
        this.previouslyMatched = new Set();
        this.interactionHistory = [];
        this.checkTriggers();
      })
      .then(() => {}); // tslint:disable-line no-empty
  }

  // NOTE: this method is a bit overloaded. it not only finds the matching interaction,
  // but it also adds to the previouslyMatched set and puts the incoming request in the
  // interaction history. at this moment, this is all an atomic operation so it seems okay,
  // but it could be split up
  public findMatchingInteraction(req: Request): Interaction | undefined {
    const match = this.interactions
      .filter((interaction) => !this.previouslyMatched.has(interaction.request.id))
      .filter((interaction) => {
        log('testing request properties');
        if (interaction.direction !== 'outgoing') {
          log('interaction eliminated: not outgoing');
          return false;
        }
        const requestInfo = interaction.request;
        if (requestInfo.method !== req.method) {
          log('interaction eliminated: method');
          return false;
        }
        // ideas for more complex URL matching:
        // *  allow regexp
        // *  allow query params in any order
        if (requestInfo.url !== req.originalUrl) {
          log('interaction eliminated: url');
          return false;
        }
        if (!matchHeaders(requestInfo.headers, req.headers)) {
          log('interaction eliminated: headers');
          return false;
        }
        if (requestInfo.body) {
          if (Buffer.compare(requestInfo.body, req.body) !== 0) {
            log('interaction eliminated: body');
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .shift();
    if (match) {
      this.previouslyMatched.add(match.request.id);
      this.interactionHistory.push({
        direction: match.direction,
        request: {
          body: (req.body as Buffer),
          headers: req.headers,
          httpVersion: req.httpVersion,
          id: match.request.id,
          method: req.method,
          trailers: undefined,
          url: req.originalUrl,
        },
        response: match.response,
        timestamp: Date.now(),
      });
      this.checkTriggers();
    }
    return match;
  }

  public onIncomingResponse(interaction: Interaction, res: IncomingMessage) {
    getRawBody(res)
      .then((body) => {
        this.interactionHistory.push({
          direction: 'outgoing',
          request: interaction.request,
          response: {
            body,
            headers: res.headers,
            httpVersion: res.httpVersion,
            requestId: interaction.request.id,
            statusCode: res.statusCode as number,
            statusMessage: res.statusMessage as string,
            trailers: undefined,
          },
          timestamp: Date.now(),
        });
      })
      .catch((error) => {
        log(`An error occurred while reading the incoming request's response body: ${error.message}`);
      });
  }

  // this is kind of ugly because we previously made the assumption that previouslyMatched and
  // interactionHistory were updated atomically, and now we've split that across two methods
  private checkTriggers() {
    log('check triggers');
    const sortedInteractions = this.interactions.slice().sort((a, b) => b.timestamp - a.timestamp);
    this.interactions
      .filter((interaction) => !this.previouslyMatched.has(interaction.request.id))
      .filter((interaction) => interaction.direction === 'incoming')
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((unmatched) => {
        return sortedInteractions
          .filter((interaction) => interaction.timestamp < unmatched.timestamp)
          .every((pi) => this.previouslyMatched.has(pi.request.id));
      })
      .forEach((i) => {
        this.previouslyMatched.add(i.request.id);
        this.emit('clientReqTrigger', i);
      });
  }
}
