import type { Landmark as MediaPipeLandmark, PoseFrame } from 'expo-mediapipe-pose';

import { MEDIAPIPE_CONFIG } from './poseConfig';
import {
  POSE_LANDMARK_NAMES,
  type PoseDetector,
  type PoseDetectorOutput,
  type PoseLandmark,
  type PoseLandmarkName,
  type PoseResult,
  type WorldPoseLandmark,
} from './types';

interface Candidate {
  index: number;
  landmarks: readonly MediaPipeLandmark[];
  worldLandmarks: readonly MediaPipeLandmark[];
  confidence: number;
  validLandmarkCount: number;
  center?: { x: number; y: number };
}

/**
 * Converts MediaPipe's 33 image/world landmarks into model-independent data.
 *
 * MediaPipe is configured to return up to two candidates internally. The
 * first frame selects the candidate with the strongest mean landmark
 * visibility/presence. Later frames keep the nearest torso center within 0.3
 * normalized image units, then reacquire the strongest candidate if the tracked
 * person disappears or moves farther away. This is short-term spatial matching,
 * not persistent person identity or multi-person tracking.
 */
export class MediaPipePoseAdapter implements PoseDetector<PoseFrame> {
  private previousCenter: { x: number; y: number } | null = null;

  reset(): void {
    this.previousCenter = null;
  }

  process(frame: PoseFrame): PoseDetectorOutput {
    const candidates = this.getCandidates(frame);
    const selected = this.selectPrimary(candidates);
    if (selected?.center) {
      this.previousCenter = selected.center;
    }

    const landmarks = selected ? this.toImageLandmarks(selected.landmarks) : {};
    const worldLandmarks = selected
      ? this.toWorldLandmarks(selected.worldLandmarks)
      : undefined;
    const confidence = selected?.confidence ?? 0;
    const detected =
      selected !== undefined &&
      selected.validLandmarkCount >= MEDIAPIPE_CONFIG.minimumValidLandmarks;

    const additionalData = frame.additionalData;
    const imageSize =
      isFinitePositive(additionalData.width) && isFinitePositive(additionalData.height)
        ? { width: additionalData.width, height: additionalData.height }
        : undefined;

    const result: PoseResult = {
      timestamp: isFinitePositive(additionalData.receivedAtMs)
        ? additionalData.receivedAtMs
        : Date.now(),
      landmarks,
      confidence,
      detected,
      ...(worldLandmarks && Object.keys(worldLandmarks).length > 0
        ? { worldLandmarks }
        : {}),
      ...(imageSize ? { imageSize } : {}),
      cameraFacing: additionalData.cameraFacing,
      cameraMirrored: additionalData.cameraMirrored,
      frameNumber: additionalData.frameNumber,
      inferenceDurationMs: additionalData.inferenceDurationMs,
      thermalState: additionalData.thermalState,
      poseModelDelegate: additionalData.poseModelDelegate,
      poseModelVariant: additionalData.poseModelVariant,
    };

    return {
      result,
      poseIndex: selected?.index ?? 0,
    };
  }

  private getCandidates(frame: PoseFrame): Candidate[] {
    const sourcePoses = frame.poses?.length
      ? frame.poses.slice(0, MEDIAPIPE_CONFIG.candidatePeople)
      : frame.landmarks.length > 0
        ? [{ landmarks: frame.landmarks, worldLandmarks: frame.worldLandmarks }]
        : [];

    return sourcePoses.map((pose, index) => {
      const safeLandmarks = pose.landmarks.filter(isValidModelLandmark);
      const validScores = safeLandmarks
        .map(getModelConfidence)
        .filter((score): score is number => score !== undefined);
      const confidence =
        validScores.length > 0
          ? clamp(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
          : 0;

      return {
        index,
        landmarks: pose.landmarks,
        worldLandmarks: pose.worldLandmarks,
        confidence,
        validLandmarkCount: safeLandmarks.length,
        center: getPersonCenter(pose.landmarks),
      };
    });
  }

  private selectPrimary(candidates: readonly Candidate[]): Candidate | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    if (this.previousCenter) {
      let nearest: Candidate | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        if (!candidate.center) {
          continue;
        }
        const distance = pointDistance(this.previousCenter, candidate.center);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        } else if (
          distance === nearestDistance &&
          nearest &&
          candidate.confidence > nearest.confidence
        ) {
          nearest = candidate;
        }
      }

