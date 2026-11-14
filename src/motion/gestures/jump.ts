import type { BodyAnalysis } from '../analysis';
import { clampUnit } from '../geometry';
import { MOTION_CONFIG } from '../thresholds';
import type { GestureEvent, GestureState, JumpPhase } from '../types';

export interface JumpOutput {
  state: GestureState;
  phase: JumpPhase;
  events: GestureEvent[];
}

type ActiveJumpPhase = 'preparing' | 'airborne' | 'landing';

/** Recognizes a squat/preparation, upward takeoff, and return-to-baseline landing. */
export class JumpDetector {
  private phase: ActiveJumpPhase | 'standing' | 'unknown' = 'standing';
  private standingCenterY: number | null = null;
  private preparationStartedAt: number | null = null;
  private peakCenterY: number | null = null;
  private jumpStartedAt: number | null = null;
  private previousCenterY: number | null = null;
  private previousTimestamp: number | null = null;

  reset(): void {
    this.phase = 'standing';
    this.standingCenterY = null;
    this.preparationStartedAt = null;
    this.peakCenterY = null;
    this.jumpStartedAt = null;
    this.previousCenterY = null;
    this.previousTimestamp = null;
  }

  process(
    analysis: BodyAnalysis,
    squatActive: boolean,
    timestamp: number,
  ): JumpOutput {
    const centerY = analysis.center?.y;
    const scale = analysis.scale;
    const quality = Math.min(
      analysis.center?.confidence ?? 0,
      analysis.scaleConfidence,
    );

    if (
      centerY === undefined ||
      scale === null ||
      scale <= 1e-6 ||
      quality < MOTION_CONFIG.gestureConfidenceThreshold
    ) {
      this.phase = 'unknown';
      this.previousCenterY = null;
      this.previousTimestamp = null;
      this.clearJumpSequence();
      return makeOutput(false, 0, false, 'unknown', []);
    }

    if (this.phase === 'unknown') this.phase = 'standing';
    const upwardSpeed = this.getUpwardSpeed(centerY, timestamp);
    const riseThreshold = scale * MOTION_CONFIG.jumpRiseScale;
    const landingTolerance = scale * MOTION_CONFIG.jumpLandingToleranceScale;
    const events: GestureEvent[] = [];

    if (this.phase === 'standing') {
      if (!squatActive) this.updateStandingBaseline(centerY);
      if (squatActive && this.standingCenterY !== null) {
        this.phase = 'preparing';
        this.preparationStartedAt = timestamp;
      }
    } else if (this.phase === 'preparing') {
      const preparationStart = this.preparationStartedAt ?? timestamp;
      const preparationExpired =
        timestamp - preparationStart > MOTION_CONFIG.jumpPreparationTimeoutMs;
      if (preparationExpired) {
        this.phase = squatActive ? 'preparing' : 'standing';
        this.preparationStartedAt = squatActive ? timestamp : null;
      }

      const aboveStanding =
        this.standingCenterY !== null &&
        this.standingCenterY - centerY >= riseThreshold;
      const fastRise =
        upwardSpeed !== null &&
        upwardSpeed >= scale * MOTION_CONFIG.jumpMinUpwardSpeedScalePerSecond;
      if (
        !preparationExpired &&
        aboveStanding &&
        fastRise &&
        timestamp - preparationStart <= MOTION_CONFIG.jumpPreparationTimeoutMs
      ) {
        this.phase = 'airborne';
        this.jumpStartedAt = timestamp;
        this.peakCenterY = centerY;
      }
    } else if (this.phase === 'airborne') {
      this.peakCenterY = Math.min(this.peakCenterY ?? centerY, centerY);
      const flightExpired =
        timestamp - (this.jumpStartedAt ?? timestamp) > MOTION_CONFIG.jumpFlightTimeoutMs;
      const hasStartedDescending =
        centerY - (this.peakCenterY ?? centerY) >=
        scale * MOTION_CONFIG.jumpDescentScale;
      if (flightExpired) {
        this.phase = 'standing';
        this.clearJumpSequence();
      } else if (hasStartedDescending) {
        this.phase = 'landing';
      }
    } else if (this.phase === 'landing') {
      const flightExpired =
        timestamp - (this.jumpStartedAt ?? timestamp) > MOTION_CONFIG.jumpFlightTimeoutMs;
      if (flightExpired) {
        this.phase = 'standing';
        this.clearJumpSequence();
      } else if (
        this.standingCenterY !== null &&
        centerY >= this.standingCenterY - landingTolerance
      ) {
        events.push({ type: 'JUMP', timestamp });
        this.phase = 'standing';
        this.clearJumpSequence();
        this.updateStandingBaseline(centerY);
      }
    }

    this.previousCenterY = centerY;
    this.previousTimestamp = timestamp;
    const active = this.phase === 'airborne' || this.phase === 'landing';
    const excursion = this.standingCenterY === null
      ? 0
      : Math.max(0, this.standingCenterY - centerY) / Math.max(riseThreshold, 1e-6);
    const confidence = active
      ? clampUnit(quality * Math.max(MOTION_CONFIG.jumpActiveConfidenceFloor, excursion))
      : 0;

    return makeOutput(
      active,
      confidence,
      true,
      this.phase,
      events,
    );
  }

  private getUpwardSpeed(
    centerY: number,
    timestamp: number,
  ): number | null {
    if (this.previousCenterY === null || this.previousTimestamp === null) {
      return null;
    }
    const deltaMs = timestamp - this.previousTimestamp;
    if (
      !Number.isFinite(deltaMs) ||
      deltaMs <= 0 ||
      deltaMs > MOTION_CONFIG.maxPoseFrameGapMs
    ) {
      return null;
    }
    const speed = ((this.previousCenterY - centerY) / deltaMs) * 1000;
    return Number.isFinite(speed) ? speed : null;
  }

  private updateStandingBaseline(centerY: number): void {
    this.standingCenterY = this.standingCenterY === null
      ? centerY
      : this.standingCenterY * (1 - MOTION_CONFIG.jumpBaselineAdaptation) +
        centerY * MOTION_CONFIG.jumpBaselineAdaptation;
  }

  private clearJumpSequence(): void {
    this.preparationStartedAt = null;
    this.peakCenterY = null;
    this.jumpStartedAt = null;
  }
}

function makeOutput(
  active: boolean,
  confidence: number,
  available: boolean,
  phase: JumpPhase | ActiveJumpPhase,
  events: GestureEvent[],
): JumpOutput {
  return {
    state: {
      type: 'JUMP',
      active,
      confidence,
      available,
    },
    phase,
    events,
  };
}
