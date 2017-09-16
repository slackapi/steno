import bodyParser = require('body-parser');
import Debug = require('debug');
import express = require('express');
import { createServer, Server } from 'http';
import { join as pathJoin } from 'path';
import { PrintFn } from 'steno';
import { ProxyTargetConfig, ProxyTargetRule } from './http-proxy';
import { Recorder } from './recorder';

const log = Debug('steno:recordingcontroller');

function pathFromScenarioName(name: string) {
  return pathJoin(process.cwd(), 'scenarios', name);
}

export class RecordingController {
  private server: Server;
  private port: string;
  private app: express.Application;
  private scenarioName: string;
  private recorder: Recorder;
  private print: PrintFn;

  constructor(incomingTargetConfig: ProxyTargetConfig, outgoingTargetConfig: ProxyTargetConfig, controlPort: string,
              inPort: string, outPort: string, scenarioName: string, print: PrintFn) {
    this.scenarioName = scenarioName;
    this.recorder = new Recorder(outgoingTargetConfig, outPort, incomingTargetConfig, inPort,
                                 pathFromScenarioName(this.scenarioName), print);
    this.app = this.createApp();
    this.port = controlPort;
    this.server = createServer(this.app);
    this.print = print;
    log(`scenarioName: ${this.scenarioName}`);
  }

  public start(): Promise<void> {
    return Promise.all([
      new Promise((resolve, reject) => {
        this.server.on('error', reject);
        this.server.listen(this.port, () => {
          this.print(`Control API started on port ${this.port}`);
          // NOTE: it would be nice if this line could be updated dynamically rather than tailing to stdout
          this.print(`Scenario: ${this.scenarioName}`);
          resolve();
        });
      }),
      this.recorder.start(),
    ])
    .then(() => {}); // tslint:disable-line no-empty
  }

  public setScenarioName(scenarioName: string): Promise<void> {
    if (scenarioName !== this.scenarioName) {
      this.scenarioName = scenarioName;
      return this.recorder.setStoragePath(pathFromScenarioName(this.scenarioName))
        .then(() => {
          this.print(`Scenario: ${this.scenarioName}`);
        })
        .catch((error) => {
          this.print(`Scenario name change FAIL: ${error.message}. system is in a bad state.`);
          throw error;
        });
    } else {
      return Promise.resolve();
    }
  }

  private createApp() {
    const app = express();
    app.use(bodyParser.json());

    // Get current scenario information
    app.get('/scenario', (req , res) => {
      res.json({ name: this.scenarioName });
    });

    // Change current scenario information
    app.post('/scenario', (req, res, next) => {
      let complete = Promise.resolve();
      if (req.body && req.body.name) {
        complete = this.setScenarioName(req.body.name);
      }
      complete
        .then(() => {
          res.json({ name: this.scenarioName });
        })
        .catch(next);
    });

    return app;
  }
}

export function startRecordingController(
  incomingRequestTargetUrl: string, controlPort: string, inPort: string, outPort: string, scenarioName: string,
  print: PrintFn, environment = '',
): Promise<void> {
  // Slack-specific outgoing proxy configuration
  const outHostPrefix = environment ? `${environment}.` : '' ;
  const outTargetHost = `${ outHostPrefix }slack.com`;
  const outTargetUrl = `https://${ outTargetHost }`;

  const incomingWebhooksPathPattern = /^\/services\//;
  const slashCommandsPathPattern = /^\/commands\//;
  const interactiveResponseUrlPathPattern = /^\/actions\//;
  const hooksSubdomainRewriteRule: ProxyTargetRule = {
    processor: (req, optsBefore) => {
      if (req.url &&
         (incomingWebhooksPathPattern.test(req.url) || slashCommandsPathPattern.test(req.url) ||
          interactiveResponseUrlPathPattern.test(req.url))
      ) {
        return Object.assign({}, optsBefore, {
          // remove host because apparently hostname is preffered. host would have to include port, so meh.
          host: null,
          hostname: `hooks.${outTargetHost}`,
        });
      }
      return optsBefore;
    },
    type: 'requestOptionRewrite',
  };

  const controller = new RecordingController(
    { targetUrl: incomingRequestTargetUrl },
    { targetUrl: outTargetUrl, rules: [hooksSubdomainRewriteRule] },
    controlPort, inPort, outPort, scenarioName, print,
  );
  return controller.start();
}
