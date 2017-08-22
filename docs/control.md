# Steno Control API

The control API allows you to program the state and behavior of Steno.

## Set Scenario Name

- **Mode**: record only
- **Method**: `POST`
- **Path**: `/scenario`
- **Request Content Type**: `application/json`
- **Request Parameters**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `name` | string (required) | The name for the scenario directory where recordings should be stored - if it doesn't exist, it will be created. | `"app_installation_success"` |
- **Response Content Type**: `application/json`
- **Response Properties**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `name` | string | The name of the scenario directory - the directory exists when the response is sent. | `"app_installation_success"` |

## Get Scenario Name

- **Mode**: record only
- **Method**: `GET`
- **Path**: `/scenario`
- **Response Content Type**: `application/json`
- **Response Properties**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `name` | string | The name of the scenario directory where recordings are currently being stored | `"app_installation_success"` |


## Start Scenario Replay

- **Mode**: replay only
- **Method**: `POST`
- **Path**: `/start`
- **Request Content Type**: `application/json`
- **Request Parameters**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `name` | string (required) | The name of the scenario directory to be loaded and replayed | `"app_installation_success"` |
- **Response Content Type**: `application/json`
- **Response Properties**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `name` | string | The name of the scenario directory - the directory is loaded and will soon begin replay when the response is sent. | `"app_installation_success"` |

## Stop Scenario Replay

- **Mode**: replay only
- **Method**: `POST`
- **Path**: `/stop`
- **Response Content Type**: `application/json`
- **Response Properties**

  | Property Name | Type | Description | Example |
  | --- | --- | --- | --- |
  | `interactions` | Object[] | An object describing the actual HTTP interactions that took place during replay |  |
  | `interactions[].direction` | string | Whether the request described is incoming (to your `appBaseUrl`) or outgoing (to the Slack platform) | `"incoming"`
  | `interactions[].request` | Object | A record of the request in this interaction |  |
  | `interactions[].request.timestamp` | number | The time since the unix epoch represented in milliseconds | `1502487343000` |
  | `interactions[].request.method` | string | The HTTP request method | `"GET"` |
  | `interactions[].request.url` | string | The components of the URL known as the path and query | `"/foo/bar?a=5"` |
  | `interactions[].request.headers` | Object | Key value pairs for each of the HTTP request headers | `{ "content-type": "application/x-www-form-urlencoded" }` |
  | `interactions[].request.body` | string (optional) | The body of the request as a string - if any content encoding was applied, this is the result after decoding | `"a=5"` |
  | `interactions[].response` | Object | A record of the response in ths interaction |  |
  | `interactions[].response.timestamp` | number | The time since the unix epoch represented in milliseconds | `1502487343000` |
  | `interactions[].response.statusCode` | number | The HTTP response's status code | `200` |
  | `interactions[].response.headers` | Object | Key value pairs for each of the HTTP response headers | `{ "content-type": "application/x-www-form-urlencoded" }` |
  | `interactions[].response.body` | string (optional) | The body of the response as a string - if any content encoding was applied, this is the result after decoding | `"a=5"` |
  | `meta` | Object | An object describing information about the scenario replay as a whole |  |
  | `meta.durationMs` | number | The number of milliseconds that the entire scenario replay lasted | `37` |
  | `meta.unmatchedCount` | Object | Counts for interactions in the scenario that are never occurred in the replay |  |
  | `meta.unmatchedCount.incoming` | number | The number of incoming requests that were not replayed | `0` |
  | `meta.unmatchedCount.outgoing` | number | The number of outgoing requests that were not replayed | `0` |
