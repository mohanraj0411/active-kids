/** All Phase C temporal and geometry thresholds live here for device tuning. */
export const MOTION_CONTROLLER_CONFIG = Object.freeze({
  minPoseConfidence: 0.5,
  minLandmarkConfidence: 0.5,
  maxFrameGapMs: 500,
  invalidResetMs: 1_000,
  /** Releases continuous camera actions when pose callbacks stop arriving. */
  trackingLossTimeoutMs: 350,
  /** Squat confidence loss can release crouch before global pose expiry. */
  crouchTrackingLossTimeoutMs: 350,
  historyWindowMs: 1_000,
  maxHistorySamples: 24,

  runStartConfirmationMs: 250,
  runStopTimeoutMs: 350,
  runMaxAlternationGapMs: 450,
  runMinAlternations: 2,
  runMinAlternationIntervalMs: 100,
  runLegVelocityThresholdScalePerSecond: 0.42,
  runLegExcursionThresholdScale: 0.12,

  jumpMinFootRiseScale: 0.13,
  jumpMinHipRiseScale: 0.09,
  jumpMinUpwardVelocityScalePerSecond: 0.45,
  jumpLandingToleranceScale: 0.07,
  jumpDescentScale: 0.055,
  jumpLandingConfirmationMs: 120,
  jumpFlightTimeoutMs: 2_200,
  jumpCooldownMs: 500,
  jumpBaselineAdaptation: 0.025,

  armSwingVelocityThresholdScalePerSecond: 3.0,
  armSwingDisplacementThresholdScale: 0.18,
  armSwingCooldownMs: 350,
  armSwingRearmVelocityScalePerSecond: 0.8,
  armSwingRearmQuietMs: 180,

  /** Existing squat recognizer confirms transitions over three reliable frames. */
  crouchConfidenceFloor: 0.6,
  crouchConfirmationMs: 200,
  crouchReleaseMs: 250,
});

/** Tuning for torso-lean navigation; angles are measured relative to calibration. */
export const BODY_LEAN_CONFIG = Object.freeze({
  minPoseConfidence: 0.5,
  minLandmarkConfidence: 0.5,
  deadZoneDegrees: 8.5,
  maxLeanDegrees: 27,
  smoothingTimeConstantMs: 115,
  responseExponent: 1.3,
  trackingLossTimeoutMs: 350,
  calibrationDurationMs: 2_000,
  calibrationMinSamples: 3,
  calibrationMaxSamples: 45,
  calibrationMaxNeutralAngleDegrees: 24,
  minimumTorsoLengthImageRatio: 0.065,
});

export type MotionControllerConfig = typeof MOTION_CONTROLLER_CONFIG;
