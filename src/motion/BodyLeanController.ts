import type { PoseResult } from '../detection/types';
import { getLandmarkConfidence } from './geometry';
import { BODY_LEAN_CONFIG } from './motionThresholds';
import type { BodyLeanState, HorizontalDirection } from './controllerTypes';

const INITIAL_STATE: BodyLeanState = {
  direction: 0,
  intensity: 0,
  angleDegrees: 0,
  rawAngleDegrees: null,
  trackingConfidence: 0,
  isTracking: false,
  calibrated: false,
  calibrating: false,
};

/** Converts shoulder/hip geometry into smoothed, scale-independent joystick input. */
export class BodyLeanController {
  private state: BodyLeanState = { ...INITIAL_STATE };
  private neutralAngleDegrees = 0;
  private calibrationSamples: number[] = [];
  private calibrating = false;
  private calibrated = false;
  private lastSampleAt: number | null = null;
  private lastValidAt: number | null = null;
  private smoothedAngleDegrees = 0;
  private hasSmoothedAngle = false;

  get current(): BodyLeanState {
    return this.state;
  }

  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.neutralAngleDegrees = 0;
    this.calibrationSamples.length = 0;
    this.calibrating = false;
    this.calibrated = false;
    this.lastSampleAt = null;
    this.lastValidAt = null;
    this.smoothedAngleDegrees = 0;
    this.hasSmoothedAngle = false;
  }

  beginCalibration(): void {
    this.calibrationSamples.length = 0;
    this.neutralAngleDegrees = 0;
    this.calibrating = true;
    this.calibrated = false;
    this.lastSampleAt = null;
    this.lastValidAt = null;
    this.smoothedAngleDegrees = 0;
    this.hasSmoothedAngle = false;
    this.state = {
      ...INITIAL_STATE,
      calibrated: false,
      calibrating: true,
    };
  }

  completeCalibration(): BodyLeanState {
    if (this.calibrationSamples.length >= BODY_LEAN_CONFIG.calibrationMinSamples) {
      this.neutralAngleDegrees = median(this.calibrationSamples);
      this.calibrated = true;
    } else {
      this.neutralAngleDegrees = 0;
      this.calibrated = false;
    }
    this.calibrating = false;
    this.calibrationSamples.length = 0;
    this.lastSampleAt = null;
    this.lastValidAt = null;
    this.smoothedAngleDegrees = 0;
    this.hasSmoothedAngle = false;
    this.state = {
      ...INITIAL_STATE,
      calibrated: this.calibrated,
    };
    return this.state;
  }

  update(pose: PoseResult): BodyLeanState {
    const timestamp = Number.isFinite(pose.timestamp) ? pose.timestamp : Date.now();
    const measured = calculateBodyLean(pose);
    if (!measured || !pose.detected || pose.confidence < BODY_LEAN_CONFIG.minPoseConfidence) {
      return this.updateTrackingLoss(timestamp);
    }

    const wasTracking = this.lastValidAt !== null &&
      timestamp - this.lastValidAt < BODY_LEAN_CONFIG.trackingLossTimeoutMs;
    this.lastValidAt = timestamp;

    if (this.calibrating) {
      if (Math.abs(measured.angleDegrees) <= BODY_LEAN_CONFIG.calibrationMaxNeutralAngleDegrees) {
        this.calibrationSamples.push(measured.angleDegrees);
        if (this.calibrationSamples.length > BODY_LEAN_CONFIG.calibrationMaxSamples) {
          this.calibrationSamples.shift();
        }
      }
      this.lastSampleAt = timestamp;
      this.state = {
        direction: 0,
        intensity: 0,
        angleDegrees: 0,
        rawAngleDegrees: measured.angleDegrees,
        trackingConfidence: measured.confidence,
        isTracking: true,
        calibrated: false,
        calibrating: true,
      };
      return this.state;
    }

    const relativeAngle = normalizeLeanAngle(measured.angleDegrees - this.neutralAngleDegrees);
    if (!wasTracking || !this.hasSmoothedAngle || this.lastSampleAt === null) {
      this.smoothedAngleDegrees = relativeAngle;
      this.hasSmoothedAngle = true;
    } else {
      const deltaMs = Math.max(1, timestamp - this.lastSampleAt);
      const alpha = 1 - Math.exp(-deltaMs / BODY_LEAN_CONFIG.smoothingTimeConstantMs);
      this.smoothedAngleDegrees += (relativeAngle - this.smoothedAngleDegrees) * alpha;
    }
    this.lastSampleAt = timestamp;

    const movement = calculateMovement(this.smoothedAngleDegrees);
    this.state = {
      ...movement,
      angleDegrees: this.smoothedAngleDegrees,
      rawAngleDegrees: measured.angleDegrees,
      trackingConfidence: measured.confidence,
      isTracking: true,
      calibrated: this.calibrated,
      calibrating: false,
    };
    return this.state;
  }

  expireTracking(): BodyLeanState {
    this.lastValidAt = null;
    this.lastSampleAt = null;
    this.smoothedAngleDegrees = 0;
    this.hasSmoothedAngle = false;
    this.state = {
      direction: 0,
      intensity: 0,
      angleDegrees: 0,
      rawAngleDegrees: null,
      trackingConfidence: 0,
      isTracking: false,
      calibrated: this.calibrated,
      calibrating: this.calibrating,
    };
    return this.state;
  }

  private updateTrackingLoss(timestamp: number): BodyLeanState {
    const ageMs = this.lastValidAt === null ? Number.POSITIVE_INFINITY : timestamp - this.lastValidAt;
    if (ageMs < BODY_LEAN_CONFIG.trackingLossTimeoutMs) {
      this.state = {
        ...this.state,
        rawAngleDegrees: null,
        trackingConfidence: 0,
        isTracking: ageMs < BODY_LEAN_CONFIG.trackingLossTimeoutMs,
      };
      return this.state;
    }

    return this.expireTracking();
  }
}

