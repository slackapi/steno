// import debug from 'debug';
import { Service } from '../steno';
import { Device } from '../controller';
import { assignErrorIdentifier, PrintFn } from '../util';
import { createProxy, HttpProxy, ProxyTargetConfig } from './http-proxy';
import { HttpSerializer } from './http-serializer';

// const log = debug('steno:recorder');

/**
 * Records bidirectional HTTP traffic to disk as a man-in-the-middle. A recorder is composed of two
 * proxy serviers: one called the outgoing proxy and another called the incoming proxy. The outgoing
 * proxy takes requests from the application and forwards them to the external service. The incoming
 * proxy does the opposite: takes requests from the external service and forwards them to the
 * application. Responses are similarly forwarded from end to another.
 */
export class Recorder implements Service, Device {

  /** the serializer responsible for writing HTTP interactions to disk */
  private serializer: HttpSerializer;
  /** the outgoing proxy */
  private outgoingProxy: HttpProxy;
  /** the port for the outgoing proxy to listen on */
  private outgoingPort: string | number;
  /** the incoming proxy */
  private incomingProxy: HttpProxy;
  /** the URL where the internal proxy will forward requests onto (application) */
  private incomingTargetUrl: string;
  /** the port for the incoming proxy to listen on */
  private incomingPort: string | number;
  /** a function used to display messages to the user */
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

  /**
   * Sets the path on disk where the recorder will store HTTP interactions
   * @param storagePath absolute path on disk
   * @returns promise that resolves when the recorder is ready to record new requests and responses
   */
  public setStoragePath(storagePath: string): Promise<void> {
    return this.serializer.setStoragePath(storagePath);
  }

  /**
   * Starts the recorder
   * @returns promise that resolves when the recorder is ready to record new requests and responses
   */
  public start(): Promise<void> {
    return Promise.all([
      assignErrorIdentifier(this.outgoingProxy.listen(this.outgoingPort), 'outgoing'),
      assignErrorIdentifier(this.incomingProxy.listen(this.incomingPort), 'incoming'),
      this.serializer.initialize(),
    ])
      .then(() => {
        this.print(`Recording (incoming on port: ${this.incomingPort}, ` +
          `outgoing on port: ${this.outgoingPort})`);
        this.print(`Incoming requests forwarded to: ${this.incomingTargetUrl}`);
      })
      .catch((error) => {
        if (error.code === 'EADDRINUSE') {
          let option = '';
          let port: string | number = '';
          if (error.identifier === 'outgoing') {
            option = '--out-port';
            port = this.outgoingPort;
          } else {
            option = '--in-port';
            port = this.incomingPort;
          }
          this.print(`The ${error.identifier} port ${port} is already in use. ` +
            `Try choosing a different port by explicitly using the \`${option}\` option.`);
          throw error;
        }
        this.print(`Recorder failed to start: ${error.message}`);
        throw error;
      });
  }
}

