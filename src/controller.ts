import bodyParser from 'body-parser';
import express from 'express';
import debug from 'debug';
import { createServer, Server } from 'http';
import { join as pathJoin } from 'path';
import { Service, StenoHook } from './steno';
import { getProbe, Probe } from './analytics';
import { ProxyTargetConfig } from './record/http-proxy';
import { Recorder } from './record/recorder';
import { Replayer } from './replay/replayer';
import { assertNever, startServer, PrintFn } from './util';

const log = debug('steno:controller');

export type ControllerMode = 'record' | 'replay';

// Could not find a good way to explicitly state that the set of objects that satisfy the Device
// interface is closed: its only Recorder and Replayer
// type Device = Recorder | Replayer;
export interface Device extends Service {
  setStoragePath(path: string): Promise<void>;
}

/**
 * The controller is mainly responsible for the serving the control API. It owns and manipulates
 * the scenario. It passes all further responsibilities to the Recorder and Replayer.
 */
export class Controller implements Service {

  // The current mode
  public mode: ControllerMode;

  // The current scenario
  public scenarioName: string;
  public scenarioDir: string; // Absolute path

  // Control API server
  private app: express.Application;
  private port: string;
  private server: Server;

  // Recorder and replayer (these don't know about scenarios, just storage paths)
  private recorder?: Recorder;
  private replayer?: Replayer;
  private incomingTargetConfig?: ProxyTargetConfig;
  private incomingPort?: string;
  private outgoingTargetConfig?: ProxyTargetConfig;
  private outgoingPort?: string;
  private recorderHooks: StenoHook[];

  // Internal state
  private startPromise?: Promise<void>;

  // Output
  // TODO: have a more explicit interface about state with CLI, who can handle "UI"
  private print: PrintFn;

  // Analytics
  private probe: Probe;

  constructor(
    // Control API configuration
    initialMode: ControllerMode, controlPort: string, scenarioName: string, scenarioDir: string,
    // Recorder and Replayer configuration (TODO: refactor into a single object so that
    // this object can blindly pass recorder and replayer options when initializing devices)
    incomingTargetConfig: ProxyTargetConfig, incomingPort: string,
    outgoingTargetConfig: ProxyTargetConfig, outgoingPort: string,

    // Optional params
    hooks: StenoHook[] = [],
    print: PrintFn = console.log,
  ) {

    this.app = this.createApp();
    this.port = controlPort;
    this.server = createServer(this.app);

    this.mode = initialMode;
    this.scenarioName = scenarioName;
    this.scenarioDir = scenarioDir;

    this.incomingTargetConfig = incomingTargetConfig;
    this.incomingPort = incomingPort;
    this.outgoingTargetConfig = outgoingTargetConfig;
    this.outgoingPort = outgoingPort;

    this.recorderHooks = hooks.filter((hook) => {
      // TODO: use the intersection of enums to describe the set of hooks
      return ['outgoingProxyRequestInfo', 'serializerRawRequest'].includes(hook.hookType);
    });

    this.print = print;

    this.probe = getProbe('controller');

    log(`initialized with scenarioName: ${this.scenarioName}`);
  }

  /**
   * Start the controller
   *
   * @returns A promise that resolves when the control API is ready to serve requests
   */
  public async start(): Promise<void> {
    // NOTE: should there be a close or error listener that changes the state back to
    // "not started"?
    this.startPromise = this.startPromise || (async () => {
      const device = this.getCurrentModeDevice();

      await Promise.all([startServer(this.server, this.port), device.start()]);
      this.probe.track('start');
      this.probe.track(`mode:${this.mode}`);
      this.print(`Control API started on port ${this.port}`);
      this.print(`Controller started with scenario: ${this.scenarioName}`);
    })();
    return this.startPromise;
  }

