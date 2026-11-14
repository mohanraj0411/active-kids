/** All Phase C temporal and geometry thresholds live here for device tuning. */
export const MOTION_CONTROLLER_CONFIG = Object.freeze({
  minPoseConfidence: 0.5,
  minLandmarkConfidence: 0.5,
  maxFrameGapMs: 500,
  invalidResetMs: 1_000,
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

export type MotionControllerConfig = typeof MOTION_CONTROLLER_CONFIG;
