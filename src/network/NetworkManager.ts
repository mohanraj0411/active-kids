import type { MotionEvent } from '../motion/controllerTypes';
import {
  NETWORK_HEARTBEAT_INTERVAL_MS,
  NETWORK_HEARTBEAT_TIMEOUT_MS,
  NETWORK_MAX_MESSAGE_BYTES,
  NETWORK_PROTOCOL_VERSION,
  NETWORK_RECONNECT_DELAYS_MS,
} from './networkConstants';
import type {
  GameEventType,
  NetworkInputAction,
  NetworkMessage,
  NetworkRole,
} from './protocol';
import { getMotionForEvent, parseNetworkMessage } from './protocol';

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface NetworkSnapshot {
  state: ConnectionState;
  webSocketOpen: boolean;
  role: NetworkRole;
  sessionId: string | null;
  latencyMs: number | null;
  tvConnected: boolean;
  phoneConnected: boolean;
  lastError: string | null;
  nextSequence: number;
  pairingCode: string | null;
  receiverId: string | null;
  receiverName: string | null;
}

interface SocketMessageEventLike {
  data: unknown;
}

interface SocketCloseEventLike {
  code?: number;
  reason?: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: SocketMessageEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: SocketCloseEventLike) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NetworkScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface NetworkManagerOptions {
  socketFactory?: (url: string) => WebSocketLike;
  scheduler?: NetworkScheduler;
  reconnectDelaysMs?: readonly number[];
  clientId?: string;
  pairingCode?: string;
  onLog?: (message: string) => void;
}

const DEFAULT_SCHEDULER: NetworkScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const SOCKET_OPEN = 1;
declare const __DEV__: boolean;

/** Client transport: handshake, heartbeat, sequencing, connection state and retry. */
export class NetworkManager {
  private readonly socketFactory: (url: string) => WebSocketLike;
  private readonly scheduler: NetworkScheduler;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly clientId: string;
  private pairingCode: string | null;
  private reconnectToken: string | null = null;
  private readonly onLog?: (message: string) => void;
  private readonly stateListeners = new Set<(snapshot: NetworkSnapshot) => void>();
  private readonly messageListeners = new Set<(message: NetworkMessage) => void>();
  private readonly gameEventListeners = new Set<(event: GameEventType) => void>();
  private socket: WebSocketLike | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private webSocketOpen = false;
  private sessionId: string | null = null;
  private latencyMs: number | null = null;
  private tvConnected = false;
  private phoneConnected = false;
  private lastError: string | null = null;
  private nextSequence = 1;
  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private lastHeartbeatAckAt: number | null = null;
  private shouldReconnect = false;
  private fatalFailure = false;
  private receiverId: string | null = null;
  private receiverName: string | null = null;
  private nextGameEventSequence = 1;

  constructor(
    private readonly url: string,
    readonly role: NetworkRole,
    options: NetworkManagerOptions = {},
  ) {
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? NETWORK_RECONNECT_DELAYS_MS;
    this.clientId = options.clientId ?? createClientId();
    this.pairingCode = options.pairingCode ?? null;
    this.onLog = options.onLog;
    this.socketFactory = options.socketFactory ?? ((socketUrl) => {
      if (typeof globalThis.WebSocket !== 'function') {
        throw new Error('WebSocket is unavailable in this runtime.');
      }
      return new globalThis.WebSocket(socketUrl) as unknown as WebSocketLike;
    });
  }

  getSnapshot(): NetworkSnapshot {
    return {
      state: this.state,
      webSocketOpen: this.webSocketOpen,
      role: this.role,
      sessionId: this.sessionId,
      latencyMs: this.latencyMs,
      tvConnected: this.tvConnected,
      phoneConnected: this.phoneConnected,
      lastError: this.lastError,
      nextSequence: this.nextSequence,
      pairingCode: this.pairingCode,
      receiverId: this.receiverId,
      receiverName: this.receiverName,
    };
  }

  subscribe(listener: (snapshot: NetworkSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getSnapshot());
    return () => this.stateListeners.delete(listener);
  }

