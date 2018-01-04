import debug = require('debug');
import { EventEmitter } from 'events';
import { Request } from 'express';
import fs = require('fs');
import { IncomingMessage } from 'http';
import isUndefined = require('lodash.isundefined'); // tslint:disable-line import-name
import isObject = require('lodash.isobject'); // tslint:disable-line import-name
import isEmpty = require('lodash.isempty'); // tslint:disable-line import-name
import { basename, resolve as resolvePath } from 'path';
import getRawBody = require('raw-body'); // tslint:disable-line import-name
import { RequestInfo, ResponseInfo, NotOptionalIncomingHttpHeaders } from 'steno';
import { promisify } from 'util';
import uuid = require('uuid/v4'); // tslint:disable-line import-name

const log = debug('steno:interaction-catalog');

const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);

export interface Interaction {
  request: RequestInfo;
  response: ResponseInfo;
  direction: 'incoming' | 'outgoing';
  timestamp?: number; // useful for ordering in the scenario as recorded
  requestTimestamp?: number; // useful for history
  responseTimestamp?: number; // useful for history
}

function parseRequestData(requestData: string): RequestInfo {
  const [firstLine, ...lines] = requestData.split('\n');
  const [method, url, httpData] = firstLine.split(' ');
  let [, httpVersion] = httpData.split('/'); // tslint:disable-line prefer-const
  if (httpVersion === '' || isUndefined(httpVersion)) { httpVersion = '1.1'; }

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
  }, ({} as NotOptionalIncomingHttpHeaders));

  let body;
  if (emptyLineIndex < lines.length) {
    const bodyData = lines[emptyLineIndex + 1];
    body = JSON.parse(bodyData);
  }

  return {
    headers,
    httpVersion,
    method,
    url,
    body: Buffer.from(body),
    id: uuid(),
    // TODO: trailers?
    trailers: undefined,
  };
}

function parseResponseData(responseData: string, requestId: string): ResponseInfo {
  log(`response data: ${responseData}`);
  const [, , firstLine, ...lines] = responseData.split('\n');
  const firstLineMatch = /^HTTP\/([\w.]+) (\d+) ([\w ]+)$/ig.exec(firstLine);
  if (firstLineMatch === null) {
    log(`first line: ${firstLine}`);
    throw Error('Invalid response data: first line does not match format');
  }
  const [, httpVersion, statusCodeData, statusMessage] = firstLineMatch;
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
  }, ({} as NotOptionalIncomingHttpHeaders));

  let body;
  if (emptyLineIndex < lines.length) {
    const bodyData = lines[emptyLineIndex + 1];
    body = JSON.parse(bodyData);
  }

  // HACK: removing content-encoding so that we don't need to deflate or gzip the body before
  // transporting
  if (headers.propertyIsEnumerable('content-encoding')) {
    delete headers['content-encoding'];
    delete headers['content-length'];
  }

  return {
    headers,
    httpVersion,
    requestId,
    statusCode,
    statusMessage,
    // TODO: trailers?
    body: Buffer.from(body),
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
      // NOTE: why won't typescript acknowledge the fact that any of the destructured values could
      // be undefined?
      if (isUndefined(requestData) || isUndefined(responseData)) {
        log(`cannot parse interaction from ${filename}`);
        // skip
        return Promise.resolve(undefined);
      }

      const requestInfo = parseRequestData(requestData);
      const responseInfo = parseResponseData(responseData, requestInfo.id);

      return Promise.resolve({
        timestamp,
        direction: (direction as 'incoming' | 'outgoing'),
        request: requestInfo,
        response: responseInfo,
      });
    });
}

// TODO: populate the ignored headers
const ignoredHeaders = ['host'];
function matchHeaders(pattern: NotOptionalIncomingHttpHeaders,
                      actual: NotOptionalIncomingHttpHeaders): boolean {
  for (const key in pattern) {
    if (pattern.hasOwnProperty(key)) {
      if (ignoredHeaders.includes(key)) { continue; }
      if (!actual.propertyIsEnumerable(key)) { return false; }
      let patternValue = pattern[key];
      let actualValue = actual[key];
      if (key === 'set-cookie' && !Array.isArray(patternValue)) {
        patternValue = [patternValue];
      }
      if (Array.isArray(patternValue) && !Array.isArray(actualValue)) {
        if (actualValue.indexOf(', ') === -1) { return false; }
        actualValue = actualValue.split(', ');
        const matches = patternValue.every(pv => actualValue.includes(pv));
        if (!matches) { return false; }
      }
      // TODO: what if patternValue and actualValue are both single values (not array) and notequal?
    }
  }
  return true;
}

export class InteractionCatalog extends EventEmitter {
  public interactionHistory: Interaction[];
  public interactions: Interaction[];
  public previouslyMatched: Set<string>;
  public storagePath?: string;

  constructor(storagePath: string) {
    super();
    this.reset();
    this.storagePath = storagePath;
  }

  public loadPath(storagePath: string): Promise<void> {
    this.storagePath = storagePath;
    return this.load();
  }

