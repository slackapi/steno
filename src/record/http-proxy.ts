import Debug = require('debug');
import { EventEmitter } from 'events';
import { ClientRequest, createServer, IncomingHttpHeaders, IncomingMessage, RequestOptions, Server,
  ServerResponse } from 'http';
import cloneDeep = require('lodash.clonedeep');
import getRawBody = require('raw-body');
import { format as urlFormat, parse as urlParse, Url } from 'url';
import { promisify } from 'util';
import uuid = require('uuid/v4');
import { fixRequestHeaders, requestFunctionForTargetUrl } from '../common';

import { RequestInfo, ResponseInfo } from 'steno';

export interface ProxyTargetRule {
  type: 'requestOptionRewrite';
  // NOTE: perhaps instead of exposing the original request to the rule processor, we should just expose the parsed
  // RequestInfo
  processor: (originalReq: IncomingMessage, reqOptions: RequestOptions) => RequestOptions;
}

export interface ProxyTargetConfig {
  rules?: ProxyTargetRule[];
  targetUrl: string; // stores a URL after it's passed through normalizeUrl()
}

const log = Debug('steno:http-proxy');

export class HttpProxy extends EventEmitter {

  private server: Server;
  private targetUrl: Url;
  private requestOptionRewriteRules?: ProxyTargetRule[];
  private requestFn:
    (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void) => ClientRequest;

  constructor(targetConfig: ProxyTargetConfig) {
    super();
    log(`proxy init with target URL: ${targetConfig.targetUrl}`);
    this.targetUrl = urlParse(targetConfig.targetUrl);
    if (targetConfig.rules) {
      this.requestOptionRewriteRules = targetConfig.rules.filter((r) => r.type === 'requestOptionRewrite');
    }
    this.requestFn = requestFunctionForTargetUrl(this.targetUrl);
    this.server = createServer(HttpProxy.prototype.onRequest.bind(this));
  }

  public onRequest(req: IncomingMessage, res: ServerResponse) {
    // NOTE: cloneDeep usage here is for safety, but if this is a performance hit, we likely could remove it
    const requestInfo: RequestInfo = {
      body: undefined,
      headers: req.headers,
      httpVersion: req.httpVersion,
      id: uuid(),
      method: cloneDeep(req.method as string),
      trailers: undefined,
      url: cloneDeep(req.url as string),
    };

    let proxyReqOptions: RequestOptions = Object.assign({}, this.targetUrl, {
      headers: requestInfo.headers,
      href: null,
      method: requestInfo.method,
      path: requestInfo.url,
    });

    if (this.requestOptionRewriteRules) {
      // iteratively apply any rules
      proxyReqOptions = this.requestOptionRewriteRules
        .reduce((options, rule) => rule.processor(req, options), proxyReqOptions);
    }

    proxyReqOptions.headers = fixRequestHeaders(proxyReqOptions.hostname, proxyReqOptions.headers);

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
    proxyRequest.on('error', (error: Error & { code: string }) => {
      log('proxy request error: %O', error);
      if (error.code === 'ECONNREFUSED') {
        // TODO: print this?
        log('target URL refused connection');

        const responseInfo: ResponseInfo = {
          body: new Buffer(`Steno failed to connect to ${urlFormat(this.targetUrl)}`),
          headers: {},
          httpVersion: '1.1',
          requestId: requestInfo.id,
          statusCode: 502,
          statusMessage: 'Bad Gateway',
          trailers: undefined,
        };

        res.writeHead(responseInfo.statusCode, responseInfo.statusMessage);
        res.end(responseInfo.body);

        this.emit('response', responseInfo);
        return;
      }
      throw error;
    });
  }

  public listen(port: any): Promise<null> {
    log(`proxy listen on port ${port}`);
    const serverListen = promisify(this.server.listen);
    return serverListen.call(this.server, port);
  }

}

export function createProxy(targetConfig: ProxyTargetConfig): HttpProxy {
  return new HttpProxy(targetConfig);
}
