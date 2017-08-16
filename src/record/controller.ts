import bodyParser = require('body-parser');
import Debug = require('debug');
import express = require('express');
import { createServer, Server } from 'http';
import normalizePort = require('normalize-port');
import normalizeUrl = require('normalize-url');
import { join as pathJoin } from 'path';
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

  constructor(incomingTargetUrl: string, outgoingTargetUrl: string, controlPort: string,
              inPort: string, outPort: string, scenarioName: string) {
    this.scenarioName = scenarioName;
    this.recorder = new Recorder(outgoingTargetUrl, outPort, incomingTargetUrl, inPort,
                                 pathFromScenarioName(this.scenarioName));
    this.app = this.createApp();
    this.port = controlPort;
    this.server = createServer(this.app);
    log(`scenarioName: ${this.scenarioName}`);
  }

  public start(): Promise<void> {
    return Promise.all([
      new Promise((resolve, reject) => {
        this.server.on('error', reject);
        this.server.listen(this.port, () => {
          log(`Listening on ${this.port}`);
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
          log('scenario name change success');
        })
        .catch((error) => {
          log(`scenario name change FAIL: ${error.message}. system is in a bad state.`);
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
  incomingRequestTargetUrl: string, controlPort: string, inPort: string, outPort: string, scenarioName: string, environment = '',
): Promise<void> {
  // Slack-specific outgoing proxy configuration
  const outHostPrefix = environment ? `${environment}.` : '' ;
  const outTargetHost = `${ outHostPrefix }slack.com`;
  const outTargetUrl = `https://${ outTargetHost }`;

  const controller = new RecordingController(
    normalizeUrl(incomingRequestTargetUrl), outTargetUrl, normalizePort(controlPort), normalizePort(inPort), normalizePort(outPort), scenarioName
  );
  return controller.start();
}
