import type { PoseDetectionConfig } from './types';

/** Set to false here to hide all pose diagnostics in a development build. */
export const DEBUG_POSE = __DEV__;

export const POSE_DETECTION_CONFIG: Readonly<PoseDetectionConfig> = {
  confidenceThreshold: 0.5,
  maxPeople: 1,
  targetFps: 20,
  callbackFps: 20,
};

/** Confidence and frame-edge gates used by the child-facing full-body status. */
export const BODY_VISIBILITY_CONFIG = {
  landmarkConfidenceThreshold: POSE_DETECTION_CONFIG.confidenceThreshold,
  frameEdgeMargin: 0.015,
} as const;

export const MEDIAPIPE_CONFIG = {
  modelVariant: 'full' as const,
  /** The native package bundles the full task model; Android executes it on CPU. */
  candidatePeople: 1,
  minPoseDetectionConfidence: 0.35,
  minPosePresenceConfidence: 0.35,
  minTrackingConfidence: 0.35,
  maxPreviewFps: 30,
  minimumValidLandmarks: 5,
  primaryPersonMaxJump: 0.3,
};
