import { raw as rawParser } from 'body-parser';
import debug from 'debug';
import express from 'express';
import { createServer, IncomingMessage, Server } from 'http';
import { Service, responseBodyToString } from '../steno';
import { format as urlFormat, parse as urlParse, Url } from 'url';
import { flattenHeaderValues, requestFunctionForTargetUrl, startServer, cloneJSON, PrintFn,
  RequestFn } from '../util';
import { Interaction, InteractionCatalog } from './interaction-catalog';
import { Device } from '../controller';

const log = debug('steno:replayer');

export interface History {
  interactions: Interaction[];
  meta: {
    durationMs: number | null;
    unmatchedCount: {
      incoming: number;
      outgoing: number;
    };
  };
}

/**
 * Replays bidirectional HTTP traffic from a previously recorded set of interactions. Outgoing
 * requests (sent to the replayer server) are matched against a known catalog of interactions, and
 * if a match is found, responded to using the response from the catalog. Inversely, incoming
 * requests (sent to the app) will be sent any time the catalog contains one where all previous
 * interactions have already been replayed (several can be sent in parallel).
 */
export class Replayer implements Service, Device {
  /** the underlying HTTP server */
  private server: Server;
  /** an express app used to handle outgoing requests */
  private app: express.Application;
  /** the port where the server is listening */
  private port: string;
  /** a factory function for creating HTTP client requests */
  private requestFn: RequestFn;
  /** the URL where incoming requests are forwarded */
  private targetUrl: Url;
  /** the catalog of known interactions */
  private catalog: InteractionCatalog;
  /** a function used to display messages to the user */
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

  /**
   * Starts the replayer.
   * @returns promise that resolves once the replayer is ready to replay requests and responses
   */
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
    .then(() => {}); // tslint:disable-line no-empty
  }

  /**
   * Sets the path on disk where the replayer will read HTTP interactions for the catalog
   * @param storagePath absolute path on disk
   * @returns promise that resolves when the replayer is ready to replay requests and responses
   */
  public setStoragePath(newPath: string): Promise<void> {
    return this.catalog.loadPath(newPath);
  }

  /**
   * Resets all history and empties the interaction catalog.
   * @returns promise that resolves when the replayer is ready to replay requests and responses
   */
  public reset(): Promise<void> {
    this.catalog.reset();
    return Promise.resolve();
  }

  /**
   * Returns the interaction history since replaying was last started (or reset)
   */
  public getHistory(): History {
    // remove request IDs, serialize body's to strings, add metadata
    // TODO: can i add timestamp to both request and response? duration?
    // TODO: there's a lot of shared logic between this and http-serializer
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

  /**
   * Creates the express application which handles requests for the server
   */
  private createApp(): express.Application {
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

  /**
   * Triggers an incoming request (from steno to the app) based on an interaction
   * @param interaction
   */
  private clientInteraction(interaction: Interaction): void {
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
