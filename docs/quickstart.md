# Getting Started with Steno

Steno is your sidekick for developing tests for your Slack app. It's based on recording and replaying HTTP requests and
responses to and from your app. Once you start using Steno, you'll be able to run tests on your app without worrying
about manually recreating state in actual Slack workspaces (or teams) or manually reproducing events just to verify that
your app is behaving the way it should. Hello, automation and continuous integation! :wave:

It doesn't matter which language you chose to program with or how your app is structured, Steno is a CLI tool that
starts a server outside your process, so as long as your app speaks HTTP (all Slack apps do), your ready to go!

## The Workflow

Steno is easiest to use with a specific workflow. For many of you, this might look familiar and that's because its based
on tried-and-true integration testing patterns. But let's get out of the jargon and jump straight into it.

1. Pick a behavior in your app that you want to test. Start with something relatively small and self-contained. To
   illustrate, let's say your app will send a DM to the installing user as soon as it gets installed on a team. If
   this behavior is something you've already implemented in your app, great! If not, implement it by using the Slack
   APIs directly until you have it working the way you like.

2. It's time to record, smile! Just kidding, no cameras please :camera:. In **record mode** Steno helps you build
   **scenarios**, which are directories inside your project that contain text files, each one describing one HTTP
   request and response. In order for Steno to record, you need to adjust your code so that instead of sending
   requests to `https://slack.com/...`, it sends requests to a local server that Steno will start, by default this
   would be `http://localhost:3000/...`. Steno will also record requests that are coming **into** your app that
   originate from the Slack Platform. You may already have a tunneling tool like [ngrok set
   up](https://api.slack.com/tutorials/tunneling-with-ngrok) to let the Slack Platform reach your app's local server.
   You can continue to use it, but instead of wiring ngrok up to forward requests directly to a port your app is
   listening on, you substitute the port Steno is listening on, which by default is 3010. The last piece of wiring we
   need is to let Steno know where to forward those requests, in this example we'll say that the app is listening on
   port 5000, so the `appBaseUrl` is `localhost:5000`. We're ready to open our terminal, navigate to a test directory
   in your project, and run the tool in record mode: `steno record localhost:5000`.

3. With your sidekick Steno :couple: standing by, you can run your first test. Pick your favorite test runner and
   write a test case that stimulates the behavior you chose. Following from our example, you would write a case that
   completes the OAuth flow for installing your Slack app and your app should behave by exchanging the code for an
   access token, storing the token, and sending a DM to the installing user. Conclude your test case by asserting that
   your app is in the state it should be, namely that the token has been stored. But how do we assert that the DM was
   sent containing the message we intended to be sent? Read on, and we'll find out.

4. Use Steno's **control API** to load scenarios :vhs:. Terminate the `steno` command in your
   terminal and let's take a look at what we have. You should find that there's a new directory called `scenarios/` in the
   directory you ran the command from. Inside that directory, you should see another directory called
   `untitled_scenario` which contains the record of all the HTTP interactions your app and Slack just made. Let's
   rename that directory to something useful such as `successfull_installation_will_dm_installing_user`. Before we can
   replay this scenario, we need to add setup code to our test case so Steno is prepared to run this particular
   scenario. This can be done by making a request to Steno's control API, which be default is served on port 4000. For
   example, with curl this looks like
   `curl -X POST -H "Content-Type: application/json" -d "{ "name":"successfull_installation_will_dm_installing_user" }" http://localhost:4000/start`.
   Depending on your language or HTTP client of choice, you'll turn this into code to place in your test case's set up.

5. Steno's control API equips you to answer our burning question :fire:, can we assert that our DM was sent? With one
   more request at the end of your test case, you recieve data about what actually happened and how it stacks up
   against our recorded scenario. Here is another curl example for this request:
   `curl -X POST http://localhost:4000/stop`. I'll cut to the chase and give you a preview of what you should expect
   back so you can begin to write some assertions in your test case:

   ```json
   {
     "interactions": [
       {
         "direction": "outgoing",
         "request": {
           "timestamp": 1502487343000,
           "method": "POST",
           "url": "/api/oauth.access",
           "headers": {
             "content-type": "application/x-www-form-urlencoded",
             ...
           },
           "body": "client_id=00000000000.999999999999&client_secret=e9eab23fd04e44c8d1b640e876d39d92&code=00000000000.111111111111.b5fc60d60ec8d65301fcda44028a135bc27cec7ac476938df3b2b15aac73af42&redirect_uri=http%3A%2F%2Fexample.com%2Fcallback"
         },
         "response": {
           "timestamp": 1502487343002,
           "statusCode": 200,
           "headers": {
             "content-type": "application/json; charset=utf-8",
             ...
           },
           "body": "{\"ok\":true,\"access_token\":\"xoxp-00000000000-11111111111-222222222222-900cf8de83f771f22932027dd9c36dc5\",\"scope\":\"identify,bot\",\"user_id\":\"U11111111\",\"\"bot\":{\"bot_user_id\":\"U00000000\",\"bot_access_token\":\"xoxb-000000000000-I2XejP8axGr15Mz5JHFOKMCe\"}}"
         }
       },
       {
         "direction": "outgoing",
         "request": {
           "timestamp": 1502487343005,
           "method": "POST",
           "url": "/api/chat.postMessage",
           "headers": {
             "content-type": "application/x-www-form-urlencoded",
             ...
           },
           "body": "token=xoxb-000000000000-I2XejP8axGr15Mz5JHFOKMCe&channel=U11111111&text=Hello%2C%20I%27m%20ExampleBot"
         },
         "response": {
           "timestamp": 1502487343006,
           "statusCode": 200,
           "headers": {
             "content-type": "application/json; charset=utf-8",
             ...
           },
           "body": "{\"ok\":true,\"channel\":\"D33333333\",\"ts\":\"0000000000.999999\",\"message\":{\"text\":\"Hello, I\'m ExampleBot\",\"username\":\"ExampleBot\",\"bot_id\":\"B44444444\",\"type\":\"message\",\"subtype\":\"bot_message\",\"ts\":\"0000000000.999999\"}}"
         }
       }
     ],
     "meta": {
       "durationMs": 12,
       "unmatchedCount": {
         "incoming": 0,
         "outgoing": 0
       }
     }
   }
   ```

   This represents a comprehensive history of what Steno witnessed since you loaded the scenario with the request
   to `/start`. For now, let's make a basic assertion by writing the code to parse this output, and
   verify that the last request has a `url` property equal to `"/api/chat.postMessage"`, and that the response's `body`
   property contains `ok:true`.

6. Pull the plug :electric_plug: and let Steno handle the interactions in **replay mode**. Let's go back to the command
   line and launch steno with a slightly different command: `steno replay localhost:5000`. Run your new test case and
   watch those assertions succeed :white_check_mark:! (and if not, maybe that's a good thing and you just caught a bug).

7. Scrub the code and the scenarios of any tokens or secrets :speak_no_evil:, commit them to your project, rinse and
   repeat! Now you can add running steno in replay mode as a step before starting your test runner in your testing
   scripts. If you have continuous integration set up, you can rest assured that every commit along the way you
   haven't broken your existing behavior :massage:.


**Pro Tip**: This isn't the only way you can use Steno! Even if you don't have access to a specific team or have never
been able to produce a specific event, you could drop a scenario directory into your project, run Steno in replay
mode, and build functionality in your app as if it magically was talking to the Slack Platform for real :sparkles:. You
could even hand-edit scenarios based on what's available in our documentation, or take a scenario from someone else
who recorded them for you.

## Common Questions

* **Q**: I already use {VCR, node-nock, httpretty, or some other HTTP mocking library for tests}, why should I use Steno?

  **A**: You're a rockstar for thinking about testing from the get go! Those tools are fine choices, but Steno still
  has some advantages for you:
  - Two-way proxying: Most other mocking tools are only concerned with *outgoing* requests from your app. But Slack
    also offers notifications using *incoming* requests (Events API, Interactive Messages, etc.). Steno can handle both.
  - Scenarios are a portable exchange format: No matter which language or toolkit you are using, Steno saves scenarios
    in a format we can all read and write, plain old HTTP. This means you can swap scenario files with other developers
    on your team, in the community, or even when filing bugs.

## Known Limitations

Replay mode will attempt to fire as many incoming requests from the scenario as possible, even in parallel, if there
are all other previous outgoing requests have already been matched. We're investigating a better solution so that
you can describe scenarios here those requests should occur serially. Feedback welcome!

Response URL requests, Incoming Webhooks requests, and any requests to an origin other than 'https://slack.com' do not
work yet.

Request trailers are not currently supported.

Replaying of chunked encoding requests has not been tested.

## Feedback

This should be enough information to get you started using Steno and produce some productive test cases that give you
confidence in your code as you build your Slack app. We still have a few new ideas and we'll be shipping with a more
comprehensive set of documentation about all the functionality, as well as a sample project to demonstrate an effective
use of Steno in a real test suite.

We'd love to hear about your experience using Steno, the good and the bad! As beta users, your feedback will be very
influential in how we plan future development. Get in touch with the team by sending feedback to aoberoi@slack-corp.com.

We see Steno as a tool that's for the community and by the community, and we look forward to our open source release
soon.
