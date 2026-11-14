import { BODY_VISIBILITY_CONFIG } from './poseConfig';
import type { PoseLandmarkName, PoseResult } from './types';

export type BodyVisibilityState = 'NOT_DETECTED' | 'PARTIAL' | 'FULL_BODY';

export interface BodyVisibilityCheckpoints {
  head: boolean;
  shoulders: boolean;
  hips: boolean;
  knees: boolean;
  feet: boolean;
}

export interface BodyVisibilityAssessment {
  state: BodyVisibilityState;
  checkpoints: BodyVisibilityCheckpoints;
  frameTooTight: boolean;
  message: string;
}

const HEAD_LANDMARKS = [
  'nose',
  'leftEyeInner',
  'leftEye',
  'leftEyeOuter',
  'rightEyeInner',
  'rightEye',
  'rightEyeOuter',
  'leftEar',
  'rightEar',
] as const satisfies readonly PoseLandmarkName[];

const SHOULDER_LANDMARKS = ['leftShoulder', 'rightShoulder'] as const;
const HIP_LANDMARKS = ['leftHip', 'rightHip'] as const;
const KNEE_LANDMARKS = ['leftKnee', 'rightKnee'] as const;
const FOOT_LANDMARKS = ['leftAnkle', 'rightAnkle'] as const;
const BODY_LANDMARKS = [
  ...HEAD_LANDMARKS,
  ...SHOULDER_LANDMARKS,
  ...HIP_LANDMARKS,
  ...KNEE_LANDMARKS,
  ...FOOT_LANDMARKS,
] as const;

/**
 * Requires one reliable landmark in each body region. Paired regions tolerate
 * one occluded side, while confidence and frame-edge checks reject clipped poses.
 */
export function assessBodyVisibility(
  pose: PoseResult | null,
): BodyVisibilityAssessment {
  if (!pose?.detected) {
    return {
      state: 'NOT_DETECTED',
      checkpoints: emptyCheckpoints(),
      frameTooTight: false,
      message: 'Stand in front of the camera so I can see you.',
    };
  }

  const checkpoints: BodyVisibilityCheckpoints = {
    head: hasReliableLandmark(pose, HEAD_LANDMARKS),
    shoulders: hasReliableLandmark(pose, SHOULDER_LANDMARKS),
    hips: hasReliableLandmark(pose, HIP_LANDMARKS),
    knees: hasReliableLandmark(pose, KNEE_LANDMARKS),
    feet: hasReliableLandmark(pose, FOOT_LANDMARKS),
  };
  const frameTooTight = isPoseTouchingFrameEdge(pose);
  const allRegionsVisible = Object.values(checkpoints).every(Boolean);
  const state = allRegionsVisible && !frameTooTight ? 'FULL_BODY' : 'PARTIAL';

  return {
    state,
    checkpoints,
    frameTooTight,
    message: getVisibilityMessage(state, checkpoints, frameTooTight),
  };
}

export function isFullBodyVisible(pose: PoseResult | null): boolean {
  return assessBodyVisibility(pose).state === 'FULL_BODY';
}

/** Returns the model's per-landmark visibility/presence score in [0, 1]. */
export function getPoseLandmarkScore(
  pose: PoseResult | null,
  name: PoseLandmarkName,
): number | null {
  const landmark = pose?.landmarks[name];
  if (!landmark) return null;

  const score = landmark.confidence ?? landmark.visibility;
  return typeof score === 'number' && Number.isFinite(score)
    ? Math.min(1, Math.max(0, score))
    : null;
}

function hasReliableLandmark(
  pose: PoseResult,
  landmarks: readonly PoseLandmarkName[],
): boolean {
  return landmarks.some((name) => {
    const point = pose.landmarks[name];
    const score = getPoseLandmarkScore(pose, name);
    return (
      point !== undefined &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      score !== null &&
      score >= BODY_VISIBILITY_CONFIG.landmarkConfidenceThreshold
    );
  });
}

function isPoseTouchingFrameEdge(pose: PoseResult): boolean {
  const edge = BODY_VISIBILITY_CONFIG.frameEdgeMargin;
  for (const name of BODY_LANDMARKS) {
    const point = pose.landmarks[name];
    const score = getPoseLandmarkScore(pose, name);
    if (
      !point ||
      score === null ||
      score < BODY_VISIBILITY_CONFIG.landmarkConfidenceThreshold
    ) {
      continue;
    }

    if (
      point.x <= edge ||
      point.x >= 1 - edge ||
      point.y <= edge ||
      point.y >= 1 - edge
    ) {
      return true;
    }
  }
  return false;
}

function getVisibilityMessage(
  state: BodyVisibilityState,
  checkpoints: BodyVisibilityCheckpoints,
  frameTooTight: boolean,
): string {
  if (state === 'FULL_BODY') return 'FULL BODY ✓';
  if (!checkpoints.feet) return "I can't see your feet. Step back a little.";
  if (!checkpoints.head) return "I can't see your head. Move into the camera view.";
  if (frameTooTight) return 'Step back a little so I can see your whole body.';
  return 'Move back so I can see your whole body.';
}

function emptyCheckpoints(): BodyVisibilityCheckpoints {
  return {
    head: false,
    shoulders: false,
    hips: false,
    knees: false,
    feet: false,
  };
}
