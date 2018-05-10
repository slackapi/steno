import { join as pathJoin } from 'path';
import debug from 'debug';
import normalizePort from 'normalize-port';
import normalizeUrl from 'normalize-url';
import yargs from 'yargs';
import { prompt as analyticsPrompt } from './analytics';
import { Controller, ControllerMode } from './controller';
import { ProxyTargetConfig } from './record/http-proxy';
import { PrintFn } from './util';
import { StenoHook } from './steno';

const log = debug('steno:cli');

export default async function main(): Promise<void> {
  const parser = yargs(process.argv.slice(2))
    .option('record', {
      desc: 'Start steno in record mode.',
      boolean: true,
      global: false,
    })
    .option('replay', {
      desc: 'Start steno in replay mode.',
      boolean: true,
      global: false,
    })
    .option('internal-url', {
      alias: 'app',
      default: 'localhost:5000',
      desc: 'The internal URL where your application is listening. In record mode, requests ' +
            'served from in-port are forwarded to this URL. In replay mode, incoming ' +
            'interactions\' requests are sent to this URL.',
      string: true,
      global: true,
    })
    .option('external-url', {
      default: 'https://slack.com',
      desc: 'The external URL to which steno will forward requests that are recieved on out-port. ' +
            'Only valid in recoed mode.',
      string: true,
      global: true,
    })
    .option('in-port', {
      alias: 'in',
      default: '3010',
      desc: 'The port where incoming requests are served by forwarding to the internal URL. Only ' +
            'valid in record mode.',
      string: true,
      global: true,
    })
    .option('out-port', {
      alias: 'out',
      default: '3000',
      desc: 'The port where outgoing requests are served either (in record mode) by forwarding ' +
            'to the external service (Slack API) or (in replay mode) by responding from matched ' +
            'interactions in the current scenario.',
      string: true,
      global: true,
    })
    .option('control-port', {
      alias: 'c',
      default: '4000',
      desc: 'The port where the control API is served',
      string: true,
      global: true,
    })
    .option('scenario-dir', {
      default: './scenarios',
      desc: 'The directory where all scenarios are recorded to or replayed from. Relative to ' +
            'current working directory.',
      normalize: true,
      string: true,
      global: true,
    })
    .option('scenario-name', {
      default: 'untitled_scenario',
      desc: 'The initial scenario. This name is used for the subdirectory of scenario-dir where ' +
            'interactions will be recorded to or replayed from.',
      string: true,
      global: true,
    })
    // Slack-specific options (can be generalized into plugin system later)
    .option('slack-replace-tokens', {
      default: false,
      desc: 'Whether to replace Slack API tokens seen in request bodies. NOTE: When this option ' +
            'is set, sensitive data may appear on stdout. Only valid in record mode.',
      boolean: true,
      global: true,
    })
    .option('slack-detect-subdomain', {
      default: true,
      desc: 'Whether to replace the subdomain in outgoing requests to Slack based on patterns in ' +
            'the path. This must be set in order for incoming webhooks, slash command request ' +
            'URLs, and interactive component request URLs to proxy correctly. Only valid in ' +
            'record mode.',
      boolean: true,
      global: true,
    })
    // NOTE: the following commands are legacy and can be removed in 2.x
    .command('record <appBaseUrl>', '(DEPRECATED: use --record) start recording scenarios', {
      appBaseUrl: {
        demandOption: true,
        desc: 'The base URL where all incoming requests from the Slack Platform are targetted. ' +
              'Incoming requests have the protocol, hostname, and port removed, and are sent to ' +
              'a combination of this URL and the path. (Alias for option internal-url)',
        string: true,
      },
    })
    .command('replay <appBaseUrl>', '(DEPRECATED: use --replay) start replaying scenarios', {
      appBaseUrl: {
        demandOption: true,
        desc: 'The base URL where all recorded requests from the replaying server are targetted. ' +
              '(Alias for option internal-url)',
        string: true,
      },
    })
    .example('$0 --record', 'Starts steno in record mode with defaults for the control-port, ' +
            'in-port, out-port, internal-url, scenario-dir, and scenario-name.')
    .example('$0 --record --app localhost:3000 --out 5000', 'Starts steno in record mode and  ' +
            'customizes the internal-url and out-port')
    .example('$0 --replay', 'Starts steno in replay mode with defaults for the control-port, ' +
            'out-port, internal-url, scenario-dir, and scenario-name.')
    .strict()
    // TODO: enable the completion functionality
    // .completion()
    // TODO: enable the config functionality
    // .config()
    .wrap(null)
    .epilogue('for more information, visit https://slackapi.github.io/steno');

  const argv = parser.parse();

  log('arguments %O', argv);

  // Workaround for https://github.com/yargs/yargs/issues/929
  if (argv.record && argv.replay) {
    console.log('The record and replay options cannot be used together.\n');
    parser.showHelp();
    return;
  }

  const mode: ControllerMode | undefined = (() => {
    if (argv.record) { return 'record'; }
    if (argv.replay) { return 'replay'; }
    // legacy command compatibility
    // TODO: explicitly warn user when using deprecated command
    const firstPositionalArgument = argv._[0];
    if (firstPositionalArgument === 'record') { return 'record'; }
    if (firstPositionalArgument === 'replay') { return 'replay'; }
    return undefined;
  })();

  if (mode === undefined) {
    parser.showHelp();
    return;
  }

  const internalUrl = normalizeUrl(argv.internalUrl || argv.appBaseUrl);
  const externalUrl = normalizeUrl(argv.externalUrl);

  // Load hooks
  const hooks: StenoHook[] = await (() => {
    // TODO: lots of code repetition to reduce
    let loading: Promise<StenoHook[]> = Promise.resolve([]);
    if (argv.slackDetectSubdomain) {
      loading = loading.then(loaded => import('./hooks/slack-detect-subdomain').then((module) => {
        loaded.push(module.createHook(externalUrl));
        return loaded;
      }));
    }
    if (argv.slackReplaceTokens) {
      // NOTE: what about responses that contain a token? currently, this is only the `oauth.access`
      // and `oauth.token` Web API methods.
      loading = loading.then(loaded => import('./hooks/slack-replace-tokens').then((module) => {
        loaded.push(module.createHook(console.log));
        return loaded;
      }));
    }
    return loading;
  })();

  const controller = createController(
    mode, normalizePort(argv.controlPort), argv.scenarioName, argv.scenarioDir,
    internalUrl, normalizePort(argv.inPort),
    externalUrl, normalizePort(argv.outPort),
    hooks,
  );

  analyticsPrompt()
    .then(() => controller.start())
    .catch((error) => {
      debug(`Terminating due to error: ${error.message}`);
      // TODO: calling process.exit() is discouraged by node
      process.exit(1);
    });
}

function createController(
  initialMode: ControllerMode, controlPort: string, scenarioName: string, scenarioDir: string,
  incomingRequestUrl: string, inPort: string,
  outgoingRequestUrl: string, outPort: string,
  hooks: StenoHook[] = [],
  print: PrintFn = console.log,
): Controller {
  const absoluteScenarioDir = pathJoin(process.cwd(), scenarioDir);

  const incomingProxyTargetConfig: ProxyTargetConfig = {
    targetUrl: incomingRequestUrl,
  };

  // TODO: conditionally read from configuration where parameters are not defined
  // TODO: can this just be a URL now that rules has been removed? what about a more atomic
  // proxyconfig that encapsulates the port and the targetUrl?
  const outgoingProxyTargetConfig: ProxyTargetConfig = {
    targetUrl: outgoingRequestUrl,
  };

  return new Controller(
    initialMode, controlPort, scenarioName, absoluteScenarioDir,
    incomingProxyTargetConfig, inPort,
    outgoingProxyTargetConfig, outPort,
    hooks,
    print,
  );
}
