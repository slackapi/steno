import bodyParser = require('body-parser');
import Debug = require('debug');
import express = require('express');
import { createServer, Server } from 'http';
import normalizePort = require('normalize-port');
import normalizeUrl = require('normalize-url');
import { join as pathJoin } from 'path';
import { PrintFn } from 'steno';
import { Replayer } from './replayer';

const log = Debug('steno:replayingcontroller');

function pathFromScenarioName(name: string) {
  return pathJoin(process.cwd(), 'scenarios', name);
}

export class ReplayingController {
  private server: Server;
  private port: string;
  private app: express.Application;
  private scenarioName: string;
  private replayer: Replayer;
  private print: PrintFn;

  constructor(incomingTargetUrl: string, controlPort: string, outPort: string, print: PrintFn,
              scenarioName = 'untitled_scenario') {
    this.scenarioName = scenarioName;
    this.replayer = new Replayer(incomingTargetUrl, outPort, print);
    this.app = this.createApp();
    this.port = controlPort;
    this.server = createServer(this.app);
    this.print = print;
  }

  public start(): Promise<void> {
    return Promise.all([
      new Promise((resolve, reject) => {
        this.server.on('error', reject);
        this.server.listen(this.port, () => {
          this.print(`Control API started on port ${this.port}`);
          // NOTE: it would be nice if this line could be updated dynamically rather than tailing to stdout
          this.print(`Scenario started: ${this.scenarioName}`);
          resolve();
        });
      }),
      this.replayer.start(pathFromScenarioName(this.scenarioName)),
    ])
    .then(() => {}); // tslint:disable-line no-empty
  }

  private createApp() {
    const app = express();
    app.use(bodyParser.json());

    // Get current scenario information
    app.post('/start', (req , res) => {
      if (req.body.name) {
        const scenario = req.body.name;
        log(`will start scenario ${scenario}`);
        this.replayer.updatePath(pathFromScenarioName(scenario))
          .then(() => {
            this.scenarioName = scenario;
            this.print(`Scenario started: ${this.scenarioName}`);
            res.json({ name: scenario });
          })
          .catch((error) => {
            log('error starting scenario: %O', error);
            res.status(500);
            res.send({ error: { description: `Could not load scenario ${scenario}` }});
          });
      } else {
        res.status(400);
        res.json({ error: { description: 'No scenario name given' } });
      }
    });

    // Change current scenario information
    app.post('/stop', (req, res) => {
      const history = this.replayer.getHistory();
      this.replayer.reset()
        .then(() => {
          this.print(`Scenario ended: ${this.scenarioName}`);
          res.json(history);
        });
    });

    return app;
  }
}

export function startReplayingController(
  incomingRequestTargetUrl: string, controlPort: string, outPort: string, print: PrintFn,
): Promise<void> {
  const controller = new ReplayingController(
    normalizeUrl(incomingRequestTargetUrl), normalizePort(controlPort), normalizePort(outPort), print,
  );
  return controller.start();
}
