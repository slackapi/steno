import { join as pathJoin } from 'path';
import debug = require('debug');
import normalizePort = require('normalize-port');
import normalizeUrl = require('normalize-url');
import yargs = require('yargs');
import { Controller, ControllerMode } from './controller';
import { ProxyTargetConfig, ProxyTargetRule } from './record/http-proxy';
import { PrintFn } from 'steno';

const log = debug('steno:cli');

export default function main() {
  const parser = yargs
    .option('record', {
      desc: 'Start steno in record mode.',
      boolean: true,
      global: false,
      conflicts: 'replay',
    })
    .option('replay', {
      desc: 'Start steno in replay mode.',
      boolean: true,
      global: false,
      conflicts: 'record',
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
    // NOTE: this is a hidden option because steno don't yet handle use cases outside of Slack API
    .option('external-url', {
      string: true,
      global: true,
      hidden: true,
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

  const argv = parser.parse(process.argv.slice(2));

  log('arguments %O', argv);

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

  if (mode !== undefined) {
    const internalUrl = argv.internalUrl || argv.appBaseUrl;
    const controller = createController(
      mode, normalizePort(argv.controlPort), argv.scenarioName, argv.scenarioDir,
      normalizeUrl(internalUrl), normalizePort(argv.inPort),
      undefined, normalizePort(argv.outPort),
    );
    controller.start();
  } else {
    parser.showHelp();
  }
}

function createController(
  // TODO: incomingRequestTargetUrl, inPort, and outPort should be optional
  initialMode: ControllerMode, controlPort: string, scenarioName: string, scenarioDir: string,
  incomingRequestUrl: string, inPort: string,
  outgoingRequestUrl: string | undefined, outPort: string,
  print: PrintFn = console.log,
): Controller {
  const absoluteScenarioDir = pathJoin(process.cwd(), scenarioDir);

  const incomingProxyTargetConfig: ProxyTargetConfig = {
    targetUrl: incomingRequestUrl,
  };

  // TODO: conditionally read from configuration where parameters are not defined
  const outgoingProxyTargetConfig: ProxyTargetConfig = {
    targetUrl: outgoingRequestUrl || defaultOutgoingRequestUrl(),
  };
  outgoingProxyTargetConfig.rules =
    defaultOutgoingRequestRules(outgoingProxyTargetConfig.targetUrl);

  return new Controller(
    initialMode, controlPort, scenarioName, absoluteScenarioDir,
    incomingProxyTargetConfig, inPort,
    outgoingProxyTargetConfig, outPort,
    print,
  );
}

function defaultOutgoingRequestUrl(): string {
  // Slack-specific defaults
  const slackEnvironment = process.env.SLACK_ENV;
  const outHostPrefix = slackEnvironment ? `${slackEnvironment}.` : '' ;
  const outTargetHost = `${ outHostPrefix }slack.com`;
  return `https://${ outTargetHost }`;
}

function defaultOutgoingRequestRules(outTargetHost: string): ProxyTargetRule[] {
  // Slack-specific defaults
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
          // hostname is preferred over host (which includes port)
          host: null,
          hostname: `hooks.${outTargetHost}`,
        });
      }
      return optsBefore;
    },
    type: 'requestOptionRewrite',
  };
  return [hooksSubdomainRewriteRule];
}

// TODO: how do i get this module augmentation out of this file?
declare module 'yargs' {
  interface Argv {
    wrap(sentinal: null): Argv;
  }
}

