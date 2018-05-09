import { ClientRequest, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders,
  request as httpReqFn, RequestOptions, Server } from 'http';
import { request as httpsReqFn } from 'https';
import { Url, URL } from 'url';

export interface RequestFn {
  (options: RequestOptions | string | URL,
   callback?: (res: IncomingMessage) => void): ClientRequest;
}

export function requestFunctionForTargetUrl(url: Url): RequestFn {
  if (url.protocol) {
    if (url.protocol === 'https:') {
      return httpsReqFn;
    }
    if (url.protocol === 'http:') {
      return httpReqFn;
    }
    throw new Error(`Target URL protocol ${url.protocol} not supported`);
  }
  return httpReqFn;
}

export interface IncomingHttpTrailers {
  [key: string]: string | undefined;
}

// This type extends the built-in node IncomingHttpHeaders, but because of the way it has been
// described since DefinitelyTyped/DefinitelyTyped#20695, this type cannot formally extend that
// base type. The index includes `undefined` as a value type, when strictly speaking this not
// possible. The only reason it is added is so that other common headers can be named as optional
// properties, so that intellisense has some awareness of those common headers.
export interface NotOptionalIncomingHttpHeaders {
  [header: string]: string | string[];
}

// TODO: convert away from IncomingHttpHeaders
export function fixRequestHeaders(
  hostname?: string, headers?: OutgoingHttpHeaders,
): IncomingHttpHeaders {
  if (!headers) {
    return {};
  }
  const headersCopy: IncomingHttpHeaders = {};
  Object.keys(headers).forEach((key) => {
    const val = headers[key];
    if (val !== undefined) {
      if (Array.isArray(val)) {
        headersCopy[key] = val.slice();
      } else if (typeof val === 'number') {
        headersCopy[key] = '' + val;
      } else {
        headersCopy[key] = val.slice(0);
      }
    }
  });
  if (hostname && headersCopy.host) {
    headersCopy.host = hostname;
  }
  return headersCopy;
}

// TODO: convert away from IncomingHttpHeaders
export function flattenHeaderValues(headers: IncomingHttpHeaders): { [key: string]: string } {
  const originalHeaders = cloneJSON(headers);
  const flattenedHeaders: { [key: string]: string } = {};
  for (const key in originalHeaders) {
    if (originalHeaders.hasOwnProperty(key)) {
      const val = originalHeaders[key];
      if (Array.isArray(val)) {
        flattenedHeaders[key] = val.join(' ');
      } else if (typeof val === 'string') {
        flattenedHeaders[key] = val;
      } else {
        throw new Error('Cannot flatten header key with undefined value');
      }
    }
  }
  return flattenedHeaders;
}

export function cloneJSON(obj: any): any {
  return JSON.parse(JSON.stringify(obj));
}

export function isEmptyObject(obj: any): boolean {
  for (const _k in obj) { return false; }
  return true;
}

/**
 *
 * @param server the server to be started
 * @param port the port it is to be started on
 */
export function startServer(server: Server, port: string | number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

/**
 * Allows a failed promise's error to be identified with a particular string as it gets thrown
 *
 * @param p original promise
 * @param id an identifer that will be assigned to `error.identifier`
 */
export function assignErrorIdentifier<T>(p: Promise<T>, id: string): Promise<T> {
  return p.catch((error) => {
    error.identifier = id;
    throw error;
  });
}

export type PrintFn = (str: string, ...args: any[]) => void;

/**
 * TypeScript-specific helper to resolve errors in functions where a return type is in the
 * signature and all the returns are handled before the end of the function.
 */
export function assertNever(x: never): never {
  throw new Error('Unexpected object: ' + x);
}
