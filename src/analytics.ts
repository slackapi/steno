import Insight from 'insight'; // tslint:disable-line import-name
const pkg = require('../package.json'); // tslint:disable-line no-require-imports no-var-requires

/**
 * A probe can be requested by any object in order to implement its analytics tracking
 */
export interface Probe {
  track(action: string): void;
}

/**
 * A Google Analytics probe is a concrete implementation of Probe that sends its tracked events
 * to Google Analytics.
 */
class GoogleAnalyticsProbe implements Probe {
  private insight: Insight;

  constructor(private name: string, trackingId: string) {
    this.insight = new Insight({
      pkg,
      trackingCode: trackingId,
    });
  }

  /**
   * Tracking is only enabled when the project is built in release mode. Otherwise this method
   * is a no-op. This helps prevent development noise from being captured in Google Analytics.
   *
   * @param action an action name that this probe should track
   */
  public track(action: string): void {
    // @ifdef RELEASE
    this.insight.trackEvent({
      action,
      category: this.name,
    });
    // @endif
  }
}

/**
 * Any object can request a probe for itself by calling this function
 *
 * @param name a name for the probe, typically the type of object that requested it
 */
export function getProbe(name: string): Probe {
  return new GoogleAnalyticsProbe(name, pkg.analytics.googleTrackingId);
}

/**
 * A function that prompts the user for permission for analytics and blocks until either a response
 * is given, or a timeout is met.
 *
 * @returns whether the user opted into analytics
 */
export function prompt(): Promise<boolean> {
  // instantiate a dummy insight in order to use its instance method
  const dummy = new Insight({
    pkg,
    trackingCode: pkg.analytics.googleTrackingId,
  });
  if (dummy.optOut === undefined) {
    return new Promise((resolve, reject) => {
      dummy.askPermission(undefined, (error: Error, optIn: boolean) => {
        if (error) return reject(error);
        resolve(optIn);
      });
    });
  }
  return Promise.resolve(!dummy.optOut);
}
