import type { PoseResult } from '../detection/types';
import { analyzeBody } from './analysis';
import { HandRaiseDetector } from './gestures/handRaise';
import { JumpDetector } from './gestures/jump';
import { LateralMovementDetector } from './gestures/lateralMovement';
import { SquatDetector } from './gestures/squat';
import { clampUnit } from './geometry';
import { PoseSmoother } from './smoothing/PoseSmoother';
import { EMPTY_BODY, MOTION_CONFIG } from './thresholds';
import type {
  GestureEvent,
  GestureState,
  MotionHighlights,
  MotionResult,
} from './types';

/** Stateful, framework-free pose-to-motion pipeline. Reuse one instance per camera session. */
export class MotionEngine {
  private readonly smoother = new PoseSmoother();
  private readonly handRaiseDetector = new HandRaiseDetector();
  private readonly squatDetector = new SquatDetector();
  private readonly jumpDetector = new JumpDetector();
  private readonly lateralMovementDetector = new LateralMovementDetector();

  reset(): void {
    this.smoother.reset();
    this.handRaiseDetector.reset();
    this.squatDetector.reset();
    this.jumpDetector.reset();
    this.lateralMovementDetector.reset();
  }

  processPose(rawPose: PoseResult): MotionResult {
    if (!isReliablePose(rawPose)) {
      this.reset();
      return createEmptyResult(
        getTimestamp(rawPose),
        rawPose.detected,
        clampUnit(rawPose.confidence),
      );
    }

    return this.processSmoothedPose(this.smoother.smooth(rawPose));
  }

  /** Process a pose already passed through the shared Phase 3 smoother. */
  processSmoothedPose(smoothedPose: PoseResult): MotionResult {
    const timestamp = getTimestamp(smoothedPose);
    const confidence = clampUnit(smoothedPose.confidence);

    if (!isReliablePose(smoothedPose)) {
      this.reset();
      return createEmptyResult(timestamp, smoothedPose.detected, confidence);
    }

    const analysis = analyzeBody(smoothedPose);
    const hands = this.handRaiseDetector.process(
      smoothedPose,
      analysis,
      timestamp,
    );
    const squat = this.squatDetector.process(analysis, timestamp);
    const jump = this.jumpDetector.process(
      analysis,
      squat.state.active,
      timestamp,
    );
    const movement = this.lateralMovementDetector.process(analysis, timestamp);
    const events: GestureEvent[] = [];
    appendEvents(events, hands.events);
    appendEvents(events, squat.events);
    appendEvents(events, jump.events);
    appendEvents(events, movement.events);

    const gestures: GestureState[] = [
      hands.left,
      hands.right,
      hands.both,
      squat.state,
      jump.state,
      movement.left,
      movement.right,
    ];

    return {
      timestamp,
      personDetected: true,
      confidence,
      gestures,
      events,
      body: analysis.body,
      trustedLandmarks: analysis.trustedLandmarks,
      squatPhase: squat.phase,
      jumpPhase: jump.phase,
      movementDirection: movement.direction,
    };
  }
}

function isReliablePose(pose: PoseResult): boolean {
  return pose.detected && clampUnit(pose.confidence) >= MOTION_CONFIG.minPoseConfidence;
}

function getTimestamp(pose: PoseResult): number {
  return Number.isFinite(pose.timestamp) ? pose.timestamp : Date.now();
}

export function getMotionHighlights(result: MotionResult | null): MotionHighlights {
  if (!result?.personDetected) {
    return { leftArm: false, rightArm: false, lowerBody: false };
  }

  return {
    leftArm: isGestureActive(result, 'LEFT_HAND_UP') ||
      isGestureActive(result, 'BOTH_HANDS_UP'),
    rightArm: isGestureActive(result, 'RIGHT_HAND_UP') ||
      isGestureActive(result, 'BOTH_HANDS_UP'),
    lowerBody: isGestureActive(result, 'SQUAT') || isGestureActive(result, 'JUMP'),
  };
}

function isGestureActive(
  result: MotionResult,
  type: GestureState['type'],
): boolean {
  for (const gesture of result.gestures) {
    if (gesture.type === type) return gesture.active && gesture.available;
  }
  return false;
}

function appendEvents(target: GestureEvent[], source: readonly GestureEvent[]): void {
  for (const event of source) target.push(event);
}

function createEmptyResult(
  timestamp: number,
  personDetected: boolean,
  confidence: number,
): MotionResult {
  const gestureTypes: GestureState['type'][] = [
    'LEFT_HAND_UP',
    'RIGHT_HAND_UP',
    'BOTH_HANDS_UP',
    'SQUAT',
    'JUMP',
    'MOVE_LEFT',
    'MOVE_RIGHT',
  ];

  return {
    timestamp,
    personDetected,
    confidence,
    gestures: gestureTypes.map((type) => ({
      type,
      active: false,
      confidence: 0,
      available: false,
    })),
    events: [],
    body: { ...EMPTY_BODY },
    trustedLandmarks: {},
    squatPhase: 'unknown',
    jumpPhase: 'unknown',
    movementDirection: 'UNKNOWN',
  };
}
