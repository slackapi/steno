# Steno

[![Build Status](https://travis-ci.org/slackapi/steno.svg?branch=master)](https://travis-ci.org/slackapi/steno)

> ⚠ We are not actively developing the Steno project at this time. Please stay tuned for updated testing tools from your friends at @slackapi 👋

Steno is a tool for recording and replaying HTTP requests and responses, to and from the Slack Platform, in order to
generate testing fixtures for a Slack App.

In record mode, Steno is a two-way HTTP proxy that captures each request and response that passes through it (initiated
from either the Slack App or the Slack Platform) and writes them to disk as **scenarios**.

In replay mode, Steno behaves as a stub for the Slack Platform by responding to HTTP requests from the Slack App, or by
creating HTTP requests for your Slack App to handle. In this mode Steno also allows the developer to make assertions on
each interaction in order to verify the behavior of the Slack App.

[Get started with Steno](https://slackapi.github.io/steno)
