import bodyParser = require('body-parser');
import Debug = require('debug');
import express = require('express');
import { createServer, Server } from 'http';
import normalizePort = require('normalize-port');
import normalizeUrl = require('normalize-url');
import { join as pathJoin } from 'path';
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

  constructor(incomingTargetUrl: string, controlPort: string, outPort: string, scenarioName = 'untitled_scenario') {
    this.scenarioName = scenarioName;
    this.replayer = new Replayer(incomingTargetUrl, outPort);
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
            log('scenario started');
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
      log('stopping scenario');
      const history = this.replayer.getHistory();
      this.replayer.reset()
        .then(() => {
          res.json(history);
        });
    });

    return app;
  }
}

export function startReplayingController(
  incomingRequestTargetUrl: string, controlPort: string, outPort: string,
): Promise<void> {
  const controller = new ReplayingController(
    normalizeUrl(incomingRequestTargetUrl), normalizePort(controlPort), normalizePort(outPort),
  );
  return controller.start();
}
