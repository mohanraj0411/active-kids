import type { BodyAnalysis } from '../analysis';
import { meanAvailableKneeAngle } from '../analysis';
import { clampUnit } from '../geometry';
import { MOTION_CONFIG } from '../thresholds';
import type { GestureEvent, GestureState, SquatPhase } from '../types';
import { StableBoolean } from './StableBoolean';

export interface SquatOutput {
  state: GestureState;
  phase: SquatPhase;
  events: GestureEvent[];
}

export class SquatDetector {
  private readonly stable = new StableBoolean(MOTION_CONFIG.stableFrames);
  private standingGapRatio: number | null = null;
  private standingHipY: number | null = null;

  reset(): void {
    this.stable.reset();
    this.standingGapRatio = null;
    this.standingHipY = null;
  }

  process(analysis: BodyAnalysis, timestamp: number): SquatOutput {
    const average = meanAvailableKneeAngle(analysis.body);
    const currentGapRatio = getHipShoulderGapRatio(analysis);
    const currentHipY = analysis.hipCenter?.y ?? null;
    const quality = Math.min(
      analysis.scaleConfidence,
      analysis.shoulderCenter?.confidence ?? 0,
      analysis.hipCenter?.confidence ?? 0,
    );
    const dataAvailable =
      average.angle !== null &&
      average.count > 0 &&
      currentGapRatio !== null &&
      currentHipY !== null &&
      analysis.scale !== null &&
      quality >= MOTION_CONFIG.gestureConfidenceThreshold;

    if (!dataAvailable || average.angle === null || currentGapRatio === null) {
      const update = this.stable.update(null);
      return {
        state: {
          type: 'SQUAT',
          active: update.value,
          confidence: 0,
          available: false,
        },
        phase: 'unknown',
        events: [],
      };
    }

    if (!this.stable.value && average.angle >= MOTION_CONFIG.squatExitKneeAngleDeg) {
      this.standingGapRatio = this.standingGapRatio === null
        ? currentGapRatio
        : this.standingGapRatio * (1 - MOTION_CONFIG.squatBaselineAdaptation) +
          currentGapRatio * MOTION_CONFIG.squatBaselineAdaptation;
      this.standingHipY = this.standingHipY === null
        ? currentHipY
        : this.standingHipY * (1 - MOTION_CONFIG.squatBaselineAdaptation) +
          currentHipY * MOTION_CONFIG.squatBaselineAdaptation;
    }

    const hipDrop = this.standingGapRatio === null
      ? 0
      : currentGapRatio - this.standingGapRatio;
    const bodyDrop =
      this.standingHipY === null || analysis.scale === null
        ? 0
        : (currentHipY - this.standingHipY) / analysis.scale;
    const deepBend = average.angle <= MOTION_CONFIG.squatDeepKneeAngleDeg;
    const bentKnees = average.angle <= MOTION_CONFIG.squatEnterKneeAngleDeg;
    const enoughPostureDrop =
      hipDrop >= MOTION_CONFIG.squatHipDropScale ||
      bodyDrop >= MOTION_CONFIG.squatBodyDropScale;
    const releasePostureDrop =
      hipDrop >= MOTION_CONFIG.squatHipReleaseScale ||
      bodyDrop >= MOTION_CONFIG.squatBodyReleaseScale;
    const candidate = this.stable.value
      ? deepBend ||
        (average.angle < MOTION_CONFIG.squatExitKneeAngleDeg &&
          releasePostureDrop)
      : deepBend ||
        (bentKnees && enoughPostureDrop) ||
        (average.angle <= MOTION_CONFIG.squatFrontalMaxKneeAngleDeg &&
          bodyDrop >= MOTION_CONFIG.squatBodyDropScale);

    const kneeConfidence = clampUnit(
      (MOTION_CONFIG.squatExitKneeAngleDeg - average.angle) /
        (MOTION_CONFIG.squatExitKneeAngleDeg - MOTION_CONFIG.squatDeepKneeAngleDeg),
    );
    const gapDropConfidence = clampUnit(
      hipDrop / Math.max(MOTION_CONFIG.squatHipDropScale, 1e-6),
    );
    const bodyDropConfidence = clampUnit(
      bodyDrop / Math.max(MOTION_CONFIG.squatBodyDropScale, 1e-6),
    );
    const dropConfidence = Math.max(gapDropConfidence, bodyDropConfidence);
    const geometryConfidence = deepBend
      ? kneeConfidence
      : bentKnees
        ? Math.min(kneeConfidence, dropConfidence)
        : Math.min(MOTION_CONFIG.squatConfidenceFloor, bodyDropConfidence);
    const confidence = clampUnit(
      quality *
        (candidate
          ? Math.max(MOTION_CONFIG.squatConfidenceFloor, geometryConfidence)
          : 1),
    );
    const stableCandidate = quality >= MOTION_CONFIG.gestureConfidenceThreshold
      ? candidate
      : null;
    const transition = this.stable.update(stableCandidate);
    const events: GestureEvent[] = [];

    if (transition.changed) {
      events.push({
        type: transition.value ? 'SQUAT_STARTED' : 'SQUAT_COMPLETED',
        timestamp,
      });
    }

    return {
      state: {
        type: 'SQUAT',
        active: transition.value,
        confidence,
        available: true,
      },
      phase: transition.value
        ? candidate ? 'squat' : 'rising'
        : candidate ? 'lowering' : 'standing',
      events,
    };
  }
}

function getHipShoulderGapRatio(analysis: BodyAnalysis): number | null {
  const shoulderY = analysis.shoulderCenter?.y;
  const hipY = analysis.hipCenter?.y;
  const scale = analysis.scale;
  if (
    shoulderY === undefined ||
    hipY === undefined ||
    scale === null ||
    scale <= 1e-6
  ) {
    return null;
  }
  const ratio = (hipY - shoulderY) / scale;
  return Number.isFinite(ratio) ? ratio : null;
}
