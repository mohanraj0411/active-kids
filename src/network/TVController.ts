import { createMotionEvent, GameInputController } from '../game/platformer/GameInputController';
import type { MotionEventType } from '../motion/controllerTypes';
import {
  NETWORK_HEARTBEAT_TIMEOUT_MS,
  NETWORK_MOVEMENT_TIMEOUT_MS,
} from './networkConstants';
import {
  NetworkManager,
  type NetworkScheduler,
} from './NetworkManager';
import type { NetworkInputAction, NetworkMessage } from './protocol';

declare const __DEV__: boolean;

export interface TVControllerSnapshot {
  phoneConnected: boolean;
  lastSequence: number;
  lastInputTimestamp: number | null;
  lastEvent: MotionEventType | null;
  /** Actual accepted INPUT messages in the trailing one-second window. */
  inputRatePerSecond: number;
  lastPhoneHeartbeatAt: number | null;
  lastAction: NetworkInputAction | null;
  movement: number;
}

export interface TVControllerOptions {
  scheduler?: NetworkScheduler;
  heartbeatTimeoutMs?: number;
  onChange?: (snapshot: TVControllerSnapshot) => void;
  onLog?: (message: string) => void;
  onGameInput?: () => void;
  onControl?: (action: Exclude<NetworkInputAction, 'MOTION_EVENT' | 'MOVE'>) => void;
}

/** Validates remote input again at the game boundary and releases held actions on loss. */
export class TVController {
  private readonly scheduler: NetworkScheduler;
  private readonly heartbeatTimeoutMs: number;
  private readonly onChange?: TVControllerOptions['onChange'];
  private readonly onLog?: TVControllerOptions['onLog'];
  private readonly onGameInput?: TVControllerOptions['onGameInput'];
  private readonly onControl?: TVControllerOptions['onControl'];
  private readonly unsubscribeMessages: () => void;
  private readonly unsubscribeState: () => void;
  private timeoutTimer: unknown = null;
  private sessionId: string | null = null;
  private phoneConnected = false;
  private lastSequence = 0;
  private lastInputTimestamp: number | null = null;
  private lastEvent: MotionEventType | null = null;
  private inputArrivalTimes: number[] = [];
  private inputRatePerSecond = 0;
  private lastPhoneHeartbeatAt: number | null = null;
  private lastMovementAt: number | null = null;
  private movement = 0;
  private lastAction: NetworkInputAction | null = null;
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
    gameInput.selectSource('NETWORK');
    this.scheduler = options.scheduler ?? {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? NETWORK_HEARTBEAT_TIMEOUT_MS;
    this.onChange = options.onChange;
    this.onLog = options.onLog;
    this.onGameInput = options.onGameInput;
    this.onControl = options.onControl;
    this.unsubscribeMessages = network.subscribeMessages((message) => this.handleMessage(message));
    this.unsubscribeState = network.subscribe((snapshot) => {
      if (snapshot.state !== 'CONNECTED') {
        const wasPhoneConnected = this.phoneConnected;
        this.phoneConnected = false;
        this.releaseHeldInputs('TV network disconnected');
        if (wasPhoneConnected) {
          this.onControl?.('PAUSE');
          this.emit();
        }
      }
    });
    this.scheduleTimeoutCheck();
  }

