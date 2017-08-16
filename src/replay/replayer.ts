import { raw as rawParser } from 'body-parser';
import Debug = require('debug');
import express = require('express');
import { ClientRequest, createServer, IncomingMessage, RequestOptions, Server } from 'http';
import { Dictionary } from 'lodash';
import cloneDeep = require('lodash.clonedeep');
import { parse as urlParse , Url } from 'url';
import { flattenHeaderValues, requestFunctionForTargetUrl, responseBodyToString } from '../common';
import { Interaction, InteractionCatalog } from './interaction-catalog';

const log = Debug('steno:replayer');

export class Replayer {
  private server: Server;
  private app: express.Application;
  private port: string;
  private requestFn:
    (options: RequestOptions | string | URL, callback?: (res: IncomingMessage) => void) => ClientRequest;
  private targetUrl: Url;
  private catalog: InteractionCatalog;

  constructor(targetUrl: string, port: string) {
    this.app = this.createApp();
    this.port = port;
    this.server = createServer(this.app);
    this.targetUrl = urlParse(targetUrl);
    this.requestFn = requestFunctionForTargetUrl(this.targetUrl);
    this.catalog = new InteractionCatalog();

    this.catalog.on('clientReqTrigger', this.clientInteraction.bind(this));
  }

  public start(path: string): Promise<void> {
    log(`replayer start with path: ${path}`);
    return Promise.all([
      new Promise((resolve, reject) => {
        this.server.on('error', reject);
        this.server.listen(this.port, () => {
          log(`Listening on ${this.port}`);
          resolve();
        });
      }),
      this.catalog.loadPath(path),
    ])
    .catch((error) => {
      if (error.code === 'ECATALOGNOPATH') {
        log('starting replayer with a scenario name that wasn\'t found');
        return;
      }
      throw error;
    })
    .then(() => {}); // tslint:disable-line no-empty
  }

  public updatePath(newPath: string): Promise<void> {
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
        body: interaction.request.body ? (interaction.request.body as Buffer).toString() : '',
        headers: flattenHeaderValues(interaction.request.headers),
        method: interaction.request.method,
        timestamp: interaction.requestTimestamp,
        url: interaction.request.url,
      };
      const historyResponseRecord: any = {
        body: responseBodyToString(interaction.response),
        headers: cloneDeep(interaction.response.headers),
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
      .filter((i) => !this.catalog.previouslyMatched.has(i.request.id));
    const historyMeta: any = {
      durationMs: duration < 0 ? null : duration, // guard for having a val when no interactions took place
      unmatchedCount: {
        incoming: unmatchedInteractions.filter((i) => i.direction === 'incoming').length,
        outgoing: unmatchedInteractions.filter((i) => i.direction === 'outgoing').length,
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
      if (interaction) {
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
      log('outgoing request sent');
    });
  }
}
