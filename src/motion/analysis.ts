import type { PoseResult } from '../detection/types';
import {
  calculateAngle,
  calculateBodyCenter,
  calculateDistance,
  calculateHipWidth,
  calculateMidpoint,
  calculateRelativeHeight,
  calculateShoulderWidth,
  getTrustedPoint,
} from './geometry';
import type { MotionBody, MotionPoint, TrustedLandmarks } from './types';

export interface BodyAnalysis {
  body: MotionBody;
  center: MotionPoint | null;
  shoulderCenter: MotionPoint | null;
  hipCenter: MotionPoint | null;
  scale: number | null;
  scaleConfidence: number;
  leftShoulder: MotionPoint | null;
  rightShoulder: MotionPoint | null;
  leftHip: MotionPoint | null;
  rightHip: MotionPoint | null;
  leftElbow: MotionPoint | null;
  rightElbow: MotionPoint | null;
  leftWrist: MotionPoint | null;
  rightWrist: MotionPoint | null;
  leftKnee: MotionPoint | null;
  rightKnee: MotionPoint | null;
  leftAnkle: MotionPoint | null;
  rightAnkle: MotionPoint | null;
  trustedLandmarks: TrustedLandmarks;
}

export function analyzeBody(pose: PoseResult): BodyAnalysis {
  const leftShoulder = getTrustedPoint(pose, 'leftShoulder');
  const rightShoulder = getTrustedPoint(pose, 'rightShoulder');
  const leftHip = getTrustedPoint(pose, 'leftHip');
  const rightHip = getTrustedPoint(pose, 'rightHip');
  const leftElbow = getTrustedPoint(pose, 'leftElbow');
  const rightElbow = getTrustedPoint(pose, 'rightElbow');
  const leftWrist = getTrustedPoint(pose, 'leftWrist');
  const rightWrist = getTrustedPoint(pose, 'rightWrist');
  const leftKnee = getTrustedPoint(pose, 'leftKnee');
  const rightKnee = getTrustedPoint(pose, 'rightKnee');
  const leftAnkle = getTrustedPoint(pose, 'leftAnkle');
  const rightAnkle = getTrustedPoint(pose, 'rightAnkle');

  const shoulderCenter = calculateMidpoint(leftShoulder, rightShoulder);
  const hipCenter = calculateMidpoint(leftHip, rightHip);
  const shoulderWidth = calculateShoulderWidth(leftShoulder, rightShoulder);
  const hipWidth = calculateHipWidth(leftHip, rightHip);
  const torsoHeight = calculateDistance(shoulderCenter, hipCenter);
  const scale = shoulderWidth ?? hipWidth ?? (torsoHeight ? torsoHeight * 0.6 : null);
  const scaleConfidence = shoulderWidth !== null
    ? Math.min(leftShoulder?.confidence ?? 0, rightShoulder?.confidence ?? 0)
    : hipWidth !== null
      ? Math.min(leftHip?.confidence ?? 0, rightHip?.confidence ?? 0)
      : torsoHeight !== null
        ? Math.min(shoulderCenter?.confidence ?? 0, hipCenter?.confidence ?? 0)
        : 0;

  const center = calculateBodyCenter(
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
  );
  const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const leftHandHeight = calculateRelativeHeight(
    leftShoulder?.y,
    leftWrist?.y,
    scale,
  );
  const rightHandHeight = calculateRelativeHeight(
    rightShoulder?.y,
    rightWrist?.y,
    scale,
  );

  return {
    body: {
      centerX: center?.x ?? null,
      centerY: center?.y ?? null,
      shoulderWidth,
      torsoHeight,
      leftHandHeight,
      rightHandHeight,
      leftKneeAngle,
      rightKneeAngle,
    },
    center,
    shoulderCenter,
    hipCenter,
    scale,
    scaleConfidence,
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftKnee,
    rightKnee,
    leftAnkle,
    rightAnkle,
    trustedLandmarks: {
      leftShoulder: leftShoulder ?? undefined,
      rightShoulder: rightShoulder ?? undefined,
      leftElbow: leftElbow ?? undefined,
      rightElbow: rightElbow ?? undefined,
      leftWrist: leftWrist ?? undefined,
      rightWrist: rightWrist ?? undefined,
      leftHip: leftHip ?? undefined,
      rightHip: rightHip ?? undefined,
      leftKnee: leftKnee ?? undefined,
      rightKnee: rightKnee ?? undefined,
      leftAnkle: leftAnkle ?? undefined,
      rightAnkle: rightAnkle ?? undefined,
    },
    // Retain references used by hand confidence calculations without copying landmarks.
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
  };
}

export function meanAvailableKneeAngle(
  body: MotionBody,
): { angle: number | null; count: number } {
  let total = 0;
  let count = 0;
  const leftAngle = body.leftKneeAngle;
  const rightAngle = body.rightKneeAngle;
  if (leftAngle !== null && Number.isFinite(leftAngle)) {
    total += leftAngle;
    count += 1;
  }
  if (rightAngle !== null && Number.isFinite(rightAngle)) {
    total += rightAngle;
    count += 1;
  }
  return { angle: count > 0 ? total / count : null, count };
}
