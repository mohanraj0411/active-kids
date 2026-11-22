import { NETWORK_PROTOCOL_VERSION } from './networkConstants';

export type ReachabilityStatus = 'PASS' | 'FAIL';

export interface ReceiverReachabilityResult {
  status: ReachabilityStatus;
  message: string;
}

interface ReceiverHealthResponse {
  status?: unknown;
  protocolVersion?: unknown;
}

/** Checks the receiver's HTTP health route separately from the WebSocket handshake. */
export async function checkReceiverReachability(
  endpoint: string,
  timeoutMs = 2_500,
): Promise<ReceiverReachabilityResult> {
  let healthUrl: URL;
  try {
    healthUrl = new URL(endpoint);
    if (healthUrl.protocol === 'ws:') healthUrl.protocol = 'http:';
    else if (healthUrl.protocol === 'wss:') healthUrl.protocol = 'https:';
    else return { status: 'FAIL', message: 'Receiver address is not a WebSocket URL.' };
    healthUrl.pathname = '/health';
    healthUrl.search = '';
    healthUrl.hash = '';
  } catch {
    return { status: 'FAIL', message: 'Receiver address is invalid.' };
  }

  if (typeof globalThis.fetch !== 'function' || typeof globalThis.AbortController !== 'function') {
    return { status: 'FAIL', message: 'HTTP reachability checks are unavailable on this device.' };
  }

  const abortController = new AbortController();
  const timeout = globalThis.setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(healthUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: abortController.signal,
    });
    if (!response.ok) {
      return { status: 'FAIL', message: `Receiver health check returned HTTP ${response.status}.` };
    }
    const health = await response.json() as ReceiverHealthResponse;
    if (health.status !== 'ok') {
      return { status: 'FAIL', message: 'Receiver health response was invalid.' };
    }
    if (health.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
      return { status: 'FAIL', message: 'Receiver network protocol is unsupported.' };
    }
    return { status: 'PASS', message: 'Receiver HTTP health route responded.' };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'FAIL',
      message: timedOut ? 'Receiver health check timed out.' : 'Receiver health route is unreachable.',
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
