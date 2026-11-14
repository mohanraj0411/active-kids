import {
  POSE_LANDMARK_NAMES,
  type PoseLandmark,
  type PoseLandmarkName,
  type PoseResult,
} from '../../detection/types';
import { getLandmarkConfidence } from '../geometry';
import { MOTION_CONFIG } from '../thresholds';

/** Exponential smoother for normalized landmarks; the original PoseResult is never mutated. */
export class PoseSmoother {
  private previous: Partial<Record<PoseLandmarkName, PoseLandmark>> = {};
  private previousTimestamp: number | null = null;

  reset(): void {
    this.previous = {};
    this.previousTimestamp = null;
  }

  smooth(rawPose: PoseResult): PoseResult {
    if (!rawPose.detected) {
      this.reset();
      return rawPose;
    }

    const rawDeltaMs = this.previousTimestamp === null
      ? MOTION_CONFIG.smoothingTimeConstantMs
      : rawPose.timestamp - this.previousTimestamp;
    const deltaMs = Number.isFinite(rawDeltaMs)
      ? Math.max(1, Math.min(MOTION_CONFIG.maxPoseFrameGapMs, rawDeltaMs))
      : MOTION_CONFIG.smoothingTimeConstantMs;
    const alpha = 1 - Math.exp(-deltaMs / MOTION_CONFIG.smoothingTimeConstantMs);
    const next: Partial<Record<PoseLandmarkName, PoseLandmark>> = {};

    for (const name of POSE_LANDMARK_NAMES) {
      const current = rawPose.landmarks[name];
      if (
        !current ||
        !Number.isFinite(current.x) ||
        !Number.isFinite(current.y)
      ) {
        continue;
      }

      const confidence = getLandmarkConfidence(rawPose, name);
      if (
        confidence === null ||
        confidence < MOTION_CONFIG.landmarkConfidenceThreshold
      ) {
        continue;
      }

      const previous = this.previous[name];
      const smoothed: PoseLandmark = previous
        ? {
            ...current,
            x: previous.x + (current.x - previous.x) * alpha,
            y: previous.y + (current.y - previous.y) * alpha,
            ...(typeof current.z === 'number' && Number.isFinite(current.z) &&
            typeof previous.z === 'number' && Number.isFinite(previous.z)
              ? { z: previous.z + (current.z - previous.z) * alpha }
              : {}),
          }
        : { ...current };
      next[name] = smoothed;
    }

    this.previous = next;
    this.previousTimestamp = Number.isFinite(rawPose.timestamp)
      ? rawPose.timestamp
      : Date.now();
    return { ...rawPose, landmarks: next };
  }
}
