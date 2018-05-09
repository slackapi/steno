import { IncomingMessage, RequestOptions } from 'http';
import { OutgoingProxyRequestInfo } from '../steno';
import { parse } from 'url';

const incomingWebhooksPathPattern = /^\/services\//;
const slashCommandsPathPattern = /^\/commands\//;
const interactiveResponseUrlPathPattern = /^\/actions\//;

export function createHook(outgoingTargetUrl: string): OutgoingProxyRequestInfo {
  const outgoingTargetHost = parse(outgoingTargetUrl).hostname as string;
  return {
    hookType: 'outgoingProxyRequestInfo',
    processor: (originalReq: IncomingMessage, reqOptions: RequestOptions): RequestOptions => {
      if (originalReq.url &&
          (incomingWebhooksPathPattern.test(originalReq.url) || slashCommandsPathPattern.test(originalReq.url) ||
          interactiveResponseUrlPathPattern.test(originalReq.url))
      ) {
        return Object.assign({}, reqOptions, {
          // hostname is preferred over host (which includes port)
          host: null,
          hostname: `hooks.${outgoingTargetHost}`,
        });
      }
      return reqOptions;
    },
  };
}
