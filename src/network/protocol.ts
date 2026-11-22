import type {
  MotionEventType,
  MotionType,
} from '../motion/controllerTypes';
import { NETWORK_PROTOCOL_VERSION } from './networkConstants';

export type NetworkRole = 'TV_HOST' | 'PHONE_CONTROLLER';
export type NetworkInputAction =
  | 'MOTION_EVENT'
  | 'MOVE'
  | 'JUMP'
  | 'ATTACK'
  | 'CROUCH_START'
  | 'CROUCH_END'
  | 'START_GAME'
  | 'PAUSE'
  | 'RESUME'
  | 'RESTART';
export type GameEventType =
  | 'GAME_STARTED'
  | 'CHECKPOINT_REACHED'
  | 'MISSION_COMPLETED'
  | 'PLAYER_DIED'
  | 'GAME_PAUSED'
  | 'GAME_FINISHED'
  | 'CONNECTION_WARNING';

export type NetworkErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'TV_HOST_OFFLINE'
  | 'ROLE_BUSY'
  | 'SESSION_MISMATCH'
  | 'SEQUENCE_REJECTED'
  | 'PAIRING_REQUIRED'
  | 'PAIRING_REJECTED'
  | 'SERVER_ERROR';

export interface HelloMessage {
  type: 'HELLO';
  protocolVersion: number;
  clientId: string;
  role: NetworkRole;
  pairingCode?: string;
  reconnectToken?: string;
}

export interface WelcomeMessage {
  type: 'WELCOME';
  protocolVersion: number;
  sessionId: string;
  serverRole: 'TV_HOST';
  clientRole: NetworkRole;
  serverTimestamp: number;
  receiverId?: string;
  receiverName?: string;
  pairingCode?: string;
  reconnectToken?: string;
}

export interface InputMessage {
  type: 'INPUT';
  protocolVersion: number;
  sessionId: string;
  sequence: number;
  timestamp: number;
  action: NetworkInputAction;
  event?: MotionEventType;
  confidence?: number;
  motion?: MotionType;
  value?: number;
  /** Added by the relay for latency diagnostics. */
  serverReceivedAt?: number;
}

export interface GameEventMessage {
  type: 'GAME_EVENT';
  protocolVersion: number;
  sessionId: string;
  sequence: number;
  timestamp: number;
  event: GameEventType;
}

export interface HeartbeatMessage {
  type: 'HEARTBEAT';
  protocolVersion: number;
  sessionId: string;
  timestamp: number;
}

export interface HeartbeatAckMessage {
  type: 'HEARTBEAT_ACK';
  protocolVersion: number;
  sessionId: string;
  timestamp: number;
  serverTimestamp: number;
  role: NetworkRole;
}

export interface DisconnectMessage {
  type: 'DISCONNECT';
  protocolVersion: number;
  sessionId: string;
  role?: NetworkRole;
  reason?: string;
}

export interface PeerStatusMessage {
  type: 'PEER_STATUS';
  protocolVersion: number;
  sessionId: string;
  tvConnected: boolean;
  phoneConnected: boolean;
}

export interface ErrorMessage {
  type: 'ERROR';
  protocolVersion: number;
  code: NetworkErrorCode;
  message: string;
}

export type ClientMessage = HelloMessage | InputMessage | HeartbeatMessage | DisconnectMessage;
export type ServerMessage =
  | WelcomeMessage
  | InputMessage
  | GameEventMessage
  | HeartbeatAckMessage
  | DisconnectMessage
  | PeerStatusMessage
  | ErrorMessage;
export type NetworkMessage = ClientMessage | ServerMessage;

export type ParseNetworkMessageResult =
  | { ok: true; message: NetworkMessage }
  | { ok: false; reason: 'INVALID_JSON' | 'INVALID_SHAPE' | 'UNSUPPORTED_PROTOCOL' };

