import { constants as zConstants, gunzipSync, inflateSync } from 'zlib';
import { IncomingHttpTrailers, NotOptionalIncomingHttpHeaders  } from './util';

export interface Service {
  start(): Promise<void>;
}
// TODO: maybe split this into two types?
// * "incomplete" (before body and trailers)
// * "complete" (as shown)
export interface RequestInfo {
  body: Buffer | undefined;
  headers: NotOptionalIncomingHttpHeaders;
  httpVersion: string;
  id: string; // internal property and should not be serialized or exposed to the user
  method: string;
  trailers: IncomingHttpTrailers | undefined;
  url: string;
}

// TODO: maybe a similar split as noted above?
export interface ResponseInfo {
  body: Buffer | undefined;
  headers: NotOptionalIncomingHttpHeaders;
  httpVersion: string;
  requestId: string; // foreign key to associate with RequestInfo.id
  statusCode: number;
  statusMessage: string;
  trailers: IncomingHttpTrailers | undefined;
}

const zlibOptions = {
  finishFlush: zConstants.Z_SYNC_FLUSH,
  flush: zConstants.Z_SYNC_FLUSH,
};

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

