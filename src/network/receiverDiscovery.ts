import { normalizeWebSocketUrl } from './address';
import { NETWORK_PROTOCOL_VERSION } from './networkConstants';
import type { ReceiverDescriptor } from './receiverTypes';

export interface ReceiverServiceRecord {
  name: string;
  host: string;
  ipv4: string[];
  port: number;
  txt: Record<string, string>;
}

/** Converts a DNS-SD result into a local receiver target, ignoring unrelated services. */
export function parseReceiverService(service: ReceiverServiceRecord): ReceiverDescriptor | null {
  if (service.txt.deviceType !== 'receiver') return null;
  const version = Number(service.txt.protocolVersion);
  const host = service.ipv4[0] ?? service.host.replace(/\.$/, '');
  const endpoint = normalizeWebSocketUrl(`${formatHost(host)}:${service.port}`);
  const id = service.txt.id;
  if (
    version !== NETWORK_PROTOCOL_VERSION ||
    typeof id !== 'string' || !id ||
    !endpoint ||
    !Number.isInteger(service.port) || service.port < 1 || service.port > 65_535
  ) return null;
  return {
    id,
    name: service.txt.deviceName || service.name,
    host,
    port: service.port,
    endpoint,
    discoveryMethod: 'mDNS',
    protocolVersion: version,
  };
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