export function calculateBodyLean(pose: PoseResult): {
  angleDegrees: number;
  confidence: number;
} | null {
  if (!pose.detected || pose.confidence < BODY_LEAN_CONFIG.minPoseConfidence) return null;

  const leftShoulder = pose.landmarks.leftShoulder;
  const rightShoulder = pose.landmarks.rightShoulder;
  const leftHip = pose.landmarks.leftHip;
  const rightHip = pose.landmarks.rightHip;
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const confidence = Math.min(
    getLandmarkConfidence(pose, 'leftShoulder') ?? 0,
    getLandmarkConfidence(pose, 'rightShoulder') ?? 0,
    getLandmarkConfidence(pose, 'leftHip') ?? 0,
    getLandmarkConfidence(pose, 'rightHip') ?? 0,
  );
  if (confidence < BODY_LEAN_CONFIG.minLandmarkConfidence) return null;

  const width = isPositiveFinite(pose.imageSize?.width) ? pose.imageSize.width : 1;
  const height = isPositiveFinite(pose.imageSize?.height) ? pose.imageSize.height : 1;
  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) * 0.5 * width;
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) * 0.5 * height;
  const hipCenterX = (leftHip.x + rightHip.x) * 0.5 * width;
  const hipCenterY = (leftHip.y + rightHip.y) * 0.5 * height;
  const horizontal = shoulderCenterX - hipCenterX;
  const vertical = hipCenterY - shoulderCenterY;
  const imageScale = Math.min(width, height);
  const torsoLength = Math.hypot(horizontal, vertical);
  if (
    !Number.isFinite(torsoLength) ||
    torsoLength < imageScale * BODY_LEAN_CONFIG.minimumTorsoLengthImageRatio ||
    vertical <= 0
  ) return null;

  const angleDegrees = Math.atan2(horizontal, vertical) * (180 / Math.PI);
  return Number.isFinite(angleDegrees) ? { angleDegrees, confidence } : null;
}

function calculateMovement(angleDegrees: number): {
  direction: HorizontalDirection;
  intensity: number;
} {
  const magnitude = Math.abs(angleDegrees);
  if (magnitude <= BODY_LEAN_CONFIG.deadZoneDegrees) return { direction: 0, intensity: 0 };

  const range = BODY_LEAN_CONFIG.maxLeanDegrees - BODY_LEAN_CONFIG.deadZoneDegrees;
  const normalized = Math.min(1, (magnitude - BODY_LEAN_CONFIG.deadZoneDegrees) / range);
  const intensity = Math.pow(normalized, BODY_LEAN_CONFIG.responseExponent);
  return {
    direction: angleDegrees < 0 ? -1 : 1,
    intensity: clampUnit(intensity),
  };
}

function normalizeLeanAngle(angle: number): number {
  let normalized = angle;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
