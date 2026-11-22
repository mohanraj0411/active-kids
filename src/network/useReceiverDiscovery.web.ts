import type { ReceiverDiscoverySnapshot } from './receiverTypes';

export function useReceiverDiscovery(_retryKey = 0): ReceiverDiscoverySnapshot {
  return {
    state: 'UNAVAILABLE',
    receivers: [],
    message: 'Automatic discovery needs the phone app. Scan the receiver QR code or use developer connection.',
  };
}
