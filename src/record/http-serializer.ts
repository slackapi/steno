import debug from 'debug';
import { createWriteStream, open as fsOpen, WriteStream } from 'fs';
import { IncomingHttpHeaders } from 'http';
import mkdirp from 'mkdirp';
import { join as pathJoin } from 'path';
import { RequestInfo, ResponseInfo, responseBodyToString, StenoHook, SerializerRawRequest } from '../steno';
import { promisify } from 'util';

const createDirectory = promisify(mkdirp);
const fileOpen = promisify(fsOpen);

// TODO: add timestamps
// TODO: adhere to the vcr cassette file format w/ two changes: 1) timestamps as numbers 2)
// captures incoming/outgoing

interface Destination {
  filename: string; // an absolute path to the file where the request/response pair is stored
  writeStream: WriteStream;
}

const log = debug('steno:http-serializer');

/**
 * Transforms HTTP request or response headers into a newline separated string
 * @param headers
 */
function serializeHeaders(headers: IncomingHttpHeaders): string {
  return Object.getOwnPropertyNames(headers).reduce((str, key) => {
    const val = headers[key];
    return `${ str.length !== 0 ? str + '\n' : ''}${key}: ${val}`;
  }, '');
}

/**
 * Opens a new file for writing to disk given a base filename. This actual filename may require
 * adding variation since the base filename is not garaunteed to be unique.
 *
 * @param baseFilename an absolute path (may or may not already exist)
 * @returns promise which resolves to a record of the resulting filename and fd (file descriptor)
 */
async function getFilenameAndOpen(baseFilename: string): Promise<{ filename: string, fd: number }> {
  const next = async (attempt: number): Promise<{ filename: string, fd: number }> => {
    const filename = attempt > 0 ? `${baseFilename}_${attempt}` : baseFilename;
    try {
      const fd = await fileOpen(filename, 'wx');
      return { filename, fd };
    } catch (error) {
      if (error.code === 'EEXIST') {
        return next(attempt + 1);
      }
      throw error;
    }
  };
  return next(0);
}

/**
 * Creates a new file on disk from a base filename as a Destination record which contains a filename
 * (not previously used) and a corresponding writable stream.
 *
 * @param baseFilename an abolsute path (may or may not already exist)
 * @returns promise which resolves to a new Destination
 */
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

/**
 * A serializer which writes HTTP request/response pair information to disk within a storage path
 */
export class HttpSerializer {
  /** an absolute path to a parent directory for all serialized request/response pairs */
  public storagePath: string;
  /** a map of destinations for requests that are pending a response (keys are request IDs) */
  public pendingRequestDestinations: Map<string, Destination>;
  private transformRawRequestBodyHook?: SerializerRawRequest;

  // NOTE: might want to implement a task queue in order to keep track of operations
  // TODO: more specific type for hooks
  constructor(storagePath: string, hooks: StenoHook[]) {
    this.storagePath = storagePath;
    this.transformRawRequestBodyHook = hooks.find((hook) => {
      return hook.hookType === 'serializerRawRequest';
    }) as SerializerRawRequest;
    this.pendingRequestDestinations = new Map();
    log(`storage path: ${this.storagePath}`);
  }

  /**
   * Prepares the serializer to be used.
   * @returns promise which fulfills when the serializer is ready
   */
  public initialize(): Promise<void> {
    return createDirectory(this.storagePath).then(() => {}); // tslint:disable-line no-empty
  }

  /**
   * Sets a new parent location for all serialized requests.
   * @param storagePath
   * @returns promise which fulfills after the storage path is set and the serializer is ready
   */
  public setStoragePath(storagePath: string): Promise<void> {
    this.storagePath = storagePath;
    return this.initialize();
  }

  /**
   * Serializes request
   *
   * @param requestInfo
   * @param prefix an optional file prefix
   */
  public onRequest(requestInfo: RequestInfo, prefix = ''): void {
    log('on request');

    if (this.transformRawRequestBodyHook !== undefined) {
      // tslint:disable-next-line no-parameter-reassignment
      requestInfo = this.transformRawRequestBodyHook.processor(requestInfo);
    }

    const data = this.generateRequestData(requestInfo);
    const baseFilename = this.generateFilename(requestInfo, prefix);
    createDestination(baseFilename)
      .then((destination: Destination) => {
        this.pendingRequestDestinations.set(requestInfo.id, destination);
        destination.writeStream.write(data, (error: Error | undefined) => {
          if (error !== undefined) {
            log(`write chunk error for file ${destination.filename}: ${error.message}`);
          }
        });
        // TODO: set a timer and close the stream if there's no response in that time
      });
  }

  /**
   * Serializes response
   *
   * @param responseInfo
   */
  public onResponse(responseInfo: ResponseInfo): void {
    log('on response');
    const data = this.generateResponseData(responseInfo);
    const destination = this.pendingRequestDestinations.get(responseInfo.requestId);
    if (destination !== undefined) {
      destination.writeStream.end(data, () => {
        this.pendingRequestDestinations.delete(responseInfo.requestId);
      });
    } else {
      // TODO: the response may be ready before the request. set up a queue?
      log(`could not find destination for response with request id ${responseInfo.requestId}`);
    }
  }

  /**
   * Generates a filename from request information and an optional prefix.
   *
   * @param requestInfo
   * @param prefix
   * @returns absolute filename
   */
  private generateFilename(requestInfo: RequestInfo, prefix = ''): string {
    return pathJoin(
      this.storagePath,
      `${prefix.length > 0 ? `${prefix}_` : ''}` +
      `${requestInfo.url.slice(1).replace(/\//g, '_')}_${requestInfo.method}`,
    );
  }

  /**
   * Serializes a request into a string
   *
   * @param requestInfo
   * @returns request as a string
   */
  private generateRequestData(requestInfo: RequestInfo): string {
    return (
      `${requestInfo.method} ${requestInfo.url} HTTP/${requestInfo.httpVersion}\n` +
      serializeHeaders(requestInfo.headers) +
      '\n\n' +
      // TODO: handle binary content-types. as is, this will turn the decode the binary data as a
      // utf-8 string and then attempt to encode it as a JavaScript string
      (requestInfo.body !== undefined ?
        `${JSON.stringify((requestInfo.body as Buffer).toString())}\n\n` :
        ''
      ) +
      '-----\n\n'
    );
  }

  /**
   * Serializes a response into a string
   *
   * @param responseInfo
   * @returns response as a string
   */
  private generateResponseData(responseInfo: ResponseInfo): string {
    const responseBody = responseBodyToString(responseInfo);
    return (
      `HTTP/${responseInfo.httpVersion} ${responseInfo.statusCode} ` +
      `${responseInfo.statusMessage}\n` +
      serializeHeaders(responseInfo.headers) +
      '\n\n' +
      (responseBody !== undefined ? JSON.stringify(responseBody) : '') +
      '\n'
    );
  }
}