  getSnapshot(): TVControllerSnapshot {
    return {
      phoneConnected: this.phoneConnected,
      lastSequence: this.lastSequence,
      lastInputTimestamp: this.lastInputTimestamp,
      lastEvent: this.lastEvent,
      inputRatePerSecond: this.inputRatePerSecond,
      lastPhoneHeartbeatAt: this.lastPhoneHeartbeatAt,
      lastAction: this.lastAction,
      movement: this.movement,
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
    let timedOut = false;
    const priorRate = this.inputRatePerSecond;
    this.updateInputRate(now);
    if (
      this.movement !== 0 &&
      this.lastMovementAt !== null &&
      now - this.lastMovementAt > NETWORK_MOVEMENT_TIMEOUT_MS
    ) {
      this.releaseMovement('Movement input timed out');
      timedOut = true;
    }
    if (
      this.phoneConnected &&
      this.lastPhoneHeartbeatAt !== null &&
      now - this.lastPhoneHeartbeatAt > this.heartbeatTimeoutMs
    ) {
      this.phoneConnected = false;
      this.releaseHeldInputs('Phone heartbeat timed out');
      this.onControl?.('PAUSE');
      this.log('Phone heartbeat timed out; released RUN and CROUCH');
      this.emit();
      return true;
    }
    if (priorRate !== this.inputRatePerSecond) this.emit();
    return timedOut;
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
        {
          const wasPhoneConnected = this.phoneConnected;
          this.phoneConnected = message.phoneConnected;
          if (!message.phoneConnected) {
            this.releaseHeldInputs('Phone disconnected');
            if (wasPhoneConnected) this.onControl?.('PAUSE');
          } else this.lastPhoneHeartbeatAt ??= this.scheduler.now();
        }
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
        {
          const wasPhoneConnected = this.phoneConnected;
          this.phoneConnected = false;
          this.releaseHeldInputs(message.reason ?? 'Phone disconnected');
          if (wasPhoneConnected) this.onControl?.('PAUSE');
        }
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
    this.lastInputTimestamp = message.timestamp;
    this.lastAction = message.action;
    this.lastEvent = message.event ?? null;
    this.updateInputRate(this.scheduler.now(), true);
    if (message.action === 'MOVE') {
      const value = message.value ?? 0;
      this.movement = value;
      this.lastMovementAt = this.scheduler.now();
      this.running = value !== 0;
      this.gameInput.handleHorizontalMovement({
        direction: value < 0 ? -1 : value > 0 ? 1 : 0,
        intensity: Math.abs(value),
      }, 'NETWORK');
    } else if (message.action === 'MOTION_EVENT' && message.event) {
      const event = createMotionEvent(message.event, message.timestamp, message.confidence ?? 1);
      this.gameInput.handleMotionEvent(event, 'NETWORK');
      if (message.event === 'RUN_START') this.running = true;
      else if (message.event === 'RUN_STOP') this.running = false;
      else if (message.event === 'CROUCH_START') this.crouching = true;
      else if (message.event === 'CROUCH_END') this.crouching = false;
    } else if (message.action !== 'MOTION_EVENT') {
      if (message.action === 'CROUCH_START') this.crouching = true;
      else if (message.action === 'CROUCH_END') this.crouching = false;
      this.onControl?.(message.action);
    }
    this.onGameInput?.();
    this.log(`INPUT ${message.action} seq=${message.sequence}`);
    this.emit();
  }

  private releaseHeldInputs(reason: string, publish = true): void {
    let changed = false;
    if (this.movement !== 0) {
      this.releaseMovement(reason, false);
      changed = true;
    }
    if (this.running) {
      this.gameInput.handleDeveloperInput('RUN_STOP', 'NETWORK');
      this.running = false;
      changed = true;
    }
    if (this.crouching) {
      this.gameInput.handleDeveloperInput('CROUCH_END', 'NETWORK');
      this.crouching = false;
      changed = true;
    }
    if (changed) {
      if (publish) this.onGameInput?.();
      this.log(`${reason}; released held inputs`);
    }
  }

  private releaseMovement(reason: string, publish = true): void {
    if (this.movement === 0) return;
    this.gameInput.handleHorizontalMovement({ direction: 0, intensity: 0 }, 'NETWORK');
    this.movement = 0;
    this.running = false;
    this.lastMovementAt = null;
    if (publish) this.onGameInput?.();
    this.log(`${reason}; released movement`);
  }

  private updateInputRate(now: number, recordInput = false): void {
    const windowStart = now - 1_000;
    this.inputArrivalTimes = this.inputArrivalTimes.filter((timestamp) => timestamp > windowStart);
    if (recordInput) this.inputArrivalTimes.push(now);
    this.inputRatePerSecond = this.inputArrivalTimes.length;
  }

  private scheduleTimeoutCheck(): void {
    if (this.disposed) return;
    this.timeoutTimer = this.scheduler.setTimeout(() => {
      this.timeoutTimer = null;
      this.checkHeartbeatTimeout();
      this.scheduleTimeoutCheck();
    }, Math.min(100, this.heartbeatTimeoutMs));
  }

  private emit(): void {
    this.onChange?.(this.getSnapshot());
  }

  private log(message: string): void {
    if (typeof __DEV__ !== 'undefined' && __DEV__) this.onLog?.(`[NETWORK] ${message}`);
  }
}
