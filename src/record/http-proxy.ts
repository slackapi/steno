import debug from 'debug';
import { EventEmitter } from 'events';
import { createServer, IncomingMessage, RequestOptions, Server, ServerResponse } from 'http';
import rawBody from 'raw-body';
import { format as urlFormat, parse as urlParse, Url } from 'url';
import { v4 as uuid } from 'uuid';
import { fixRequestHeaders, requestFunctionForTargetUrl, startServer, cloneJSON,
  NotOptionalIncomingHttpHeaders, RequestFn } from '../util';
import { RequestInfo, ResponseInfo, StenoHook, OutgoingProxyRequestInfo } from '../steno';

export interface ProxyTargetConfig {
  targetUrl: string; // stores a URL after it's passed through normalizeUrl()
}

const log = debug('steno:http-proxy');

/**
 * An HTTP proxy server that forwards incoming requests to a specified target URL. It applies
 * any rulesin its configuration before forwarding the request onward.
 */
export class HttpProxy extends EventEmitter {

  /** the underlying HTTP server */
  private server: Server;
  /** the URL where requests are forwarded */
  private targetUrl: Url;
  /** a factory function for creating HTTP client requests */
  private requestFn: RequestFn;
  /** a hook for arbitrary pre-processing of request info before its sent to the target */
  private requestInfoHook?: OutgoingProxyRequestInfo;

  constructor(targetConfig: ProxyTargetConfig, hooks: StenoHook[] = []) {
    super();
    log(`proxy init with target URL: ${targetConfig.targetUrl}`);
    this.targetUrl = urlParse(targetConfig.targetUrl);

    this.requestInfoHook = hooks.find(hook => hook.hookType === 'outgoingProxyRequestInfo') as OutgoingProxyRequestInfo;
    this.requestFn = requestFunctionForTargetUrl(this.targetUrl);
    this.server = createServer(HttpProxy.prototype.onRequest.bind(this));
  }

  /**
   * Handle an incoming request and outgoing response by forwarding to the target
   *
   * @param req incoming request from a client that will be forwarded to target
   * @param res response back to the client created from the response from the target
   */
  public onRequest(req: IncomingMessage, res: ServerResponse): void {
    // NOTE: cloneDeep usage here is for safety, could remove for performance
    const requestInfo: RequestInfo = {
      body: undefined,
      headers: (req.headers as NotOptionalIncomingHttpHeaders),
      httpVersion: req.httpVersion,
      id: uuid(),
      method: (req.method as string).slice(0),
      trailers: undefined,
      url: (req.url as string).slice(0),
    };

    let proxyReqOptions: RequestOptions = Object.assign({}, this.targetUrl, {
      headers: requestInfo.headers,
      href: null,
      method: requestInfo.method,
      path: requestInfo.url,
    });

    if (this.requestInfoHook !== undefined) {
      proxyReqOptions = this.requestInfoHook.processor(req, proxyReqOptions);
    }

    proxyReqOptions.headers = fixRequestHeaders(proxyReqOptions.hostname, proxyReqOptions.headers);

    log('creating proxy request with options: %O', proxyReqOptions);
    const proxyRequest = this.requestFn(proxyReqOptions);
      // TODO: are response trailers really set on `req`?
    req.pipe(proxyRequest);
    rawBody(req)
      .then((body) => {
        requestInfo.body = body;
        requestInfo.trailers = cloneJSON(req.trailers);
        this.emit('request', requestInfo);
      })
      .catch((error) => {
        log(`request body read error: ${error.message}`);
      });
    proxyRequest.on('response', (proxyResponse: IncomingMessage) => {
      log('recieved proxy response');
      const responseInfo: ResponseInfo = {
        body: undefined,
        headers: (cloneJSON(proxyResponse.headers) as NotOptionalIncomingHttpHeaders),
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
        if (val !== undefined) {
          res.setHeader(key, val);
        }
      });
      // TODO: are response trailers really set on `res`?
      proxyResponse.pipe(res);
      rawBody(proxyResponse)
        .then((body) => {
          responseInfo.body = body;
          responseInfo.trailers = cloneJSON(proxyResponse.trailers);
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

  /**
   * Start the server by listening on the specified port
   *
   * @param port the TCP port to listen on
   * @returns resolves when the server is listening
   */
  public listen(port: any): Promise<void> {
    log(`proxy listen on port ${port}`);

    return startServer(this.server, port);
  }

}

/**
 * Factory to create HttpProxy objects
 * @param targetConfig configuration for the HttpProxy
 */
export function createProxy(targetConfig: ProxyTargetConfig, hooks: StenoHook[] = []): HttpProxy {
  return new HttpProxy(targetConfig, hooks);
}
