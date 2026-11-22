import type { ReceiverDiscoverySnapshot } from './receiverTypes';

/** TypeScript fallback; native and web builds use their platform-specific implementation. */
export function useReceiverDiscovery(_retryKey = 0): ReceiverDiscoverySnapshot {
  return {
    state: 'UNAVAILABLE',
    receivers: [],
    message: 'Automatic discovery is unavailable. Scan the receiver QR code instead.',
  };
}
