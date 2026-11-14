import { createMotionEvent } from '../game/platformer/GameInputController';
import type { MotionEvent, MotionEventType } from '../motion/controllerTypes';
import { NetworkManager } from './NetworkManager';

/** Motion-event adapter for a phone. It never reads pose data or camera frames. */
export class PhoneController {
  constructor(private readonly network: NetworkManager) {
    if (network.role !== 'PHONE_CONTROLLER') {
      throw new Error('PhoneController requires a PHONE_CONTROLLER network role.');
    }
  }

  handleMotionEvent(event: MotionEvent): number | null {
    return this.network.sendInput(event);
  }

  sendDeveloperInput(type: MotionEventType): number | null {
    return this.handleMotionEvent(createMotionEvent(type));
  }

  disconnect(): void {
    this.sendDeveloperInput('RUN_STOP');
    this.sendDeveloperInput('CROUCH_END');
    this.network.disconnect('Phone controller disconnected');
  }
}
