export const NETWORK_PROTOCOL_VERSION = 1 as const;
export const NETWORK_HOST_PORT = 8_765;
export const NETWORK_SOCKET_PATH = '/ws';

export const NETWORK_HEARTBEAT_INTERVAL_MS = 1_000;
export const NETWORK_HEARTBEAT_TIMEOUT_MS = 3_500;
export const NETWORK_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;
export const NETWORK_MAX_MESSAGE_BYTES = 8_192;

