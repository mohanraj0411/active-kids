import type { MotionResult } from './types';

export type MotionType = 'IDLE' | 'RUN' | 'JUMP' | 'ARM_SWING' | 'CROUCH';

export type HorizontalDirection = -1 | 0 | 1;

export interface HorizontalMovement {
  direction: HorizontalDirection;
  intensity: number;
}

export interface BodyLeanState extends HorizontalMovement {
  /** Lean angle relative to the calibrated neutral pose. */
  angleDegrees: number;
  /** Absolute torso angle measured from the camera frame. */
  rawAngleDegrees: number | null;
  trackingConfidence: number;
  isTracking: boolean;
  calibrated: boolean;
  calibrating: boolean;
}

export const NEUTRAL_HORIZONTAL_MOVEMENT: Readonly<HorizontalMovement> = Object.freeze({
  direction: 0,
  intensity: 0,
});

export type MotionEventType =
  | 'RUN_START'
  | 'RUN_STOP'
  | 'JUMP'
  | 'ARM_SWING'
  | 'CROUCH_START'
  | 'CROUCH_END';

export interface MotionEvent {
  type: MotionEventType;
  timestamp: number;
  confidence: number;
  motion: MotionType;
}

export type ContinuousMotionState = 'IDLE' | 'RUN' | 'CROUCH';
export type JumpControllerPhase = 'GROUNDED' | 'AIRBORNE' | 'LANDING';

export interface MotionControllerDiagnostics {
  state: ContinuousMotionState;
  confidence: number;
  run: {
    active: boolean;
    leftKneeVelocityScalePerSecond: number | null;
    rightKneeVelocityScalePerSecond: number | null;
    alternations: number;
    windowSamples: number;
  };
  jump: {
    phase: JumpControllerPhase;
    hipUpVelocityScalePerSecond: number | null;
    leftFootRiseScale: number | null;
    rightFootRiseScale: number | null;
    cooldownRemainingMs: number;
  };
  arm: {
    leftWristVelocityScalePerSecond: number | null;
    rightWristVelocityScalePerSecond: number | null;
    cooldownRemainingMs: number;
  };
  crouch: { active: boolean; confidence: number };
  lastEvent: MotionEvent | null;
}

export interface MotionControllerUpdate {
  events: MotionEvent[];
  state: ContinuousMotionState;
  motionResult: MotionResult;
  diagnostics: MotionControllerDiagnostics;
}
