import { createMotionEvent, GameInputController } from '../game/platformer/GameInputController';
import type { MotionEventType } from '../motion/controllerTypes';
import {
  NETWORK_HEARTBEAT_TIMEOUT_MS,
} from './networkConstants';
import {
  NetworkManager,
  type NetworkScheduler,
} from './NetworkManager';
import type { NetworkMessage } from './protocol';

declare const __DEV__: boolean;

export interface TVControllerSnapshot {
  phoneConnected: boolean;
  lastSequence: number;
  lastEvent: MotionEventType | null;
  latencyMs: number | null;
  lastPhoneHeartbeatAt: number | null;
}

export interface TVControllerOptions {
  scheduler?: NetworkScheduler;
  heartbeatTimeoutMs?: number;
  onChange?: (snapshot: TVControllerSnapshot) => void;
  onLog?: (message: string) => void;
  onGameInput?: () => void;
}

/** Validates remote input again at the game boundary and releases held actions on loss. */
export class TVController {
  private readonly scheduler: NetworkScheduler;
  private readonly heartbeatTimeoutMs: number;
  private readonly onChange?: TVControllerOptions['onChange'];
  private readonly onLog?: TVControllerOptions['onLog'];
  private readonly onGameInput?: TVControllerOptions['onGameInput'];
  private readonly unsubscribeMessages: () => void;
  private readonly unsubscribeState: () => void;
  private timeoutTimer: unknown = null;
  private sessionId: string | null = null;
  private phoneConnected = false;
  private lastSequence = 0;
  private lastEvent: MotionEventType | null = null;
  private latencyMs: number | null = null;
  private lastPhoneHeartbeatAt: number | null = null;
  private running = false;
  private crouching = false;
  private disposed = false;

  constructor(
    private readonly network: NetworkManager,
    private readonly gameInput: GameInputController,
    options: TVControllerOptions = {},
  ) {
    if (network.role !== 'TV_HOST') {
      throw new Error('TVController requires a TV_HOST network role.');
    }
    this.scheduler = options.scheduler ?? {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? NETWORK_HEARTBEAT_TIMEOUT_MS;
    this.onChange = options.onChange;
    this.onLog = options.onLog;
    this.onGameInput = options.onGameInput;
    this.unsubscribeMessages = network.subscribeMessages((message) => this.handleMessage(message));
    this.unsubscribeState = network.subscribe((snapshot) => {
      if (snapshot.state !== 'CONNECTED') this.releaseHeldInputs('TV network disconnected');
    });
    this.scheduleTimeoutCheck();
  }

  getSnapshot(): TVControllerSnapshot {
    return {
      phoneConnected: this.phoneConnected,
      lastSequence: this.lastSequence,
      lastEvent: this.lastEvent,
      latencyMs: this.latencyMs,
      lastPhoneHeartbeatAt: this.lastPhoneHeartbeatAt,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeMessages();
    this.unsubscribeState();
    if (this.timeoutTimer !== null) this.scheduler.clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.releaseHeldInputs('TV controller disposed', false);
  }

  /** Exposed for deterministic tests and diagnostics. */
  checkHeartbeatTimeout(now = this.scheduler.now()): boolean {
    if (
      this.phoneConnected &&
      this.lastPhoneHeartbeatAt !== null &&
      now - this.lastPhoneHeartbeatAt > this.heartbeatTimeoutMs
    ) {
      this.phoneConnected = false;
      this.releaseHeldInputs('Phone heartbeat timed out');
      this.log('Phone heartbeat timed out; released RUN and CROUCH');
      this.emit();
      return true;
    }
    return false;
  }

  private handleMessage(message: NetworkMessage): void {
    switch (message.type) {
      case 'WELCOME': {
        if (message.clientRole !== 'TV_HOST') return;
        if (this.sessionId !== message.sessionId) {
          this.releaseHeldInputs('Network session changed');
          this.sessionId = message.sessionId;
          this.lastSequence = 0;
          this.lastEvent = null;
          this.lastPhoneHeartbeatAt = null;
          this.phoneConnected = false;
          this.emit();
        }
        break;
      }
      case 'PEER_STATUS':
        if (message.sessionId !== this.sessionId) return;
        this.phoneConnected = message.phoneConnected;
        if (!message.phoneConnected) this.releaseHeldInputs('Phone disconnected');
        else this.lastPhoneHeartbeatAt ??= this.scheduler.now();
        this.emit();
        break;
      case 'HEARTBEAT_ACK':
        if (message.sessionId !== this.sessionId || message.role !== 'PHONE_CONTROLLER') return;
        this.phoneConnected = true;
        this.lastPhoneHeartbeatAt = this.scheduler.now();
        this.emit();
        break;
      case 'INPUT':
        this.acceptInput(message);
        break;
      case 'DISCONNECT':
        if (message.sessionId !== this.sessionId || message.role !== 'PHONE_CONTROLLER') return;
        this.phoneConnected = false;
        this.releaseHeldInputs(message.reason ?? 'Phone disconnected');
        this.emit();
        break;
      default:
        break;
    }
  }

  private acceptInput(message: Extract<NetworkMessage, { type: 'INPUT' }>): void {
    if (
      message.sessionId !== this.sessionId ||
      message.sessionId !== this.network.getSnapshot().sessionId
    ) {
      this.log(`Rejected INPUT ${message.event}: session mismatch`);
      return;
    }
    if (!this.phoneConnected) {
      this.log(`Rejected INPUT ${message.event}: phone is not connected`);
      return;
    }
    if (message.sequence <= this.lastSequence) {
      this.log(`Rejected stale INPUT seq=${message.sequence}`);
      return;
    }

    this.lastSequence = message.sequence;
    this.lastEvent = message.event;
    this.latencyMs = Math.max(0, this.scheduler.now() - message.timestamp);
    const event = createMotionEvent(message.event, message.timestamp, message.confidence);
    this.gameInput.handleMotionEvent(event);
    if (message.event === 'RUN_START') this.running = true;
    else if (message.event === 'RUN_STOP') this.running = false;
    else if (message.event === 'CROUCH_START') this.crouching = true;
    else if (message.event === 'CROUCH_END') this.crouching = false;
    this.onGameInput?.();
    this.log(`INPUT ${message.event} seq=${message.sequence} latency~${Math.round(this.latencyMs)}ms`);
    this.emit();
  }

  private releaseHeldInputs(reason: string, publish = true): void {
    let changed = false;
    if (this.running) {
      this.gameInput.handleDeveloperInput('RUN_STOP');
      this.running = false;
      changed = true;
    }
    if (this.crouching) {
      this.gameInput.handleDeveloperInput('CROUCH_END');
      this.crouching = false;
      changed = true;
    }
    if (changed) {
      if (publish) this.onGameInput?.();
      this.log(`${reason}; released held inputs`);
    }
  }

  private scheduleTimeoutCheck(): void {
    if (this.disposed) return;
    this.timeoutTimer = this.scheduler.setTimeout(() => {
      this.timeoutTimer = null;
      this.checkHeartbeatTimeout();
      this.scheduleTimeoutCheck();
    }, Math.min(500, this.heartbeatTimeoutMs));
  }

  private emit(): void {
    this.onChange?.(this.getSnapshot());
  }

  private log(message: string): void {
    if (typeof __DEV__ !== 'undefined' && __DEV__) this.onLog?.(`[NETWORK] ${message}`);
  }
}
