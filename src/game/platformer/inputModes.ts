import type { HorizontalMovement } from '../../motion/controllerTypes';

export type PlatformerInputMode = 'BODY' | 'TOUCH' | 'ASSIST';

/** Camera and whole-body gates apply only to the full Body mode. */
export function canStartGame(
  mode: PlatformerInputMode,
  cameraReady: boolean,
  fullBodyVisible: boolean,
): boolean {
  return mode !== 'BODY' || (cameraReady && fullBodyVisible);
}

/** Body Assist makes small torso leans easier to use; touch remains available. */
export function amplifyAssistMovement(movement: HorizontalMovement): HorizontalMovement {
  if (movement.direction === 0 || movement.intensity <= 0) return { direction: 0, intensity: 0 };
  return {
    direction: movement.direction,
    intensity: Math.min(1, Math.max(0, movement.intensity * 1.4)),
  };
}
