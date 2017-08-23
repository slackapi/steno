import Debug = require('debug');
import { createWriteStream, open as fileOpen, WriteStream } from 'fs';
import { IncomingHttpHeaders } from 'http';
import mkdirp = require('mkdirp');
import { join as pathJoin } from 'path';
import { RequestInfo, ResponseInfo } from 'steno';
import { promisify } from 'util';
import { responseBodyToString } from '../common';

const createDirectory = promisify(mkdirp);

// TODO: add timestamps
// TODO: adhere to the vcr cassette file format w/ two changes: 1) timestamps as numbers 2) captures incoming/outgoing

interface Destination {
  filename: string; // an absolute path to the file where the request/response pair is stored
  writeStream: WriteStream;
}

const log = Debug('steno:http-serializer');

function serializeHeaders(headers: IncomingHttpHeaders): string {
  return Object.getOwnPropertyNames(headers).reduce((str, key) => {
    const val = headers[key];
    return `${ str ? str + '\n' : ''}${key}: ${val}`;
  }, '');
}

function getFilenameAndOpen(baseFilename: string): Promise<{ filename: string, fd: number }> {
  return new Promise((resolve, reject) => {
    const next = (attempt: number) => {
      const filename = attempt > 0 ? `${baseFilename}_${attempt}` : baseFilename;
      fileOpen(filename, 'wx', (error, fd) => {
        if (error) {
          if (error.code !== 'EEXIST')  {
            reject(error);
          } else {
            next(attempt + 1);
          }
        } else {
          resolve({ filename, fd });
        }
      });
    };
    next(0);
  });
}

function createDestination(baseFilename: string): Promise<Destination> {
  return getFilenameAndOpen(baseFilename)
    .then(({ filename, fd }) => {
      const writeStream = createWriteStream('', { fd });
      writeStream.on('error', (error) => {
        log(`write stream error for file ${filename}: ${error.message}`);
      });
      return {
        filename,
        writeStream,
      };
    });
}

export class HttpSerializer {
  // storagePath is an absolute path
  public storagePath: string;
  // pendingRequestDestinations has keys which are request IDs
  public pendingRequestDestinations: Map<string, Destination>;

  // NOTE: might want to implement a task queue in order to keep track of operations
  constructor(storagePath: string) {
    this.storagePath = storagePath;
    log(`storage path: ${this.storagePath}`);
    this.pendingRequestDestinations = new Map();
  }

  public initialize(): Promise<void> {
    return createDirectory(this.storagePath).then(() => {}); // tslint:disable-line no-empty
  }

  public setStoragePath(storagePath: string): Promise<void> {
    this.storagePath = storagePath;
    return this.initialize();
  }

  public onRequest = (requestInfo: RequestInfo, prefix = '') => {
    log('on request');

    const data = this.generateRequestData(requestInfo);
    const baseFilename = this.generateFilename(requestInfo, prefix);
    createDestination(baseFilename)
      .then((destination: Destination) => {
        this.pendingRequestDestinations.set(requestInfo.id, destination);
        destination.writeStream.write(data, (error: Error | undefined) => {
          if (error) {
            log(`write chunk error for file ${destination.filename}: ${error.message}`);
          }
        });
        // TODO: set a timer and close the stream if there's no response in that time
      });
  }

  public onResponse = (responseInfo: ResponseInfo) => {
    log('on response');
    const data = this.generateResponseData(responseInfo);
    const destination = this.pendingRequestDestinations.get(responseInfo.requestId);
    if (destination) {
      destination.writeStream.end(data, () => {
        this.pendingRequestDestinations.delete(responseInfo.requestId);
      });
    } else {
      // TODO: the response may be ready before the request. set up a queue?
      log(`could not find destination for response with request id ${responseInfo.requestId}`);
    }
  }

  private generateFilename(requestInfo: RequestInfo, prefix = '') {
    return pathJoin(
      this.storagePath,
      `${prefix ? `${prefix}_` : ''}${requestInfo.url.slice(1).replace(/\//g, '_')}_${requestInfo.method}`,
    );
  }

  private generateRequestData(requestInfo: RequestInfo) {
    return (
      `${requestInfo.method} ${requestInfo.url} HTTP/${requestInfo.httpVersion}\n` +
      serializeHeaders(requestInfo.headers) +
      '\n\n' +
      // TODO: handle binary content-types. as is, this will turn the decode the binary data as a utf-8 string and then
      // attempt to encode it as a JavaScript string
      (requestInfo.body ? `${JSON.stringify((requestInfo.body as Buffer).toString())}\n\n` : '') +
      '-----\n\n'
    );
  }

  private generateResponseData(responseInfo: ResponseInfo) {
    return (
      `HTTP/${responseInfo.httpVersion} ${responseInfo.statusCode} ${responseInfo.statusMessage}\n` +
      serializeHeaders(responseInfo.headers) +
      '\n\n' +
      (JSON.stringify(responseBodyToString(responseInfo)) || '') +
      '\n'
    );
  }
}
