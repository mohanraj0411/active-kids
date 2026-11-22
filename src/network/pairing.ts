import { normalizeWebSocketUrl } from './address';
import { NETWORK_PROTOCOL_VERSION } from './networkConstants';
import type { ReceiverDescriptor } from './receiverTypes';

export interface ReceiverPairingData {
  type: 'activekids-receiver';
  protocolVersion: number;
  receiverId: string;
  receiverName: string;
  endpoint: string;
  pairingCode: string;
}

export function buildReceiverQrData(receiver: ReceiverDescriptor, pairingCode: string): string {
  return JSON.stringify({
    type: 'activekids-receiver',
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    receiverId: receiver.id,
    receiverName: receiver.name,
    endpoint: receiver.endpoint,
    pairingCode,
  } satisfies ReceiverPairingData);
}

export function parseReceiverQrData(raw: string): ReceiverPairingData | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(candidate)) return null;
  const endpoint = typeof candidate.endpoint === 'string'
    ? normalizeWebSocketUrl(candidate.endpoint)
    : null;
  if (
    candidate.type !== 'activekids-receiver' ||
    candidate.protocolVersion !== NETWORK_PROTOCOL_VERSION ||
    typeof candidate.receiverId !== 'string' || candidate.receiverId.length > 100 ||
    typeof candidate.receiverName !== 'string' || candidate.receiverName.length > 80 ||
    !endpoint ||
    typeof candidate.pairingCode !== 'string' || !/^\d{6}$/.test(candidate.pairingCode)
  ) return null;
  return {
    type: 'activekids-receiver',
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    receiverId: candidate.receiverId,
    receiverName: candidate.receiverName,
    endpoint,
    pairingCode: candidate.pairingCode,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
