import Debug = require('debug');
import { EventEmitter } from 'events';
import { ClientRequest, createServer, IncomingHttpHeaders, IncomingMessage, RequestOptions, Server,
  ServerResponse } from 'http';
import cloneDeep = require('lodash.clonedeep');
import getRawBody = require('raw-body');
import { parse as urlParse, Url } from 'url';
import { promisify } from 'util';
import uuid = require('uuid/v4');
import { fixRequestHeaders, requestFunctionForTargetUrl } from '../common';

import { RequestInfo, ResponseInfo } from 'steno';

const log = Debug('steno:http-proxy');

export class HttpProxy extends EventEmitter {

  private server: Server;
  private targetUrl: Url;
  private requestFn:
    (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void) => ClientRequest;

  constructor(targetUrl: string) {
    super();
    log(`proxy init with target URL: ${targetUrl}`);
    this.targetUrl = urlParse(targetUrl);
    this.requestFn = requestFunctionForTargetUrl(this.targetUrl);
    this.server = createServer(HttpProxy.prototype.onRequest.bind(this));
  }

  public onRequest(req: IncomingMessage, res: ServerResponse) {
    // NOTE: cloneDeep usage here is for safety, but if this is a performance hit, we likely could remove it
    const mungedHeaders = fixRequestHeaders(this.targetUrl, req.headers);
    const requestInfo: RequestInfo = {
      body: undefined,
      headers: mungedHeaders,
      httpVersion: req.httpVersion,
      id: uuid(),
      method: cloneDeep(req.method as string),
      trailers: undefined,
      url: cloneDeep(req.url as string),
    };

    const proxyReqOptions = Object.assign({}, this.targetUrl, {
      headers: requestInfo.headers,
      method: requestInfo.method,
      path: requestInfo.url,
    });
    log('creating proxy request with options: %O', proxyReqOptions);
    const proxyRequest = this.requestFn(proxyReqOptions);
      // TODO: are response trailers really set on `req`?
    req.pipe(proxyRequest);
    getRawBody(req)
      .then((body) => {
        requestInfo.body = body;
        requestInfo.trailers = cloneDeep(req.trailers);
        this.emit('request', requestInfo);
      })
      .catch((error) => {
        log(`request body read error: ${error.message}`);
      });
    proxyRequest.on('response', (proxyResponse: IncomingMessage) => {
      log('recieved proxy response');
      const responseInfo: ResponseInfo = {
        body: undefined,
        headers: cloneDeep(proxyResponse.headers),
        httpVersion: proxyResponse.httpVersion,
        requestId: requestInfo.id,
        statusCode: proxyResponse.statusCode as number,
        statusMessage: proxyResponse.statusMessage as string,
        trailers: undefined,
      };
      res.statusCode = responseInfo.statusCode;
      res.statusMessage = responseInfo.statusMessage;
      Object.getOwnPropertyNames(responseInfo.headers).forEach((key) => {
        const val = proxyResponse.headers[key];
        if (val) {
          res.setHeader(key, val);
        }
      });
      // TODO: are response trailers really set on `res`?
      proxyResponse.pipe(res);
      getRawBody(proxyResponse)
        .then((body) => {
          responseInfo.body = body;
          responseInfo.trailers = cloneDeep(proxyResponse.trailers);
          this.emit('response', responseInfo);
        })
        .catch((error) => {
          log(`response body read error: ${error.message}`);
        });
    });
  }

  public listen(port: any): Promise<null> {
    log(`proxy listen on port ${port}`);
    const serverListen = promisify(this.server.listen);
    return serverListen.call(this.server, port);
  }

}

export function createProxy(targetUrl: string): HttpProxy {
  return new HttpProxy(targetUrl);
}