export function parseNetworkMessage(raw: unknown): ParseNetworkMessageResult {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'INVALID_JSON' };
    }
  }

  if (!isRecord(candidate) || !isInteger(candidate.protocolVersion)) {
    return { ok: false, reason: 'INVALID_SHAPE' };
  }
  if (candidate.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_PROTOCOL' };
  }

  const message = candidate;
  switch (message.type) {
    case 'HELLO':
      return isNetworkRole(message.role) && isNonEmptyString(message.clientId) &&
        (message.role === 'TV_HOST'
          ? message.pairingCode === undefined && message.reconnectToken === undefined
          : (isPairingCode(message.pairingCode) && message.reconnectToken === undefined) ||
            (isReconnectToken(message.reconnectToken) && message.pairingCode === undefined))
        ? { ok: true, message: message as unknown as HelloMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'WELCOME':
      return message.serverRole === 'TV_HOST' &&
        isNetworkRole(message.clientRole) &&
        isNonEmptyString(message.sessionId) &&
        isFiniteNumber(message.serverTimestamp) &&
        (message.pairingCode === undefined || isPairingCode(message.pairingCode)) &&
        (message.reconnectToken === undefined || isReconnectToken(message.reconnectToken)) &&
        (message.receiverId === undefined || isNonEmptyString(message.receiverId)) &&
        (message.receiverName === undefined || isNonEmptyString(message.receiverName))
        ? { ok: true, message: message as unknown as WelcomeMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'INPUT':
      return isNonEmptyString(message.sessionId) &&
        isPositiveInteger(message.sequence) &&
        isFiniteNumber(message.timestamp) &&
        isInputAction(message.action) &&
        isValidInputPayload(message) &&
        (message.serverReceivedAt === undefined || isFiniteNumber(message.serverReceivedAt))
        ? { ok: true, message: message as unknown as InputMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'GAME_EVENT':
      return isNonEmptyString(message.sessionId) &&
        isPositiveInteger(message.sequence) &&
        isFiniteNumber(message.timestamp) &&
        isGameEventType(message.event)
        ? { ok: true, message: message as unknown as GameEventMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'HEARTBEAT':
      return isNonEmptyString(message.sessionId) && isFiniteNumber(message.timestamp)
        ? { ok: true, message: message as unknown as HeartbeatMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'HEARTBEAT_ACK':
      return isNonEmptyString(message.sessionId) &&
        isFiniteNumber(message.timestamp) &&
        isFiniteNumber(message.serverTimestamp) &&
        isNetworkRole(message.role)
        ? { ok: true, message: message as unknown as HeartbeatAckMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'DISCONNECT':
      return isNonEmptyString(message.sessionId) &&
        (message.role === undefined || isNetworkRole(message.role)) &&
        (message.reason === undefined || typeof message.reason === 'string')
        ? { ok: true, message: message as unknown as DisconnectMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'PEER_STATUS':
      return isNonEmptyString(message.sessionId) &&
        typeof message.tvConnected === 'boolean' &&
        typeof message.phoneConnected === 'boolean'
        ? { ok: true, message: message as unknown as PeerStatusMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    case 'ERROR':
      return isErrorCode(message.code) && typeof message.message === 'string'
        ? { ok: true, message: message as unknown as ErrorMessage }
        : { ok: false, reason: 'INVALID_SHAPE' };
    default:
      return { ok: false, reason: 'INVALID_SHAPE' };
  }
}

export function isMotionEventType(value: unknown): value is MotionEventType {
  return value === 'RUN_START' || value === 'RUN_STOP' || value === 'JUMP' ||
    value === 'ARM_SWING' || value === 'CROUCH_START' || value === 'CROUCH_END';
}

export function isMotionType(value: unknown): value is MotionType {
  return value === 'IDLE' || value === 'RUN' || value === 'JUMP' ||
    value === 'ARM_SWING' || value === 'CROUCH';
}

export function getMotionForEvent(event: MotionEventType): MotionType {
  if (event === 'RUN_START' || event === 'RUN_STOP') return 'RUN';
  if (event === 'CROUCH_START' || event === 'CROUCH_END') return 'CROUCH';
  return event;
}

export function isErrorCode(value: unknown): value is NetworkErrorCode {
  return value === 'INVALID_MESSAGE' || value === 'UNSUPPORTED_PROTOCOL' ||
    value === 'TV_HOST_OFFLINE' || value === 'ROLE_BUSY' ||
    value === 'SESSION_MISMATCH' || value === 'SEQUENCE_REJECTED' ||
    value === 'PAIRING_REQUIRED' || value === 'PAIRING_REJECTED' ||
    value === 'SERVER_ERROR';
}

export function isInputAction(value: unknown): value is NetworkInputAction {
  return value === 'MOTION_EVENT' || value === 'MOVE' || value === 'JUMP' ||
    value === 'ATTACK' || value === 'CROUCH_START' || value === 'CROUCH_END' ||
    value === 'START_GAME' || value === 'PAUSE' || value === 'RESUME' || value === 'RESTART';
}

export function isGameEventType(value: unknown): value is GameEventType {
  return value === 'GAME_STARTED' || value === 'CHECKPOINT_REACHED' ||
    value === 'MISSION_COMPLETED' || value === 'PLAYER_DIED' ||
    value === 'GAME_PAUSED' || value === 'GAME_FINISHED' || value === 'CONNECTION_WARNING';
}

export function isPairingCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

export function isReconnectToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{48}$/i.test(value);
}

export function isNetworkRole(value: unknown): value is NetworkRole {
  return value === 'TV_HOST' || value === 'PHONE_CONTROLLER';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnitNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isValidInputPayload(message: Record<string, unknown>): boolean {
  if (message.action === 'MOTION_EVENT') {
    return isMotionEventType(message.event) &&
      isUnitNumber(message.confidence) &&
      isMotionType(message.motion) &&
      getMotionForEvent(message.event) === message.motion;
  }
  if (message.action === 'MOVE') {
    return isFiniteNumber(message.value) && message.value >= -1 && message.value <= 1;
  }
  return message.event === undefined && message.value === undefined &&
    message.confidence === undefined && message.motion === undefined;
}
