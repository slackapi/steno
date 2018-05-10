import { URLSearchParams, parse as urlParse, format as urlFormat } from 'url';
import { RequestInfo, SerializerRawRequest } from '../steno';
import { PrintFn } from '../util';
import nonce from 'nonce-str'; // tslint:disable-line import-name

const authorizationHeaderPattern = /^Bearer (.*)$/;

/**
 * Helper for creating fake tokens
 * @param length
 */
function createPlaceholderToken(length: number): string {
  return `xoxf-${nonce(length - 5)}`;
}

/**
 * Creates a hook which replaces Slack API tokens with fake tokens
 * @param print a function used to show text to the user
 */
export function createHook(print: PrintFn): SerializerRawRequest {
  print('Starting with Slack token replacement enabled. Each time a token is encountered in an ' +
        'interaction, it will be replaced with a placeholder. Make these substitutions in test ' +
        'code. This way, when your test code runs against steno in replay mode, the interactions ' +
        'will continue to match.\n\n\nWARNING: In this mode, sensitive data is logged to stdout. ' +
        'Do not store these logs without access control.\n\n');

  const tokenReplacements: Map<string, string> = new Map();

  /**
   * Finds a replacement for the given Slack API token from a previous replacement, or as a new
   * fake token
   *
   * @param token
   */
  function replaceToken(token: string): string {
    const replacement = tokenReplacements.get(token) !== undefined ?
      (tokenReplacements.get(token) as string) : createPlaceholderToken(token.length);
    tokenReplacements.set(token, replacement);
    print(`Slack token replaced: TOKEN=${token} REPLACEMENT=${replacement}`);
    return replacement;
  }

  return {
    hookType: 'serializerRawRequest',
    processor: (request: RequestInfo): RequestInfo => {
      // TODO: RequestInfo is useful as an internal representation, we do not want to export this type

      // Look for tokens in all the places we might see one in the Slack API

      // 1. JSON write requests to the Web API include tokens in the Authorization header
      let authorization;
      let match = null;
      if ((authorization = request.headers['authorization'] as string) !== undefined &&
          (match = authorizationHeaderPattern.exec(authorization)) !== null) {
        const token = match[1];
        if (token !== undefined) {
          const replacement = replaceToken(token);
          request.headers['authorization'] = (request.headers['authorization'] as string).replace(token, replacement);
        }
      }

      // 2. Some requests to the Web API include tokens in the URL-encoded body
      if (request.headers['content-type'] === 'application/x-www-form-urlencoded' && request.body !== undefined) {
        const bodyParams = new URLSearchParams(`?${request.body.toString()}`);
        const token = bodyParams.get('token');
        if (token !== null) {
          const replacement = replaceToken(token);
          bodyParams.set('token', replacement);
          // NOTE: URLSearchParams has opinions about how to encode itself as a string, that may
          // differ from how the original request was encoded. The main example is spaces, which
          // can be encoded as "%20", but URLSearchParams chooses to encode them as "+". Both are
          // technically correct.
          request.body = Buffer.from(bodyParams.toString());
        }
      }

      // 3. Other requests to the Web API include tokens in the URL-encoded query parameter
      const parsedUrl = urlParse(request.url);
      if (parsedUrl.search !== undefined) {
        const queryParams = new URLSearchParams(parsedUrl.search);
        const token = queryParams.get('token');
        if (token !== null) {
          const replacement = replaceToken(token);
          queryParams.set('token', replacement);
          delete parsedUrl.query;
          // NOTE: URLSearchParams has opinions about how to encode itself as a string, that may
          // differ from how the original request was encoded. The main example is spaces, which
          // can be encoded as "%20", but URLSearchParams chooses to encode them as "+". Both are
          // technically correct.
          parsedUrl.search = queryParams.toString();
          request.url = urlFormat(parsedUrl);
        }
      }

      // incoming requests from slash commands, events api, and interactive messages have a
      // verification token in them, not a client authentication token

      // outgoing requests from incoming webhooks and response_urls (interactive message or slash
      // command) don't have client authentication tokens in them, although the URL itself could
      // be considered sentitive data

      return request;
    },
  };
}
