import type {
  HorizontalMovement,
  MotionEvent,
  MotionEventType,
  MotionType,
} from '../../motion/controllerTypes';
import { GameController } from './GameController';
import type { DevMotionEventType } from './types';
import type { GameAction, GameInputSource } from './inputActions';

/** Maps Body, Touch, Gamepad-ready, and Network actions into the local game. */
export class GameInputController {
  private activeSource: GameInputSource = 'BODY';

  constructor(private readonly game: GameController) {}

  get currentSource(): GameInputSource {
    return this.activeSource;
  }

  /** Changing owners always clears held movement and crouch before accepting input. */
  selectSource(source: GameInputSource): void {
    if (source === this.activeSource) return;
    this.game.releaseInputs();
    this.activeSource = source;
  }

  releaseAll(): void {
    this.game.releaseInputs();
  }

  dispatch(source: GameInputSource, action: GameAction): boolean {
    if (source !== this.activeSource) return false;

    const isLifecycle = action.type === 'START' || action.type === 'PAUSE' ||
      action.type === 'RESUME' || action.type === 'RESTART';
    if (!isLifecycle && this.game.currentStatus !== 'PLAYING') {
      if (action.type === 'RUN' && action.active && this.game.currentStatus === 'READY') {
        this.game.setRunning(true);
        return true;
      }
      if (action.type === 'RUN' && !action.active) this.game.releaseInputs();
      if (action.type === 'CROUCH' && !action.active) this.game.releaseInputs();
      if (action.type === 'MOVE' && action.movement.direction === 0) this.game.releaseInputs();
      return false;
    }

    switch (action.type) {
      case 'MOVE':
        this.game.setHorizontalMovement(action.movement);
        return true;
      case 'RUN':
        this.game.setRunning(action.active);
        return true;
      case 'JUMP':
        return this.game.jump();
      case 'ATTACK':
        return this.game.attack();
      case 'CROUCH':
        this.game.setCrouching(action.active);
        return true;
      case 'START':
        if (this.game.currentStatus === 'COMPLETE' || this.game.currentStatus === 'GAME_OVER') this.game.restart();
        this.game.start();
        return true;
      case 'PAUSE':
        this.game.pause();
        return true;
      case 'RESUME':
        this.game.resume();
        return true;
      case 'RESTART':
        this.game.restart();
        this.game.start();
        return true;
    }
  }

  handleMotionEvent(event: MotionEvent, source: GameInputSource = 'BODY'): boolean {
    const action = motionEventToAction(event.type);
    const accepted = this.dispatch(source, action);
    if (accepted) this.game.noteMotionEvent(event);
    return accepted;
  }

  handleHorizontalMovement(
    movement: HorizontalMovement,
    source: GameInputSource = this.activeSource,
  ): boolean {
    return this.dispatch(source, { type: 'MOVE', movement });
  }

  /** Touch buttons and keyboard test helpers share the same action mapping. */
  handleDeveloperInput(type: DevMotionEventType, source: GameInputSource = this.activeSource): boolean {
    return this.handleMotionEvent(createMotionEvent(type), source);
  }
}

function motionEventToAction(type: MotionEventType): GameAction {
  switch (type) {
    case 'RUN_START': return { type: 'RUN', active: true };
    case 'RUN_STOP': return { type: 'RUN', active: false };
    case 'JUMP': return { type: 'JUMP' };
    case 'ARM_SWING': return { type: 'ATTACK' };
    case 'CROUCH_START': return { type: 'CROUCH', active: true };
    case 'CROUCH_END': return { type: 'CROUCH', active: false };
  }
}

export function createMotionEvent(
  type: MotionEventType,
  timestamp = Date.now(),
  confidence = 1,
): MotionEvent {
  return {
    type,
    timestamp,
    confidence,
    motion: getMotionType(type),
  };
}

function getMotionType(type: MotionEventType): MotionType {
  if (type === 'RUN_START' || type === 'RUN_STOP') return 'RUN';
  if (type === 'CROUCH_START' || type === 'CROUCH_END') return 'CROUCH';
  return type;
}
