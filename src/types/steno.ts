export interface Service {
  start(): Promise<void>;
}

interface IncomingHttpTrailers {
  [key: string]: string | undefined;
}

export type PrintFn = (str: string, ...args: any[]) => void;

// This type extends the built-in node IncomingHttpHeaders, but because of the way it has been
// described since DefinitelyTyped/DefinitelyTyped#20695, this type cannot formally extend that
// base type. The index includes `undefined` as a value type, when strictly speaking this not
// possible. The only reason it is added is so that other common headers can be named as optional
// properties, so that intellisense has some awareness of those common headers.
export interface NotOptionalIncomingHttpHeaders {
  [header: string]: string | string[];
}

// TODO: maybe split this into two types?
// * "incomplete" (before body and trailers)
// * "complete" (as shown)
export interface RequestInfo {
  body: Buffer | undefined;
  headers: NotOptionalIncomingHttpHeaders;
  httpVersion: string;
  id: string; // internal property and should not be serialized or exposed to the user
  method: string;
  trailers: IncomingHttpTrailers | undefined;
  url: string;
}

// TODO: maybe a similar split as noted above?
export interface ResponseInfo {
  body: Buffer | undefined;
  headers: NotOptionalIncomingHttpHeaders;
  httpVersion: string;
  requestId: string; // foreign key to associate with RequestInfo.id
  statusCode: number;
  statusMessage: string;
  trailers: IncomingHttpTrailers | undefined;
}
