# Steno

Steno is a tool for recording and replaying HTTP requests and responses, to and from the Slack Platform, in order to
generate testing fixtues for a Slack App.

In record mode, Steno is a two-way HTTP proxy that captures each request and response that passes through it (initiated
from either the Slack App or the Slack Platform) and writes them to disk as **scenarios**.

In replay mode, Steno behaves as a stub for the Slack Platform by responding to HTTP requests from the Slack App, or by
creating HTTP requests for your Slack App to handle. In this mode Steno also allows the developer to make assertions on
each interaction in order to verify the behavior of the Slack App.

[Get started with Steno](https://slackapi.github.io/steno)

## Building

Prerequisites: You must install the correct version of node (`>= v8`) and npm (`>= v5`). If you use nvm, you can run
`nvm use` in the project directory to switch node versions.

Install dependencies: `npm install`

Build the application: `npm run build`

## Running

Once the application is built, you can run it as `node bin/cli.js <command>`.

If you'd like to build and run all in one step, just use the `npm start <command>` script.

There are a few `<command>`s available, which you can list with the `help` command.

## Distributing

You can build binaries for each of the supported platforms (macOS, Linux, Windows) by running `npm run dist` and
the executables will be inside the `pkg` directory.
