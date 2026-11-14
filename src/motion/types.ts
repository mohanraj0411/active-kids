import type { PoseLandmarkName } from '../detection/types';

export type GestureType =
  | 'LEFT_HAND_UP'
  | 'RIGHT_HAND_UP'
  | 'BOTH_HANDS_UP'
  | 'SQUAT'
  | 'JUMP'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT';

export type GestureEventType =
  | 'LEFT_HAND_RAISED'
  | 'LEFT_HAND_RELEASED'
  | 'RIGHT_HAND_RAISED'
  | 'RIGHT_HAND_RELEASED'
  | 'BOTH_HANDS_RAISED'
  | 'BOTH_HANDS_RELEASED'
  | 'SQUAT_STARTED'
  | 'SQUAT_COMPLETED'
  | 'JUMP'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT';

export interface GestureState {
  type: GestureType;
  active: boolean;
  confidence: number;
  /** False means there were not enough reliable landmarks to evaluate this state. */
  available: boolean;
}

export interface GestureEvent {
  type: GestureEventType;
  timestamp: number;
}

export type SquatPhase = 'standing' | 'lowering' | 'squat' | 'rising' | 'unknown';
export type JumpPhase = 'standing' | 'preparing' | 'airborne' | 'landing' | 'unknown';
export type MovementDirection = 'LEFT' | 'RIGHT' | 'STABLE' | 'UNKNOWN';

export interface MotionBody {
  centerX: number | null;
  centerY: number | null;
  shoulderWidth: number | null;
  torsoHeight: number | null;
  /** Positive when the wrist is above its shoulder, measured in body-scale units. */
  leftHandHeight: number | null;
  rightHandHeight: number | null;
  leftKneeAngle: number | null;
  rightKneeAngle: number | null;
}

export interface MotionResult {
  timestamp: number;
  personDetected: boolean;
  confidence: number;
  gestures: GestureState[];
  events: GestureEvent[];
  body: MotionBody;
  trustedLandmarks: TrustedLandmarks;
  squatPhase: SquatPhase;
  jumpPhase: JumpPhase;
  movementDirection: MovementDirection;
}

/** Presentation-only mask used by the camera overlay; recognition lives in the motion engine. */
export interface MotionHighlights {
  leftArm: boolean;
  rightArm: boolean;
  lowerBody: boolean;
}

export type TrustedLandmarks = Partial<Record<PoseLandmarkName, MotionPoint>>;

export interface MotionPoint {
  x: number;
  y: number;
  confidence: number;
}