  public load(): Promise<void> {
    if (this.storagePath === undefined) {
      return Promise.reject(new Error('No storage path set'));
    }
    return readDir(this.storagePath)
      .catch((error) => {
        // if the scenario dir is missing, just continue as if its an empty scenario
        if (error.code === 'ENOENT') {
          const noPathError: Error & { code?: string } =
            new Error(`Path not found: ${this.storagePath}`);
          noPathError.code = 'ECATALOGNOPATH';
          throw noPathError;
        }
        // undo the initialization to signal that this catalog is not in a "loaded" state
        this.storagePath = '';
        throw error;
      })
      .then((filenames) => {
        return Promise.all(filenames.map(f => parseFile(resolvePath(this.storagePath, f))));
      })
      .then(interactionsAndSkipped => interactionsAndSkipped.filter(i => !isUndefined(i)))
      .then((interactions) => {
        log(`interactions loaded from path: ${interactions.length}`);
        this.interactions = interactions as Interaction[];
        this.previouslyMatched = new Set();
        this.interactionHistory = [];
        this.checkTriggers();
      })
      .then(() => {}); // tslint:disable-line no-empty
  }

  public reset() {
    this.interactions = [];
    this.storagePath = '';
    this.previouslyMatched = new Set();
    this.interactionHistory = [];
  }

  // NOTE: this method is a bit overloaded. it not only finds the matching interaction,
  // but it also adds to the previouslyMatched set and puts the incoming request in the
  // interaction history. at this moment, this is all an atomic operation so it seems okay,
  // but it could be split up
  public findMatchingInteraction(req: Request): Interaction | undefined {
    const match = this.interactions
      .filter(interaction => !this.previouslyMatched.has(interaction.request.id))
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
        if (!matchHeaders(requestInfo.headers, (req.headers as NotOptionalIncomingHttpHeaders))) {
          log('interaction eliminated: headers');
          return false;
        }
        if (!isUndefined(requestInfo.body)) {
          // raw body-parser will assign body to `{}` when there is none (such as GET requests)
          const body = (isObject(req.body) && isEmpty(req.body)) ? Buffer.from('') : req.body;
          if (Buffer.compare(requestInfo.body, body) !== 0) {
            log('interaction eliminated: body');
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
      .shift();
    if (!isUndefined(match)) {
      this.previouslyMatched.add(match.request.id);
      this.interactionHistory.push({
        direction: match.direction,
        request: {
          body: (req.body as Buffer),
          headers: (req.headers as NotOptionalIncomingHttpHeaders),
          httpVersion: req.httpVersion,
          id: match.request.id,
          method: req.method,
          trailers: undefined,
          url: req.originalUrl,
        },
        requestTimestamp: Date.now(),
        response: match.response,
      });
      this.checkTriggers();
    }
    return match;
  }

  // called when an incoming request (one sent to the App) gets a response - the body isn't yet
  // complete
  // TODO: figure out if the response actually matched what it said in the interaction
  public onIncomingResponse(interaction: Interaction, reqTimestamp: number, res: IncomingMessage) {
    getRawBody(res)
      .then((body) => {
        this.interactionHistory.push({
          direction: 'outgoing',
          request: interaction.request,
          requestTimestamp: reqTimestamp,
          response: {
            body,
            headers: (res.headers as NotOptionalIncomingHttpHeaders),
            httpVersion: res.httpVersion,
            requestId: interaction.request.id,
            statusCode: res.statusCode as number,
            statusMessage: res.statusMessage as string,
            trailers: undefined,
          },
          responseTimestamp: Date.now(),
        });
      })
      .catch((error) => {
        log('An error occurred while reading the incoming request\'s response body: ' +
          `${error.message}`);
      });
  }

  // called when an outgoing request (one set to steno) is finished writing the response
  public onOutgoingResponse(requestId: string) {
    const interaction = this.interactionHistory.find(i => i.request.id === requestId);
    if (!isUndefined(interaction)) {
      interaction.responseTimestamp = Date.now();
    } else {
      log('could not find request in history when capturing outgoing request\'s' +
        ' response timestamp');
    }
  }

  // this is kind of ugly because we previously made the assumption that previouslyMatched and
  // interactionHistory were updated atomically, and now we've split that across two methods
  private checkTriggers() {
    log('check triggers');
    const sortedInteractions = this.interactions.slice()
      .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
    this.interactions
      .filter(interaction => !this.previouslyMatched.has(interaction.request.id))
      .filter(interaction => interaction.direction === 'incoming')
      .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
      .filter((unmatched) => {
        return sortedInteractions
          .filter((interaction) => {
            return (interaction.timestamp as number) < (unmatched.timestamp as number);
          })
          .every(pi => pi.direction === 'incoming' || this.previouslyMatched.has(pi.request.id));
      })
      .forEach((i) => {
        this.previouslyMatched.add(i.request.id);
        this.emit('clientReqTrigger', i);
      });
  }
}
