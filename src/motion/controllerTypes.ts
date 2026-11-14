import type { MotionResult } from './types';

export type MotionType = 'IDLE' | 'RUN' | 'JUMP' | 'ARM_SWING' | 'CROUCH';

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
