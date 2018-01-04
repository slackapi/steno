import { IncomingHttpHeaders, OutgoingHttpHeaders, request as httpReqFn, Server } from 'http';
import { request as httpsReqFn } from 'https';
import cloneDeep = require('lodash.clonedeep'); // tslint:disable-line import-name
import { ResponseInfo } from 'steno';
import { Url } from 'url';
import { constants as zConstants, gunzipSync, inflateSync } from 'zlib';

const zlibOptions = {
  finishFlush: zConstants.Z_SYNC_FLUSH,
  flush: zConstants.Z_SYNC_FLUSH,
};

export function requestFunctionForTargetUrl(url: Url) {
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
export function flattenHeaderValues(headers: IncomingHttpHeaders) {
  const originalHeaders = cloneDeep(headers);
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

export function responseBodyToString(responseInfo: ResponseInfo): string | undefined {
  let body;
  if (responseInfo.body) {
    const contentEncoding = responseInfo.headers['content-encoding'];
    if (contentEncoding === 'identity' || !contentEncoding) {
      body = responseInfo.body.toString();
    } else if (contentEncoding === 'gzip') {
      body = gunzipSync(responseInfo.body, zlibOptions).toString();
    } else if (contentEncoding === 'deflate') {
      body = inflateSync(responseInfo.body, zlibOptions).toString();
    } else {
      body = responseInfo.body.toString();
    }
  }
  return body;
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
 * TypeScript-specific helper to resolve errors in functions where a return type is in the
 * signature and all the returns are handled before the end of the function.
 */
export function assertNever(x: never): never {
  throw new Error('Unexpected object: ' + x);
}
