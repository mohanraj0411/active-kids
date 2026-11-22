import { NETWORK_HOST_PORT, NETWORK_SOCKET_PATH } from './networkConstants';

/** Converts an IP, hostname, HTTP URL, or WS URL into the controller endpoint. */
export function normalizeWebSocketUrl(input: string, fallbackHostname?: string): string | null {
  const trimmed = input.trim();
  if (!trimmed && !fallbackHostname) return null;
  const raw = trimmed || `ws://${fallbackHostname}:${NETWORK_HOST_PORT}`;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `ws://${raw}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    if (!url.hostname || url.username || url.password) return null;
    if (!isLocalNetworkHost(url.hostname)) return null;
    if (!url.port) url.port = String(NETWORK_HOST_PORT);
    if (url.pathname === '/' || url.pathname === '') url.pathname = NETWORK_SOCKET_PATH;
    return url.toString();
  } catch {
    return null;
  }
}

export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (
    host === '::1' ||
    (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')))
  ) return true;
  const octets = host.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 127) ||
    (octets[0] === 169 && octets[1] === 254);
}

export function getWebSocketUrlFromWebPage(): string | null {
  if (typeof globalThis.window === 'undefined') return null;
  const location = globalThis.window.location;
  if (Number(location.port) !== NETWORK_HOST_PORT) return null;
  return normalizeWebSocketUrl(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${NETWORK_SOCKET_PATH}`);
}

/** Uses the origin serving the TV receiver web app, including custom ports. */
export function getReceiverWebSocketUrl(): string | null {
  if (typeof globalThis.window === 'undefined') return null;
  const location = globalThis.window.location;
  return normalizeWebSocketUrl(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${NETWORK_SOCKET_PATH}`,
  );
}
