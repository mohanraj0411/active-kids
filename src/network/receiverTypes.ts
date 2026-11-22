export interface ReceiverDescriptor {
  id: string;
  name: string;
  host: string;
  port: number;
  endpoint: string;
  discoveryMethod: 'mDNS' | 'QR' | 'MANUAL';
  protocolVersion: number;
}

export type ReceiverDiscoveryState = 'SEARCHING' | 'READY' | 'UNAVAILABLE' | 'PERMISSION_DENIED';

export interface ReceiverDiscoverySnapshot {
  state: ReceiverDiscoveryState;
  receivers: ReceiverDescriptor[];
  message: string | null;
}