  subscribeMessages(listener: (message: NetworkMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeGameEvents(listener: (event: GameEventType) => void): () => void {
    this.gameEventListeners.add(listener);
    return () => this.gameEventListeners.delete(listener);
  }

  connect(): void {
    if (this.shouldReconnect || this.state === 'CONNECTED' || this.state === 'CONNECTING') return;
    this.shouldReconnect = true;
    this.fatalFailure = false;
    this.reconnectAttempt = 0;
    this.openSocket(false);
  }

  disconnect(reason = 'User disconnected'): void {
    this.shouldReconnect = false;
    this.clearTimer('reconnect');
    this.clearTimer('heartbeat');
    const socket = this.socket;
    this.socket = null;
    this.webSocketOpen = false;
    if (socket?.readyState === SOCKET_OPEN && this.sessionId) {
      this.sendRaw(socket, {
        type: 'DISCONNECT',
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        sessionId: this.sessionId,
        reason: reason.slice(0, 120),
      });
      socket.close(1000, 'Client disconnect');
    } else if (socket && socket.readyState < 2) {
      socket.close(1000, 'Client disconnect');
    }
    this.sessionId = null;
    this.latencyMs = null;
    this.tvConnected = false;
    this.phoneConnected = false;
    this.lastHeartbeatAckAt = null;
    this.setState('DISCONNECTED');
  }

  sendInput(event: MotionEvent): number | null {
    return this.sendInputPacket('MOTION_EVENT', {
      event: event.type,
      confidence: clampUnit(event.confidence),
      motion: getMotionForEvent(event.type),
      timestamp: event.timestamp,
    });
  }

  sendMovement(value: number): number | null {
    if (!Number.isFinite(value)) return null;
    return this.sendInputPacket('MOVE', { value: Math.max(-1, Math.min(1, value)) });
  }

  sendControl(action: Exclude<NetworkInputAction, 'MOTION_EVENT' | 'MOVE'>): number | null {
    return this.sendInputPacket(action, {});
  }

  sendGameEvent(event: GameEventType): number | null {
    if (this.role !== 'TV_HOST' || this.state !== 'CONNECTED' || !this.sessionId) return null;
    const sequence = this.nextGameEventSequence++;
    if (!this.sendRaw(this.socket, {
      type: 'GAME_EVENT',
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      sequence,
      timestamp: this.scheduler.now(),
      event,
    })) return null;
    return sequence;
  }

  private openSocket(isRetry: boolean): void {
    if (!this.shouldReconnect) return;
    this.webSocketOpen = false;
    this.setState(isRetry ? 'RECONNECTING' : 'CONNECTING');
    this.lastError = null;
    this.log(`${isRetry ? 'Reconnecting' : 'Connecting'} to ${this.url}`);
    let socket: WebSocketLike;
    try {
      socket = this.socketFactory(this.url);
    } catch (error) {
      this.lastError = getErrorMessage(error);
      this.setState('ERROR');
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.shouldReconnect) return;
      this.webSocketOpen = true;
      this.emit();
      this.log('WebSocket opened; sending HELLO');
      this.sendRaw(socket, {
        type: 'HELLO',
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        clientId: this.clientId,
        role: this.role,
        ...(this.role === 'PHONE_CONTROLLER'
          ? this.reconnectToken
            ? { reconnectToken: this.reconnectToken }
            : this.pairingCode
              ? { pairingCode: this.pairingCode }
              : {}
          : {}),
      });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data, socket);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.webSocketOpen = false;
      this.lastError = 'WebSocket connection error';
      this.setState('ERROR');
      this.log(this.lastError);
      socket.close(4000, 'WebSocket error');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.webSocketOpen = false;
      this.clearTimer('heartbeat');
      this.lastHeartbeatAckAt = null;
      this.tvConnected = false;
      this.phoneConnected = false;
      if (this.fatalFailure) {
        this.shouldReconnect = false;
        this.setState('ERROR');
        return;
      }
      if (this.shouldReconnect) {
        this.log(`Disconnected${event.reason ? `: ${event.reason}` : ''}`);
        this.scheduleReconnect();
      } else {
        this.setState('DISCONNECTED');
      }
    };
  }

