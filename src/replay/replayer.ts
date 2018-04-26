import { raw as rawParser } from 'body-parser';
import debug = require('debug');
import express = require('express');
import { ClientRequest, createServer, IncomingMessage, RequestOptions, Server } from 'http';
import { Service, responseBodyToString } from '../steno';
import { format as urlFormat, parse as urlParse, Url, URL } from 'url';
import { flattenHeaderValues, requestFunctionForTargetUrl, startServer, cloneJSON,
  PrintFn } from '../util';
import { Interaction, InteractionCatalog } from './interaction-catalog';
import { Device } from '../controller';

const log = debug('steno:replayer');

export class Replayer implements Service, Device {
  private server: Server;
  private app: express.Application;
  private port: string;
  private requestFn:
    (options: RequestOptions | string | URL,
     callback?: (res: IncomingMessage) => void) => ClientRequest;
  private targetUrl: Url;
  private catalog: InteractionCatalog;
  private print: PrintFn;

  constructor(targetUrl: string, port: string, storagePath: string, print: PrintFn) {
    this.app = this.createApp();
    this.port = port;
    this.server = createServer(this.app);
    this.targetUrl = urlParse(targetUrl);
    this.requestFn = requestFunctionForTargetUrl(this.targetUrl);
    this.catalog = new InteractionCatalog(storagePath);
    this.print = print;

    this.catalog.on('clientReqTrigger', this.clientInteraction.bind(this));
  }

  public start(): Promise<void> {
    log(`replayer start with path: ${this.catalog.storagePath}`);
    return Promise.all([
      startServer(this.server, this.port),
      this.catalog.load(),
    ])
    .then(() => {
      this.print(`Listening for outgoing requests on port ${this.port}`);
      this.print(`Incoming requests sent to: ${urlFormat(this.targetUrl)}`);
    })
    .catch((error) => {
      if (error.code === 'ECATALOGNOPATH') {
        log(`starting replayer with a scenario name that wasn\'t found: ${error.message}`);
        return;
      }
      throw error;
    })
    .then(() => {});
  }

  public setStoragePath(newPath: string): Promise<void> {
    return this.catalog.loadPath(newPath);
  }

  public reset(): Promise<void> {
    this.catalog.reset();
    return Promise.resolve();
  }

  // remove request IDs, serialize body's to strings, add metadata
  // TODO: can i add timestamp to both request and response? duration?
  // TODO: there's a lot of shared logic between this and http-serializer
  public getHistory() {
    const scrubbedHistory: any[] = this.catalog.interactionHistory.map((interaction) => {
      const historyRequestRecord: any = {
        body: interaction.request.body !== undefined ?
          (interaction.request.body as Buffer).toString() : '',
        headers: flattenHeaderValues(interaction.request.headers),
        method: interaction.request.method,
        timestamp: interaction.requestTimestamp,
        url: interaction.request.url,
      };
      const historyResponseRecord: any = {
        body: responseBodyToString(interaction.response),
        headers: cloneJSON(interaction.response.headers),
        statusCode: interaction.response.statusCode,
        timestamp: interaction.responseTimestamp,
      };
      return {
        request: historyRequestRecord,
        response: historyResponseRecord,
      };
    });

    // tslint:disable-next-line no-shadowed-variable
    const { highest, lowest } = scrubbedHistory.reduce(({ highest, lowest }, i) => {
      return {
        highest: Math.max(highest, i.response.timestamp),
        lowest: Math.min(lowest, i.request.timestamp),
      };
    }, { lowest: Date.now(), highest: 0 });
    const duration = highest - lowest;
    const unmatchedInteractions = this.catalog.interactions
      .filter(i => !this.catalog.previouslyMatched.has(i.request.id));
    const historyMeta: any = {
      // guard for having a val when no interactions took place
      durationMs: duration < 0 ? null : duration,
      unmatchedCount: {
        incoming: unmatchedInteractions.filter(i => i.direction === 'incoming').length,
        outgoing: unmatchedInteractions.filter(i => i.direction === 'outgoing').length,
      },
    };

    return {
      interactions: scrubbedHistory,
      meta: historyMeta,
    };
  }

  private createApp() {
    const app = express();

    app.use(rawParser({ type: '*/*' }));
    app.use((req, res, next) => {
      log('outgoing request');
      const interaction = this.catalog.findMatchingInteraction(req);
      if (interaction !== undefined) {
        const respInfo = interaction.response;
        res.writeHead(respInfo.statusCode, respInfo.statusMessage, respInfo.headers);
        res.end(respInfo.body, () => {
          log('outgoing request got response');
          this.catalog.onOutgoingResponse(interaction.request.id);
        });
      } else {
        next();
      }
    });

    return app;
  }

  private clientInteraction(interaction: Interaction) {
    const requestInfo = interaction.request;
    const reqOptions = Object.assign({}, this.targetUrl, {
      headers: requestInfo.headers,
      method: requestInfo.method,
      path: requestInfo.url,
    });
    log('incoming request');
    const request = this.requestFn(reqOptions);
    const requestTimestamp = Date.now();
    request.on('response', (response: IncomingMessage) => {
      log('incoming request got response');
      this.catalog.onIncomingResponse(interaction, requestTimestamp, response);
    });
    request.end(requestInfo.body, () => {
      log('incoming request sent');
    });
  }
}