      if (nearest && nearestDistance <= MEDIAPIPE_CONFIG.primaryPersonMaxJump) {
        return nearest;
      }
    }

    return candidates.reduce((strongest, candidate) =>
      candidate.confidence > strongest.confidence ? candidate : strongest,
    );
  }

  private toImageLandmarks(
    modelLandmarks: readonly MediaPipeLandmark[],
  ): PoseResult['landmarks'] {
    const landmarks: PoseResult['landmarks'] = {};

    POSE_LANDMARK_NAMES.forEach((name, index) => {
      const modelLandmark = modelLandmarks[index];
      if (!modelLandmark || !isValidModelLandmark(modelLandmark)) {
        return;
      }

      const confidence = getModelConfidence(modelLandmark);
      const landmark: PoseLandmark = {
        x: clamp(modelLandmark.x),
        y: clamp(modelLandmark.y),
        ...(Number.isFinite(modelLandmark.z) ? { z: modelLandmark.z } : {}),
        ...(typeof modelLandmark.visibility === 'number' &&
        Number.isFinite(modelLandmark.visibility)
          ? { visibility: clamp(modelLandmark.visibility) }
          : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
      landmarks[name] = landmark;
    });

    return landmarks;
  }

  private toWorldLandmarks(
    modelLandmarks: readonly MediaPipeLandmark[],
  ): PoseResult['worldLandmarks'] {
    const landmarks: Partial<Record<PoseLandmarkName, WorldPoseLandmark>> = {};

    POSE_LANDMARK_NAMES.forEach((name, index) => {
      const modelLandmark = modelLandmarks[index];
      if (!modelLandmark || !isValidModelLandmark(modelLandmark)) {
        return;
      }

      const confidence = getModelConfidence(modelLandmark);
      landmarks[name] = {
        x: modelLandmark.x,
        y: modelLandmark.y,
        z: modelLandmark.z,
        ...(typeof modelLandmark.visibility === 'number' &&
        Number.isFinite(modelLandmark.visibility)
          ? { visibility: clamp(modelLandmark.visibility) }
          : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
    });

    return landmarks;
  }
}

function isValidModelLandmark(landmark: MediaPipeLandmark): boolean {
  return (
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    Number.isFinite(landmark.z)
  );
}

function getModelConfidence(landmark: MediaPipeLandmark): number | undefined {
  const visibility = landmark.visibility;
  const presence = landmark.presence;
  const score =
    typeof visibility === 'number' && Number.isFinite(visibility)
      ? visibility
      : presence;
  return typeof score === 'number' && Number.isFinite(score)
    ? clamp(score)
    : undefined;
}

function getPersonCenter(
  landmarks: readonly MediaPipeLandmark[],
): { x: number; y: number } | undefined {
  const torsoLandmarkIndices = [11, 12, 23, 24];
  const torsoPoints = torsoLandmarkIndices
    .map((index) => landmarks[index])
    .filter(isValidModelLandmark);
  const points = torsoPoints.length
    ? torsoPoints
    : landmarks.filter(isValidModelLandmark);

  if (points.length === 0) {
    return undefined;
  }

  const total = points.reduce(
    (center, point) => ({
      x: center.x + clamp(point.x),
      y: center.y + clamp(point.y),
    }),
    { x: 0, y: 0 },
  );

  return { x: total.x / points.length, y: total.y / points.length };
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
