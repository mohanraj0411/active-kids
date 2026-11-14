import type { PoseResult } from '../../detection/types';
import type { BodyAnalysis } from '../analysis';
import { clampUnit } from '../geometry';
import { MOTION_CONFIG } from '../thresholds';
import type { GestureEvent, GestureState } from '../types';
import { StableBoolean } from './StableBoolean';

export interface HandRaiseOutput {
  left: GestureState;
  right: GestureState;
  both: GestureState;
  events: GestureEvent[];
}

interface HandReading {
  available: boolean;
  candidate: boolean | null;
  confidence: number;
}

export class HandRaiseDetector {
  private readonly leftStable = new StableBoolean(MOTION_CONFIG.stableFrames);
  private readonly rightStable = new StableBoolean(MOTION_CONFIG.stableFrames);

  reset(): void {
    this.leftStable.reset();
    this.rightStable.reset();
  }

  process(
    pose: PoseResult,
    analysis: BodyAnalysis,
    timestamp: number,
  ): HandRaiseOutput {
    const leftReading = this.readHand(
      pose,
      analysis.leftWrist,
      analysis.leftShoulder,
      analysis.scale,
      this.leftStable.value,
    );
    const rightReading = this.readHand(
      pose,
      analysis.rightWrist,
      analysis.rightShoulder,
      analysis.scale,
      this.rightStable.value,
    );
    const wasBothActive = this.leftStable.value && this.rightStable.value;
    const leftTransition = this.leftStable.update(leftReading.candidate);
    const rightTransition = this.rightStable.update(rightReading.candidate);
    const events: GestureEvent[] = [];

    if (leftTransition.changed) {
      events.push({
        type: leftTransition.value ? 'LEFT_HAND_RAISED' : 'LEFT_HAND_RELEASED',
        timestamp,
      });
    }
    if (rightTransition.changed) {
      events.push({
        type: rightTransition.value ? 'RIGHT_HAND_RAISED' : 'RIGHT_HAND_RELEASED',
        timestamp,
      });
    }

    const bothActive = this.leftStable.value && this.rightStable.value;
    // The two-hand state is derived directly from the stable side states.
    if (bothActive !== wasBothActive) {
      events.push({
        type: bothActive ? 'BOTH_HANDS_RAISED' : 'BOTH_HANDS_RELEASED',
        timestamp,
      });
    }

    const left: GestureState = {
      type: 'LEFT_HAND_UP',
      active: this.leftStable.value,
      confidence: leftReading.confidence,
      available: leftReading.available,
    };
    const right: GestureState = {
      type: 'RIGHT_HAND_UP',
      active: this.rightStable.value,
      confidence: rightReading.confidence,
      available: rightReading.available,
    };
    const bothAvailable = leftReading.available && rightReading.available;

    return {
      left,
      right,
      both: {
        type: 'BOTH_HANDS_UP',
        active: bothActive,
        confidence: bothAvailable
          ? Math.min(leftReading.confidence, rightReading.confidence)
          : 0,
        available: bothAvailable,
      },
      events,
    };
  }

  private readHand(
    pose: PoseResult,
    wrist: BodyAnalysis['leftWrist'],
    shoulder: BodyAnalysis['leftShoulder'],
    scale: number | null,
    currentlyActive: boolean,
  ): HandReading {
    if (!wrist || !shoulder || scale === null || scale <= 0) {
      return { available: false, candidate: null, confidence: 0 };
    }

    const rise = shoulder.y - wrist.y;
    const thresholdScale = currentlyActive
      ? MOTION_CONFIG.handRaiseReleaseScale
      : MOTION_CONFIG.handRaiseActivationScale;
    const threshold = scale * thresholdScale;
    const raised = rise >= threshold;
    const margin = Math.abs(rise - threshold) / Math.max(scale, 1e-6);
    const geometricConfidence = clampUnit(
      MOTION_CONFIG.handConfidenceFloor +
        margin * MOTION_CONFIG.handConfidenceMarginScale,
    );
    const quality = Math.min(pose.confidence, wrist.confidence, shoulder.confidence);
    const confidence = clampUnit(quality * geometricConfidence);
    const candidate = confidence >= MOTION_CONFIG.gestureConfidenceThreshold
      ? raised
      : null;

    return {
      available: confidence >= MOTION_CONFIG.gestureConfidenceThreshold,
      candidate,
      confidence,
    };
  }
}
