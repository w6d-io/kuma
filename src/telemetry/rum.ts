/**
 * What happens in the browser, reported only if somebody asked for it.
 *
 * The settings come from the API rather than from the page, so the console inherits the environment
 * and version the service already carries. A browser session and the request it makes filed under
 * different versions of the same deployment is the failure that makes a correlated trace useless
 * exactly when it matters.
 *
 * Nothing here may keep the console from starting. An empty answer, an unreachable API, a collector
 * that refuses — all of them leave the console running and unreported. Telemetry that can refuse to
 * work is telemetry that can take a feature down with it.
 */

export type RumSettings = {
  faroUrl?: string;
  serviceName?: string;
  version?: string;
  environment?: string;
};

/** So a dot in a hostname matches a dot, and not any character. */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let started = false;

export async function startRum(settings: RumSettings | null): Promise<void> {
  if (started || !settings?.faroUrl || !settings.serviceName) return;
  started = true;

  try {
    // Imported only once there is something to report to, so a console with no collector never
    // runs any of it. NOT out of the bundle, though: this build has code splitting off, so the
    // library ships either way and the dynamic import defers execution, not download. Turning
    // splitting on would fix that and the 600 kB single chunk with it — a separate decision.
    const [{ initializeFaro, getWebInstrumentations }, { TracingInstrumentation }] = await Promise.all([
      import('@grafana/faro-web-sdk'),
      import('@grafana/faro-web-tracing'),
    ]);

    initializeFaro({
      url: settings.faroUrl,
      app: {
        name: settings.serviceName,
        version: settings.version,
        environment: settings.environment,
      },
      instrumentations: [
        // Web vitals, uncaught errors, console errors, session tracking.
        ...getWebInstrumentations(),
        new TracingInstrumentation({
          instrumentationOptions: {
            // `traceparent` is NOT a CORS-safelisted header. Sent to an origin that does not allow
            // it, the browser strips it and the two halves of the trace never meet — with no error
            // to read. Restricted to our own origin, which is where the API answers.
            propagateTraceHeaderCorsUrls: [new RegExp(`^${escape(window.location.origin)}`)],
          },
        }),
      ],
    });
  } catch {
    // A collector that cannot be reached is not a reason for an operator to lose the console.
    started = false;
  }
}

/**
 * Asks the API what to report and to where. Answers null on anything unexpected — including a
 * deployment that configures nothing, which is the common case and not an error.
 */
export async function rumSettings(apiBase: string): Promise<RumSettings | null> {
  try {
    const response = await fetch(`${apiBase}/telemetry`, { credentials: 'include' });
    if (!response.ok) return null;
    const settings = (await response.json()) as RumSettings;
    return settings?.faroUrl ? settings : null;
  } catch {
    return null;
  }
}
