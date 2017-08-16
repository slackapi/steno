import Debug = require('debug');
import yargs = require('yargs');
import { startRecordingController } from './record/controller';
import { startReplayingController } from './replay/controller';

const log = Debug('steno:cli');

function print(str: string, ...args: any[]) {
  console.log(str, ...args); // tslint:disable-line no-console
}

const parser = yargs
  .command('record <appBaseUrl>', 'start recording scenarios', {
    'appBaseUrl': {
      demandOption: true,
      desc: 'The base URL where all incoming requests from the Slack Platform are targetted. Incoming requests' +
            'have the protocol, hostname, and port removed, and are sent to a combination of this URL and the path.',
      string: true,
    },
    'control-port': {
      default: '4000',
      desc: 'The port where the control API is served',
      string: true,
    },
    'in-port': {
      default: '3010',
      desc: 'The port where the recording server is listening for requests to forward to the Slack App' +
            ' (where the Slack Platform sends inbound HTTP requests)',
      string: true,
    },
    'out-port': {
      default: '3000',
      desc: 'The port where the recording server is listening for requests to forward to the Slack Platform' +
            ' (where the Slack App sends outbound HTTP requests)',
      string: true,
    },
    'scenario-name': {
      default: 'untitled_scenario',
      desc: 'The directory interactions will be saved to or loaded from',
      string: true,
    },
  }, (argv) => {
    log('record arguments %O', argv);
    // TODO: set a base path for where scenarios are stored
    startRecordingController(
      argv.appBaseUrl,
      argv.controlPort,
      argv.inPort,
      argv.outPort,
      argv.scenarioName,
      print,
    );
  })
  .command('replay <appBaseUrl>', 'start replaying scenarios', {
    'appBaseUrl': {
      demandOption: true,
      // TODO: improve description
      desc: 'The base URL where all recorded requests from the replaying server are targetted',
      string: true,
    },
    'control-port': {
      default: '4000',
      desc: 'The port where the control API is served',
      string: true,
    },
    'out-port': {
      default: '3000',
      desc: 'The port where the replaying server is listening for requests meant for the Slack Platform' +
            ' (where the Slack App sends outbound HTTP requests)',
      string: true,
    },
    'scenario-name': {
      default: 'untitled_scenario',
      desc: 'The directory interactions will be saved to or loaded from',
      string: true,
    },
  }, (argv) => {
    log('replay arguments %O', argv);
    // TODO: set a base path for where scenarios are stored
    startReplayingController(
      argv.appBaseUrl,
      argv.controlPort,
      argv.outPort,
      argv.scenarioName,
      print,
    );
  })
  .demandCommand(1)
  .help();

parser.parse(process.argv.slice(2));
