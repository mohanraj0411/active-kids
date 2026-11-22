import type { HorizontalMovement, MotionEventType } from '../motion/controllerTypes';
import { createMotionEvent, GameInputController } from '../game/platformer/GameInputController';
import type { GameAction } from '../game/platformer/inputActions';
import type { NetworkInputAction } from './protocol';

/** Transport adapter: translates validated receiver protocol messages to game actions. */
export class NetworkInputAdapter {
  constructor(private readonly input: GameInputController) {}

  movement(movement: HorizontalMovement): boolean {
    return this.input.handleHorizontalMovement(movement, 'NETWORK');
  }

  motion(type: MotionEventType, timestamp?: number, confidence?: number): boolean {
    return this.input.handleMotionEvent(createMotionEvent(type, timestamp, confidence), 'NETWORK');
  }

  control(action: Exclude<NetworkInputAction, 'MOTION_EVENT' | 'MOVE'>): boolean {
    const mapped = networkActionToGameAction(action);
    return this.input.dispatch('NETWORK', mapped);
  }
}

export function networkActionToGameAction(
  action: Exclude<NetworkInputAction, 'MOTION_EVENT' | 'MOVE'>,
): GameAction {
  switch (action) {
    case 'JUMP': return { type: 'JUMP' };
    case 'ATTACK': return { type: 'ATTACK' };
    case 'CROUCH_START': return { type: 'CROUCH', active: true };
    case 'CROUCH_END': return { type: 'CROUCH', active: false };
    case 'START_GAME': return { type: 'START' };
    case 'PAUSE': return { type: 'PAUSE' };
    case 'RESUME': return { type: 'RESUME' };
    case 'RESTART': return { type: 'RESTART' };
  }
}
