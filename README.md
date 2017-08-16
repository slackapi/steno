# Steno

Steno is a tool for recording and replaying HTTP requests and responses, to and from the Slack Platform, in order to
develop integration tests for a Slack App.

In record mode, steno is a two-way HTTP proxy that captures each request and response that passes through it (initiated
from either the Slack App or the Slack Platform) and writes them to disk as **scenarios**.

In replay mode, steno behaves as a mock for the Slack Platform by responding to HTTP requests from the Slack App, or by
creating HTTP requests for your Slack App to handle. In this mode steno also allows the developer to make assertions on
each interaction in order to verify the behavior of the Slack App.

## Building

Prerequisites: You must install the correct version of node (`>= v8`) and npm (`>= v5`). If you use nvm, you can run
`nvm use` in the project directory to switch node versions.

Install dependencies: `npm install`

Build the application: `npm run build`

## Running

Once the application is built, you can run it as `node bin/cli.js <command>`.

If you'd like to build and run all in one step, just use the `npm start <command>` script.

There are a few `<command>`s available, which you can list with the `help` command.

You can also see help for an individual command by running `help <command>`.

## Distributing

You can build binaries for each of the supported platforms (MacOS, Linux, Windows) by running `npm run dist` and
the executables will be inside the `pkg` directory.

## Known Limitations

Replay mode will attempt to fire as many incoming requests from the scenario as possible, even in parallel, if there
are all other previous outgoing requests have already been matched. We're investigating a better solution so that
you can describe scenarios here those requests should occur serially. Feedback welcome!

Response URL requests, Incoming Webhooks requests, and any requests to an origin other than 'https://slack.com' do not
work yet.

Request trailers are not currently supported.

Replaying of chunked encoding requests has not been tested.


## Ideas

specify scenario directory on command line

pass some sort of target URL config into the CLI (and let the default one handle matching slack.com and hooks.slack.com)

create a scenario format module that has a `.parse()` method and a `.stringify()` method.

bug: process crashes when there's nobody listening at appBaseUrl?

concept of building a graph of what to do when based on "triggers" like before request, after request, before response, after response, after timeout relative to some other trigger?

ignore date header on matching and on replay, its clearly not supposed to be accurate

add an extension to files?

OpenAPI Spec of control API -> generate steno-control wrappers in all the languages!

extend the interaction format to include metadata

separate types for matchingrequestinfo / matchingresponseinfo from actual requestinfo / responseinfo from history request and history response

should meta.durationMs be between the loading and the /stop call instead? the current value is something the end user could compute anyway

current unmatched counts reflect interactions that are in the scenario but didn't get match anything that happened. what about things that happened that didn't match any interactions in the scenario?
