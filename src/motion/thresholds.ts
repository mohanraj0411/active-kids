/**
 * Central tuning for Phase 3. Distances are fractions of shoulder width or
 * torso scale, so recognition adapts when the player moves nearer to the camera.
 */
export const MOTION_CONFIG = Object.freeze({
  minPoseConfidence: 0.5,
  landmarkConfidenceThreshold: 0.5,
  gestureConfidenceThreshold: 0.6,
  stableFrames: 3,
  maxPoseFrameGapMs: 500,

  smoothingTimeConstantMs: 65,

  handRaiseActivationScale: 0.16,
  handRaiseReleaseScale: 0.08,
  handConfidenceFloor: 0.7,
  handConfidenceMarginScale: 0.8,

  squatEnterKneeAngleDeg: 134,
  squatExitKneeAngleDeg: 148,
  squatDeepKneeAngleDeg: 112,
  squatHipDropScale: 0.08,
  squatHipReleaseScale: 0.035,
  squatBodyDropScale: 0.2,
  squatBodyReleaseScale: 0.08,
  squatFrontalMaxKneeAngleDeg: 160,
  squatBaselineAdaptation: 0.02,
  squatConfidenceFloor: 0.75,

  jumpRiseScale: 0.28,
  jumpLandingToleranceScale: 0.16,
  jumpPreparationTimeoutMs: 1200,
  jumpFlightTimeoutMs: 2200,
  jumpMinUpwardSpeedScalePerSecond: 0.2,
  jumpDescentScale: 0.06,
  jumpBaselineAdaptation: 0.02,
  jumpActiveConfidenceFloor: 0.7,

  lateralEnterScale: 0.52,
  lateralReleaseScale: 0.25,
  lateralBaselineAdaptation: 0.015,
  lateralActiveConfidenceFloor: 0.7,

  maxDebugEvents: 20,
  debugUiUpdateIntervalMs: 180,
});

export const EMPTY_BODY = Object.freeze({
  centerX: null,
  centerY: null,
  shoulderWidth: null,
  torsoHeight: null,
  leftHandHeight: null,
  rightHandHeight: null,
  leftKneeAngle: null,
  rightKneeAngle: null,
});
