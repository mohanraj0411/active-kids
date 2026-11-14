import type { BodyAnalysis } from '../analysis';
import { clampUnit } from '../geometry';
import { MOTION_CONFIG } from '../thresholds';
import type {
  GestureEvent,
  GestureState,
  MovementDirection,
} from '../types';

export interface LateralMovementOutput {
  left: GestureState;
  right: GestureState;
  direction: MovementDirection;
  events: GestureEvent[];
}

type StableDirection = 'LEFT' | 'RIGHT' | 'STABLE';

export class LateralMovementDetector {
  private anchorX: number | null = null;
  private direction: StableDirection = 'STABLE';
  private candidate: StableDirection | null = null;
  private candidateFrames = 0;

  reset(): void {
    this.anchorX = null;
    this.direction = 'STABLE';
    this.candidate = null;
    this.candidateFrames = 0;
  }

  process(analysis: BodyAnalysis, timestamp: number): LateralMovementOutput {
    const centerX = analysis.center?.x;
    const scale = analysis.scale;
    const quality = Math.min(
      analysis.center?.confidence ?? 0,
      analysis.scaleConfidence,
    );
    const available =
      centerX !== undefined &&
      scale !== null &&
      scale > 1e-6 &&
      quality >= MOTION_CONFIG.gestureConfidenceThreshold;

    if (!available || centerX === undefined || scale === null) {
      this.candidate = null;
      this.candidateFrames = 0;
      return makeOutput(this.direction, 0, false, []);
    }

    if (this.anchorX === null) {
      this.anchorX = centerX;
    }

    const offset = centerX - this.anchorX;
    const enterDistance = scale * MOTION_CONFIG.lateralEnterScale;
    const releaseDistance = scale * MOTION_CONFIG.lateralReleaseScale;
    let nextDirection: StableDirection = this.direction;

    if (this.direction === 'STABLE') {
      if (offset <= -enterDistance) nextDirection = 'LEFT';
      else if (offset >= enterDistance) nextDirection = 'RIGHT';
      else nextDirection = 'STABLE';
    } else if (this.direction === 'LEFT') {
      if (offset >= enterDistance) nextDirection = 'RIGHT';
      else if (offset >= -releaseDistance) nextDirection = 'STABLE';
    } else if (this.direction === 'RIGHT') {
      if (offset <= -enterDistance) nextDirection = 'LEFT';
      else if (offset <= releaseDistance) nextDirection = 'STABLE';
    }

    const events: GestureEvent[] = [];
    if (nextDirection === this.direction) {
      this.candidate = null;
      this.candidateFrames = 0;
      if (this.direction === 'STABLE') {
        this.anchorX += (centerX - this.anchorX) * MOTION_CONFIG.lateralBaselineAdaptation;
      }
    } else {
      if (nextDirection !== this.candidate) {
        this.candidate = nextDirection;
        this.candidateFrames = 1;
      } else {
        this.candidateFrames += 1;
      }

      if (this.candidateFrames >= MOTION_CONFIG.stableFrames) {
        this.direction = nextDirection;
        this.candidate = null;
        this.candidateFrames = 0;
        if (this.direction === 'STABLE') {
          this.anchorX = centerX;
        } else {
          events.push({
            type: this.direction === 'LEFT' ? 'MOVE_LEFT' : 'MOVE_RIGHT',
            timestamp,
          });
        }
      }
    }

    const distanceRatio = Math.abs(offset) / Math.max(enterDistance, 1e-6);
    const confidence = clampUnit(
      quality *
        (this.direction === 'STABLE'
          ? 1
          : Math.max(MOTION_CONFIG.lateralActiveConfidenceFloor, distanceRatio)),
    );
    return makeOutput(this.direction, confidence, true, events);
  }
}

function makeOutput(
  direction: StableDirection,
  confidence: number,
  available: boolean,
  events: GestureEvent[],
): LateralMovementOutput {
  return {
    left: {
      type: 'MOVE_LEFT',
      active: direction === 'LEFT',
      confidence: direction === 'LEFT' ? confidence : 0,
      available,
    },
    right: {
      type: 'MOVE_RIGHT',
      active: direction === 'RIGHT',
      confidence: direction === 'RIGHT' ? confidence : 0,
      available,
    },
    direction: available ? direction : 'UNKNOWN',
    events,
  };
}
