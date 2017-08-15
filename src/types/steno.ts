import { IncomingHttpHeaders } from 'http';

interface IncomingHttpTrailers {
  [key: string]: string | undefined;
}

export interface RequestInfo {
  body: Buffer | undefined;
  headers: IncomingHttpHeaders;
  httpVersion: string;
  id: string; // internal property and should not be serialized or exposed to the user
  method: string;
  trailers: IncomingHttpTrailers | undefined;
  url: string;
}

export interface ResponseInfo {
  body: Buffer | undefined;
  headers: IncomingHttpHeaders;
  httpVersion: string;
  requestId: string; // foreign key to associate with RequestInfo.id
  statusCode: number;
  statusMessage: string;
  trailers: IncomingHttpTrailers | undefined;
}
