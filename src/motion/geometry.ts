import type { PoseLandmarkName, PoseResult } from '../detection/types';
import { MOTION_CONFIG } from './thresholds';
import type { MotionPoint, TrustedLandmarks } from './types';

const MIN_VECTOR_LENGTH = 1e-6;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getLandmarkConfidence(
  pose: PoseResult,
  name: PoseLandmarkName,
): number | null {
  const landmark = pose.landmarks[name];
  if (!landmark) return null;

  const score = landmark.confidence ?? landmark.visibility ?? pose.confidence;
  return typeof score === 'number' && Number.isFinite(score)
    ? clampUnit(score)
    : null;
}

export function getTrustedPoint(
  pose: PoseResult,
  name: PoseLandmarkName,
): MotionPoint | null {
  const landmark = pose.landmarks[name];
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y)
  ) {
    return null;
  }

  const confidence = getLandmarkConfidence(pose, name);
  if (
    confidence === null ||
    confidence < MOTION_CONFIG.landmarkConfidenceThreshold
  ) {
    return null;
  }

  return { x: landmark.x, y: landmark.y, confidence };
}

export function calculateDistance(
  first: MotionPoint | null | undefined,
  second: MotionPoint | null | undefined,
): number | null {
  if (!isFinitePoint(first) || !isFinitePoint(second)) return null;
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  return Number.isFinite(distance) ? distance : null;
}

/** Returns the angle at joint B in degrees, or null for missing/degenerate points. */
export function calculateAngle(
  first: MotionPoint | null | undefined,
  joint: MotionPoint | null | undefined,
  last: MotionPoint | null | undefined,
): number | null {
  if (
    !isFinitePoint(first) ||
    !isFinitePoint(joint) ||
    !isFinitePoint(last)
  ) {
    return null;
  }

  const firstX = first.x - joint.x;
  const firstY = first.y - joint.y;
  const lastX = last.x - joint.x;
  const lastY = last.y - joint.y;
  const firstLength = Math.hypot(firstX, firstY);
  const lastLength = Math.hypot(lastX, lastY);
  if (firstLength < MIN_VECTOR_LENGTH || lastLength < MIN_VECTOR_LENGTH) {
    return null;
  }

  const cosine = Math.max(
    -1,
    Math.min(1, (firstX * lastX + firstY * lastY) / (firstLength * lastLength)),
  );
  const angle = Math.acos(cosine) * DEGREES_PER_RADIAN;
  return Number.isFinite(angle) ? angle : null;
}

export function calculateMidpoint(
  first: MotionPoint | null | undefined,
  second: MotionPoint | null | undefined,
): MotionPoint | null {
  if (!isFinitePoint(first) || !isFinitePoint(second)) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    confidence: Math.min(first.confidence, second.confidence),
  };
}

export function calculateShoulderWidth(
  leftShoulder: MotionPoint | null | undefined,
  rightShoulder: MotionPoint | null | undefined,
): number | null {
  return calculateDistance(leftShoulder, rightShoulder);
}

export function calculateHipWidth(
  leftHip: MotionPoint | null | undefined,
  rightHip: MotionPoint | null | undefined,
): number | null {
  return calculateDistance(leftHip, rightHip);
}

/** A four-point torso center that tolerates one hidden shoulder or hip. */
export function calculateBodyCenter(
  leftShoulder: MotionPoint | null | undefined,
  rightShoulder: MotionPoint | null | undefined,
  leftHip: MotionPoint | null | undefined,
  rightHip: MotionPoint | null | undefined,
): MotionPoint | null {
  let x = 0;
  let y = 0;
  let confidence = 0;
  let count = 0;

  if (isFinitePoint(leftShoulder)) {
    x += leftShoulder.x;
    y += leftShoulder.y;
    confidence += leftShoulder.confidence;
    count += 1;
  }
  if (isFinitePoint(rightShoulder)) {
    x += rightShoulder.x;
    y += rightShoulder.y;
    confidence += rightShoulder.confidence;
    count += 1;
  }
  if (isFinitePoint(leftHip)) {
    x += leftHip.x;
    y += leftHip.y;
    confidence += leftHip.confidence;
    count += 1;
  }
  if (isFinitePoint(rightHip)) {
    x += rightHip.x;
    y += rightHip.y;
    confidence += rightHip.confidence;
    count += 1;
  }

  if (count < 2) return null;
  return {
    x: x / count,
    y: y / count,
    confidence: confidence / count,
  };
}

export function calculateRelativeHeight(
  referenceY: number | null | undefined,
  pointY: number | null | undefined,
  scale: number | null | undefined,
): number | null {
  if (
    typeof referenceY !== 'number' ||
    typeof pointY !== 'number' ||
    typeof scale !== 'number' ||
    !Number.isFinite(referenceY) ||
    !Number.isFinite(pointY) ||
    !Number.isFinite(scale) ||
    scale < MIN_VECTOR_LENGTH
  ) {
    return null;
  }
  const height = (referenceY - pointY) / scale;
  return Number.isFinite(height) ? height : null;
}

export function calculateMeanConfidence(
  landmarks: TrustedLandmarks,
  names: readonly PoseLandmarkName[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const name of names) {
    const point = landmarks[name];
    if (!point) continue;
    sum += point.confidence;
    count += 1;
  }
  return count > 0 ? clampUnit(sum / count) : null;
}

function isFinitePoint(
  point: MotionPoint | null | undefined,
): point is MotionPoint {
  return Boolean(
    point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.confidence),
  );
}