  private handleMessage(raw: unknown, socket: WebSocketLike): void {
    if (typeof raw === 'string' && raw.length > NETWORK_MAX_MESSAGE_BYTES) {
      this.lastError = 'Network message exceeded the size limit';
      this.emit();
      return;
    }
    const parsed = parseNetworkMessage(raw);
    if (!parsed.ok) {
      this.lastError = parsed.reason === 'UNSUPPORTED_PROTOCOL'
        ? 'TV uses an unsupported network protocol version'
        : 'TV sent a malformed network message';
      if (parsed.reason === 'UNSUPPORTED_PROTOCOL') {
        this.fatalFailure = true;
        this.setState('ERROR');
        socket.close(1002, this.lastError);
      } else {
        this.emit();
      }
      this.log(this.lastError);
      return;
    }

    const message = parsed.message;
    if (message.type === 'WELCOME') {
      if (message.clientRole !== this.role) {
        this.lastError = 'Host assigned a different controller role';
        this.fatalFailure = true;
        this.setState('ERROR');
        socket.close(1008, this.lastError);
        return;
      }
      const sessionChanged = this.sessionId !== message.sessionId;
      this.sessionId = message.sessionId;
      if (message.pairingCode) this.pairingCode = message.pairingCode;
      if (message.reconnectToken) this.reconnectToken = message.reconnectToken;
      this.receiverId = message.receiverId ?? null;
      this.receiverName = message.receiverName ?? null;
      if (sessionChanged) {
        this.nextSequence = 1;
        this.nextGameEventSequence = 1;
      }
      this.lastHeartbeatAckAt = this.scheduler.now();
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.setState('CONNECTED');
      this.startHeartbeat(socket);
      this.log(`WELCOME session=${message.sessionId}`);
    } else if (message.type === 'PEER_STATUS') {
      this.tvConnected = message.tvConnected;
      this.phoneConnected = message.phoneConnected;
      this.emit();
    } else if (message.type === 'HEARTBEAT_ACK') {
      if (message.role === this.role) {
        this.latencyMs = Math.max(0, this.scheduler.now() - message.timestamp);
        this.lastHeartbeatAckAt = this.scheduler.now();
        this.emit();
      }
    } else if (message.type === 'ERROR') {
      this.lastError = message.message;
      this.log(`ERROR ${message.code}: ${message.message}`);
      if (message.code === 'PAIRING_REQUIRED' || message.code === 'PAIRING_REJECTED') {
        this.fatalFailure = true;
        this.setState('ERROR');
        socket.close(1008, message.code);
      }
      this.emit();
      if (message.code === 'UNSUPPORTED_PROTOCOL') {
        this.fatalFailure = true;
        this.setState('ERROR');
        socket.close(1002, message.code);
      }
    }

    for (const listener of this.messageListeners) listener(message);
    if (message.type === 'GAME_EVENT') {
      for (const listener of this.gameEventListeners) listener(message.event);
    }
  }

  private sendInputPacket(
    action: NetworkInputAction,
    payload: { event?: MotionEvent['type']; confidence?: number; motion?: MotionEvent['motion']; value?: number; timestamp?: number },
  ): number | null {
    if (this.role !== 'PHONE_CONTROLLER' || this.state !== 'CONNECTED' || !this.sessionId) return null;
    const sequence = this.nextSequence++;
    const message = {
      type: 'INPUT' as const,
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      sequence,
      timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : this.scheduler.now(),
      action,
      ...(payload.event ? { event: payload.event } : {}),
      ...(payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
      ...(payload.motion ? { motion: payload.motion } : {}),
      ...(payload.value !== undefined ? { value: payload.value } : {}),
    };
    if (!this.sendRaw(this.socket, message)) return null;
    this.log(`INPUT ${action} seq=${sequence}`);
    this.emit();
    return sequence;
  }

  private startHeartbeat(socket: WebSocketLike): void {
    this.clearTimer('heartbeat');
    const tick = () => {
      if (this.socket !== socket || this.state !== 'CONNECTED' || !this.sessionId) return;
      const now = this.scheduler.now();
      if (
        this.lastHeartbeatAckAt !== null &&
        now - this.lastHeartbeatAckAt > NETWORK_HEARTBEAT_TIMEOUT_MS
      ) {
        this.lastError = 'Host heartbeat timed out';
        this.setState('RECONNECTING');
        this.log(this.lastError);
        socket.close(4000, 'Heartbeat timeout');
        return;
      }
      this.sendRaw(socket, {
        type: 'HEARTBEAT',
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        sessionId: this.sessionId,
        timestamp: now,
      });
      this.heartbeatTimer = this.scheduler.setTimeout(tick, NETWORK_HEARTBEAT_INTERVAL_MS);
    };
    this.heartbeatTimer = this.scheduler.setTimeout(tick, NETWORK_HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.fatalFailure) return;
    this.clearTimer('heartbeat');
    const index = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delayMs = this.reconnectDelaysMs[index] ?? 5_000;
    this.reconnectAttempt += 1;
    this.setState('RECONNECTING');
    this.log(`Retry scheduled in ${delayMs} ms`);
    this.clearTimer('reconnect');
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, delayMs);
  }

  private sendRaw(socket: WebSocketLike | null, message: object): boolean {
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.lastError = getErrorMessage(error);
      this.emit();
      return false;
    }
  }

  private clearTimer(kind: 'heartbeat' | 'reconnect'): void {
    const handle = kind === 'heartbeat' ? this.heartbeatTimer : this.reconnectTimer;
    if (handle === null) return;
    this.scheduler.clearTimeout(handle);
    if (kind === 'heartbeat') this.heartbeatTimer = null;
    else this.reconnectTimer = null;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      this.emit();
      return;
    }
    this.state = state;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.stateListeners) listener(snapshot);
  }

  private log(message: string): void {
    if (typeof __DEV__ !== 'undefined' && __DEV__) this.onLog?.(`[NETWORK] ${message}`);
  }
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createClientId(): string {
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
