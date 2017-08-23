import { IncomingHttpHeaders, OutgoingHttpHeaders, request as httpReqFn } from 'http';
import { request as httpsReqFn } from 'https';
import cloneDeep = require('lodash.clonedeep');
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
    } else if (url.protocol === 'http:') {
      return httpReqFn;
    } else {
      throw new Error(`Target URL protocol ${url.protocol} not supported`);
    }
  }
  return httpReqFn;
}

export function fixRequestHeaders(hostname?: string, headers?: OutgoingHttpHeaders): IncomingHttpHeaders {
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

export function flattenHeaderValues(headers: IncomingHttpHeaders) {
  const originalHeaders = cloneDeep(headers);
  const flattenedHeaders: { [key: string]: string } = {};
  for (const key in originalHeaders) {
    if (originalHeaders.hasOwnProperty(key)) {
      const val = originalHeaders[key];
      if (Array.isArray(val)) {
        flattenedHeaders[key] = val.join(' ');
      } else {
        flattenedHeaders[key] = val;
      }
    }
  }
  return flattenedHeaders;
}

export function responseBodyToString(responseInfo: ResponseInfo) {
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
