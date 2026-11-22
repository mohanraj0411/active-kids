import { createMotionEvent } from '../game/platformer/GameInputController';
import type { HorizontalMovement, MotionEvent, MotionEventType } from '../motion/controllerTypes';
import { NetworkManager } from './NetworkManager';
import { NETWORK_MOVEMENT_MIN_INTERVAL_MS } from './networkConstants';
import type { GameEventType, NetworkInputAction } from './protocol';

const MOVEMENT_CHANGE_THRESHOLD = 0.04;

/** Motion-event adapter for a phone. It never reads pose data or camera frames. */
export class PhoneController {
  private lastMovement = 0;
  private lastMovementSentAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly network: NetworkManager) {
    if (network.role !== 'PHONE_CONTROLLER') {
      throw new Error('PhoneController requires a PHONE_CONTROLLER network role.');
    }
  }

  handleMotionEvent(event: MotionEvent): number | null {
    if (event.type === 'RUN_START') return this.sendMovement(1, event.timestamp, true);
    if (event.type === 'RUN_STOP') return this.sendMovement(0, event.timestamp, true);
    if (event.type === 'JUMP') return this.sendControl('JUMP');
    if (event.type === 'ARM_SWING') return this.sendControl('ATTACK');
    if (event.type === 'CROUCH_START') return this.sendControl('CROUCH_START');
    if (event.type === 'CROUCH_END') return this.sendControl('CROUCH_END');
    return this.network.sendInput(event);
  }

  handleMovement(movement: HorizontalMovement, timestamp = Date.now()): number | null {
    const normalized = movement.direction === 0
      ? 0
      : Math.max(-1, Math.min(1, movement.direction * movement.intensity));
    return this.sendMovement(normalized, timestamp, false);
  }

  sendControl(action: Exclude<NetworkInputAction, 'MOTION_EVENT' | 'MOVE'>): number | null {
    return this.network.sendControl(action);
  }

  subscribeGameEvents(listener: (event: GameEventType) => void): () => void {
    return this.network.subscribeGameEvents(listener);
  }

  sendDeveloperInput(type: MotionEventType): number | null {
    return this.handleMotionEvent(createMotionEvent(type));
  }

  disconnect(): void {
    this.sendMovement(0, Date.now(), true);
    this.sendDeveloperInput('CROUCH_END');
    this.network.disconnect('Phone controller disconnected');
  }

  private sendMovement(value: number, timestamp: number, force: boolean): number | null {
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (
      !force &&
      Math.abs(value - this.lastMovement) < MOVEMENT_CHANGE_THRESHOLD &&
      now - this.lastMovementSentAt < NETWORK_MOVEMENT_MIN_INTERVAL_MS
    ) return null;
    if (!force && value !== 0 && now - this.lastMovementSentAt < NETWORK_MOVEMENT_MIN_INTERVAL_MS) return null;
    const sequence = this.network.sendMovement(value);
    if (sequence !== null) {
      this.lastMovement = value;
      this.lastMovementSentAt = now;
    }
    return sequence;
  }
}
