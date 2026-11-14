import type { MotionEvent, MotionEventType, MotionType } from '../../motion/controllerTypes';
import { GameController } from './GameController';
import type { DevMotionEventType } from './types';

/** Maps the Phase C event contract to game actions; it contains no pose math. */
export class GameInputController {
  constructor(private readonly game: GameController) {}

  handleMotionEvent(event: MotionEvent): void {
    this.game.noteMotionEvent(event);
    switch (event.type) {
      case 'RUN_START':
        this.game.setRunning(true);
        break;
      case 'RUN_STOP':
        this.game.setRunning(false);
        break;
      case 'JUMP':
        this.game.jump();
        break;
      case 'ARM_SWING':
        this.game.attack();
        break;
      case 'CROUCH_START':
        this.game.setCrouching(true);
        break;
      case 'CROUCH_END':
        this.game.setCrouching(false);
        break;
    }
  }

  /** Dev keys/buttons create the same event shape consumed from MotionController. */
  handleDeveloperInput(type: DevMotionEventType): void {
    this.handleMotionEvent({
      type,
      timestamp: Date.now(),
      confidence: 1,
      motion: getMotionType(type),
    });
  }
}

function getMotionType(type: MotionEventType): MotionType {
  if (type === 'RUN_START' || type === 'RUN_STOP') return 'RUN';
  if (type === 'CROUCH_START' || type === 'CROUCH_END') return 'CROUCH';
  return type;
}
