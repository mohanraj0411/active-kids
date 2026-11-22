import type { HorizontalMovement } from '../../motion/controllerTypes';

export type GameInputSource = 'BODY' | 'TOUCH' | 'GAMEPAD' | 'NETWORK';

/** Source-neutral actions accepted by the platformer input boundary. */
export type GameAction =
  | { type: 'MOVE'; movement: HorizontalMovement }
  | { type: 'RUN'; active: boolean }
  | { type: 'JUMP' }
  | { type: 'ATTACK' }
  | { type: 'CROUCH'; active: boolean }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESTART' };