  /**
   * Helper for initializing the Express app with a router for control API requests
   */
  private createApp(): express.Application {
    const app = express();
    app.use(bodyParser.json());

    // Helper middleware
    const onlyMode = (mode: ControllerMode): express.RequestHandler => (_req, res, next) => {
      if (this.mode === mode) return next();
      res.status(400).json({
        error: { description: `This request is only valid in ${mode} mode.` },
      });
    };
    const recordModeOnly = onlyMode('record');
    const replayModeOnly = onlyMode('replay');

    // Get current scenario information
    app.get('/scenario', recordModeOnly, (_req: express.Request, res: express.Response) => {
      this.probe.track('read scenario');
      res.json({ name: this.scenarioName });
    });

    // Change current scenario information
    app.post('/scenario', recordModeOnly, asyncMiddleware(async (req, res) => {
      if (req.body && req.body.name) {
        await this.setScenarioName(req.body.name);
        this.probe.track('change scenario');
        res.json({ name: this.scenarioName });
      } else {
        this.probe.track('change scenario error');
        res.status(400).json({
          error: { description: 'You must specify a scenario name' },
        });
      }
    }));

    // Start replaying a scenario
    app.post('/start', replayModeOnly, asyncMiddleware(async (req , res) => {
      if (req.body && req.body.name) {
        const scenario = req.body.name;
        log(`will start scenario ${scenario}`);
        try {
          await this.setScenarioName(scenario);
          this.print(`Scenario started: ${this.scenarioName}`);
          this.probe.track('replay scenario start');
          res.json({ name: this.scenarioName });
        } catch (error) {
          log('error starting scenario: %O', error);
          // NOTE: are all errors here really internal server errors? what about when the scenario
          // wasn't found (404)?
          this.probe.track('replay scenario start error');
          res.status(500);
          res.send({ error: { description: `Could not replay scenario ${scenario}` } });
        }
      } else {
        this.probe.track('replay scenario start error');
        res.status(400);
        res.json({ error: { description: 'You must specify a scenario name' } });
      }
    }));

    // Change current scenario information
    app.post('/stop', replayModeOnly, asyncMiddleware(async (_req, res) => {
      try {
        const replayer = (this.replayer as Replayer);
        const history = replayer.getHistory();
        await replayer.reset();
        this.print(`Scenario ended: ${this.scenarioName}`);
        this.probe.track('replay scenario stop');
        res.json(history);
      } catch (error) {
        this.probe.track('replay scenario stop error');
        res.status(500);
        res.json({ error: { description: `Could not stop scenario ${this.scenarioName}` } });
      }
    }));

    return app;
  }

  /**
   * Change the current scenario name
   */
  private async setScenarioName(scenarioName: string): Promise<void> {
    // In record mode, the operation is idempotent, so we can skip the work if setting the same name
    // In replay mode, setting the same name causes replay to start from the beginning
    if (this.mode === 'replay' || scenarioName !== this.scenarioName) {
      try {
        // TODO: make sure recorder can rollback this change if it fails
        await this.getCurrentModeDevice().setStoragePath(this.pathFromScenarioName(scenarioName));
      } catch (error) {
        this.print(
          `Error changing to scenario name ${scenarioName}, ` +
          `Scenario: ${this.scenarioName}`,
        );
        throw error;
      }
      this.scenarioName = scenarioName;
      this.print(`Scenario: ${this.scenarioName}`);
    }
  }

  /**
   * In each mode there is a device object that "backs" actions required in that mode. This method
   * returns that object, but also lazily initializes the object if it was not created yet.
   */
  private getCurrentModeDevice(): Device {
    if (this.mode === 'record') {
      if (!this.recorder) {
        if (this.incomingTargetConfig !== undefined && this.incomingPort !== undefined &&
            this.outgoingTargetConfig !== undefined && this.outgoingPort !== undefined) {
          this.recorder = new Recorder(
            this.incomingTargetConfig, this.incomingPort,
            this.outgoingTargetConfig, this.outgoingPort,
            this.pathFromScenarioName(this.scenarioName),
            this.recorderHooks,
            this.print,
          );
        } else {
          log('Could not initialize recorder');
          throw new Error('Could not initialize recorder');
        }
      }
      return this.recorder;
    }
    if (this.mode === 'replay') {
      if (!this.replayer) {
        if (this.incomingTargetConfig !== undefined && this.outgoingPort !== undefined) {
          this.replayer = new Replayer(
            this.incomingTargetConfig.targetUrl, this.outgoingPort,
            this.pathFromScenarioName(this.scenarioName), this.print,
          );
        } else {
          log('Count not initialize replayer');
          throw new Error('Could not initialize replayer');
        }
      }
      return this.replayer;
    }
    return assertNever(this.mode);
  }

  /**
   * Compute the absolute path to a scenario from its plain string name
   * @param name scenario name
   * @returns the absolute path to this scenario on the file system
   */
  private pathFromScenarioName(name: string): string {
    return pathJoin(this.scenarioDir, name);
  }

}

function asyncMiddleware(middleware: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(middleware(req, res, next)).catch(next);
  };
}
