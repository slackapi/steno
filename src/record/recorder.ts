// import debug = require('debug');
import { PrintFn, Service } from 'steno';
import { Device } from '../controller';

import { createProxy, HttpProxy, ProxyTargetConfig } from './http-proxy';
import { HttpSerializer } from './http-serializer';

// const log = debug('steno:recorder');

// A recorder is composed of two proxy servers: one called the outgoing proxy and another called the
// incoming proxy. The outgoing proxy takes requests from the application and forwards them to the
// external service. The incoming proxy does the opposite: takes requests from the external service
// and fowards them to the application.
export class Recorder implements Service, Device {
  private serializer: HttpSerializer;
  private outgoingProxy: HttpProxy;
  private outgoingPort: string | number;
  private incomingProxy: HttpProxy;
  private incomingTargetUrl: string;
  private incomingPort: string | number;
  private print: PrintFn;

  constructor(
    incomingTargetConfig: ProxyTargetConfig, incomingPort: string | number,
    outgoingTargetConfig: ProxyTargetConfig, outgoingPort: string | number,
    storagePath: string,
    print: PrintFn = console.log,
  ) {
    this.serializer = new HttpSerializer(storagePath);

    this.outgoingProxy = createProxy(outgoingTargetConfig);
    this.outgoingPort = outgoingPort;

    this.incomingProxy = createProxy(incomingTargetConfig);
    this.incomingTargetUrl = incomingTargetConfig.targetUrl;
    this.incomingPort = incomingPort;

    this.outgoingProxy.on('request', (info) => {
      return this.serializer.onRequest(info, `${Date.now()}_outgoing`);
    });
    // this.outgoingProxy.on('request', this.serializer.onRequest);
    this.outgoingProxy.on('response', this.serializer.onResponse);
    this.incomingProxy.on('request', (info) => {
      return this.serializer.onRequest(info, `${Date.now()}_incoming`);
    });
    // this.incomingProxy.on('request', this.serializer.onRequest);
    this.incomingProxy.on('response', this.serializer.onResponse);

    this.print = print;
  }

  public setStoragePath(storagePath: string): Promise<void> {
    return this.serializer.setStoragePath(storagePath);
  }

  public start(): Promise<void> {
    return Promise.all([
      this.outgoingProxy.listen(this.outgoingPort),
      this.incomingProxy.listen(this.incomingPort),
      this.serializer.initialize(),
    ])
      .then(() => {
        this.print(`Recording (incoming on port: ${this.incomingPort}, ` +
          `outgoing on port: ${this.outgoingPort})`);
        this.print(`Incoming requests forwarded to: ${this.incomingTargetUrl}`);
      })
      .catch((error) => {
        this.print(`Recorder failed to start: ${error.message}`);
        throw error;
      });
  }
}
