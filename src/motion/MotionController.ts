import type { PoseResult } from '../detection/types';
import { MotionEngine } from './MotionEngine';
import { clampUnit } from './geometry';
import { MOTION_CONTROLLER_CONFIG } from './motionThresholds';
import type { MotionBody, MotionPoint, MotionResult } from './types';
import type {
  BodyLeanState,
  ContinuousMotionState,
  JumpControllerPhase,
  MotionControllerDiagnostics,
  MotionControllerUpdate,
  MotionEvent,
} from './controllerTypes';
import { PoseSmoother } from './smoothing/PoseSmoother';
import { BodyLeanController } from './BodyLeanController';

interface RunSample {
  timestamp: number;
  leftLift: number;
  rightLift: number;
}

interface RelativeArmPoint {
  x: number;
  y: number;
  confidence: number;
}

interface JumpBaseline {
  hipY: number;
  leftFootY: number;
  rightFootY: number;
}

const EMPTY_RESULT: Omit<MotionResult, 'timestamp' | 'confidence'> = {
  personDetected: false,
  gestures: [],
  events: [],
  body: {
    centerX: null,
    centerY: null,
    shoulderWidth: null,
    torsoHeight: null,
    leftHandHeight: null,
    rightHandHeight: null,
    leftKneeAngle: null,
    rightKneeAngle: null,
  },
  trustedLandmarks: {},
  squatPhase: 'unknown',
  jumpPhase: 'unknown',
  movementDirection: 'UNKNOWN',
};

/**
 * Converts normalized pose frames into stable motion transitions and one-shot
 * actions. Reuse one controller for a camera session; it has no React/native
 * dependency and keeps only a short, bounded run-analysis window.
 */
export class MotionController {
  private readonly smoother = new PoseSmoother();
  private readonly motionEngine = new MotionEngine();
  private readonly bodyLeanController = new BodyLeanController();
  private readonly runHistory: RunSample[] = [];
  private running = false;
  private crouching = false;
  private trackingInputsReleased = false;
  private jumpPhase: JumpControllerPhase = 'GROUNDED';
  private jumpBaseline: JumpBaseline | null = null;
  private peakHipY: number | null = null;
  private jumpStartedAt: number | null = null;
  private landingStartedAt: number | null = null;
  private lastJumpAt = Number.NEGATIVE_INFINITY;
  private previousHipY: number | null = null;
  private previousJumpTimestamp: number | null = null;
  private leftArmPrevious: RelativeArmPoint | null = null;
  private rightArmPrevious: RelativeArmPoint | null = null;
  private leftArmPreviousTimestamp: number | null = null;
  private rightArmPreviousTimestamp: number | null = null;
  private leftArmQuietSince: number | null = null;
  private rightArmQuietSince: number | null = null;
  private leftArmArmed = true;
  private rightArmArmed = true;
  private lastArmSwingAt = Number.NEGATIVE_INFINITY;
  private lastPoseTimestamp: number | null = null;
  private overallInvalidSince: number | null = null;
  private lowerBodyInvalidSince: number | null = null;
  private crouchInvalidSince: number | null = null;
  private crouchCandidateSince: number | null = null;
  private crouchReleaseSince: number | null = null;
  private runLastDirection: -1 | 1 | null = null;
  private runAlternations = 0;
  private runLastDirectionAt: number | null = null;
  private runLastMotionAt: number | null = null;
  private runCandidateSince: number | null = null;
  private leftKneeVelocity: number | null = null;
  private rightKneeVelocity: number | null = null;
  private hipUpVelocity: number | null = null;
  private leftWristVelocity: number | null = null;
  private rightWristVelocity: number | null = null;
  private lastEvent: MotionEvent | null = null;
  private motionResult: MotionResult = {
    ...EMPTY_RESULT,
    timestamp: 0,
    confidence: 0,
  };
  private diagnostics: MotionControllerDiagnostics = makeDiagnostics(
    'IDLE',
    0,
    false,
    false,
    0,
    0,
    'GROUNDED',
    null,
    null,
    null,
    null,
    null,
    0,
    this.lastEvent,
    0,
  );

  get state(): ContinuousMotionState {
    if (this.crouching) return 'CROUCH';
    if (this.running) return 'RUN';
    return 'IDLE';
  }

  get lastMotionResult(): MotionResult {
    return this.motionResult;
  }

  get bodyLeanState(): BodyLeanState {
    return this.bodyLeanController.current;
  }

  beginNeutralCalibration(): void {
    this.bodyLeanController.beginCalibration();
  }

  completeNeutralCalibration(): BodyLeanState {
    return this.bodyLeanController.completeCalibration();
  }

  updateCalibrationPose(frame: PoseResult): BodyLeanState {
    return this.bodyLeanController.update(frame);
  }

  /** Called by the camera watchdog if native pose callbacks stop completely. */
  expireTracking(timestamp: number): MotionEvent[] {
    this.bodyLeanController.expireTracking();
    this.smoother.reset();
    this.motionEngine.reset();
    const events: MotionEvent[] = [];
    this.releaseContinuousInputs(timestamp, 0, events);
    this.running = false;
    this.crouching = false;
    this.trackingInputsReleased = true;
    this.resetRecognitionState();
    this.trackingInputsReleased = true;
    if (events.length > 0) this.lastEvent = events[events.length - 1];
    this.motionResult = {
      ...EMPTY_RESULT,
      timestamp,
      confidence: 0,
    };
    this.refreshDiagnostics(timestamp, 0, null, null, null, null);
    return events;
  }

  getDebugInfo(): MotionControllerDiagnostics {
    return this.diagnostics;
  }

  reset(): void {
    this.smoother.reset();
    this.motionEngine.reset();
    this.runHistory.length = 0;
    this.running = false;
    this.crouching = false;
    this.trackingInputsReleased = false;
    this.bodyLeanController.reset();
    this.jumpPhase = 'GROUNDED';
    this.jumpBaseline = null;
    this.peakHipY = null;
    this.jumpStartedAt = null;
    this.landingStartedAt = null;
    this.lastJumpAt = Number.NEGATIVE_INFINITY;
    this.previousHipY = null;
    this.previousJumpTimestamp = null;
    this.leftArmPrevious = null;
    this.rightArmPrevious = null;
    this.leftArmPreviousTimestamp = null;
    this.rightArmPreviousTimestamp = null;
    this.leftArmQuietSince = null;
    this.rightArmQuietSince = null;
    this.leftArmArmed = true;
    this.rightArmArmed = true;
    this.lastArmSwingAt = Number.NEGATIVE_INFINITY;
    this.lastPoseTimestamp = null;
    this.overallInvalidSince = null;
    this.lowerBodyInvalidSince = null;
    this.crouchInvalidSince = null;
    this.crouchCandidateSince = null;
    this.crouchReleaseSince = null;
    this.resetRunSequence();
    this.leftKneeVelocity = null;
    this.rightKneeVelocity = null;
    this.hipUpVelocity = null;
    this.leftWristVelocity = null;
    this.rightWristVelocity = null;
    this.lastEvent = null;
    this.motionResult = {
      ...EMPTY_RESULT,
      timestamp: 0,
      confidence: 0,
    };
    this.refreshDiagnostics(0, 0, null, null, null, null);
  }

  update(frame: PoseResult): MotionEvent[] {
    const timestamp = Number.isFinite(frame.timestamp)
      ? frame.timestamp
      : Date.now();
    const confidence = clampUnit(frame.confidence);
    const events: MotionEvent[] = [];

    if (
      this.lastPoseTimestamp !== null &&
      (!Number.isFinite(timestamp) || timestamp <= this.lastPoseTimestamp)
    ) {
      this.resetTemporalReferences();
    }
    this.lastPoseTimestamp = timestamp;
    const leanState = this.bodyLeanController.update(frame);

    if (!frame.detected || confidence < MOTION_CONTROLLER_CONFIG.minPoseConfidence) {
      this.smoother.reset();
      this.motionResult = this.motionEngine.processPose(frame);
      this.overallInvalidSince ??= timestamp;
      if (
        timestamp - this.overallInvalidSince >= MOTION_CONTROLLER_CONFIG.trackingLossTimeoutMs &&
        !this.trackingInputsReleased
      ) {
        this.releaseContinuousInputs(timestamp, confidence, events);
        this.trackingInputsReleased = true;
        this.resetRecognitionState();
        this.trackingInputsReleased = true;
      }
      if (events.length > 0) this.lastEvent = events[events.length - 1];
      this.refreshDiagnostics(timestamp, confidence, null, null, null, null);
      return events;
    }

    this.trackingInputsReleased = false;
    this.overallInvalidSince = null;
    const stablePose = this.smoother.smooth(frame);
    const result = this.motionEngine.processSmoothedPose(stablePose);
    this.motionResult = result;

    const leftHip = result.trustedLandmarks.leftHip;
    const rightHip = result.trustedLandmarks.rightHip;
    const leftKnee = result.trustedLandmarks.leftKnee;
    const rightKnee = result.trustedLandmarks.rightKnee;
    const leftAnkle = result.trustedLandmarks.leftAnkle;
    const rightAnkle = result.trustedLandmarks.rightAnkle;
    const scale = getBodyScale(result.body, leftHip, rightHip);
    const lowerBodyAvailable = Boolean(
      scale &&
      isTrusted(leftHip) &&
      isTrusted(rightHip) &&
      isTrusted(leftKnee) &&
      isTrusted(rightKnee) &&
      isTrusted(leftAnkle) &&
      isTrusted(rightAnkle),
    );

    if (lowerBodyAvailable && scale) {
      this.lowerBodyInvalidSince = null;
      this.processRun(
        timestamp,
        scale,
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
        leftAnkle,
        rightAnkle,
        events,
      );
      this.processJump(
        timestamp,
        scale,
        leftHip,
        rightHip,
        leftAnkle,
        rightAnkle,
        events,
      );
    } else {
      this.lowerBodyInvalidSince ??= timestamp;
      this.leftKneeVelocity = null;
      this.rightKneeVelocity = null;
      this.hipUpVelocity = null;
      this.clearRunVelocityReference();
      this.clearJumpVelocityReference();
      if (timestamp - this.lowerBodyInvalidSince >= MOTION_CONTROLLER_CONFIG.invalidResetMs) {
        if (this.running) {
          events.push(makeEvent('RUN_STOP', timestamp, confidence));
        }
        this.running = false;
        this.resetRunSequence();
        this.resetJumpState();
        this.jumpBaseline = null;
      }
    }

    this.processArm(
      'left', timestamp, scale, result, events,
    );
    this.processArm(
      'right', timestamp, scale, result, events,
    );
    this.processCrouch(result, timestamp, events);

    if (!leanState.isTracking && !leanState.calibrating && !this.trackingInputsReleased) {
      this.releaseContinuousInputs(timestamp, confidence, events);
      this.running = false;
      this.crouching = false;
      this.trackingInputsReleased = true;
    } else if (leanState.isTracking) {
      this.trackingInputsReleased = false;
    }

    if (events.length > 0) this.lastEvent = events[events.length - 1];

    this.refreshDiagnostics(
      timestamp,
      confidence,
      this.leftKneeVelocity,
      this.rightKneeVelocity,
      this.hipUpVelocity,
      scale,
    );
    return events;
  }

  updateWithDiagnostics(frame: PoseResult): MotionControllerUpdate {
    const events = this.update(frame);
    return {
      events,
      state: this.state,
      motionResult: this.motionResult,
      diagnostics: this.diagnostics,
    };
  }

  private processRun(
    timestamp: number,
    scale: number,
    leftHip: MotionPoint | undefined,
    rightHip: MotionPoint | undefined,
    leftKnee: MotionPoint | undefined,
    rightKnee: MotionPoint | undefined,
    leftAnkle: MotionPoint | undefined,
    rightAnkle: MotionPoint | undefined,
    events: MotionEvent[],
  ): void {
    if (
      !isTrusted(leftHip) || !isTrusted(rightHip) ||
      !isTrusted(leftKnee) || !isTrusted(rightKnee) ||
      !isTrusted(leftAnkle) || !isTrusted(rightAnkle)
    ) return;

    const leftLift = (
      (leftHip.y - leftKnee.y) * 0.65 +
      (leftHip.y - leftAnkle.y) * 0.35
    ) / scale;
    const rightLift = (
      (rightHip.y - rightKnee.y) * 0.65 +
      (rightHip.y - rightAnkle.y) * 0.35
    ) / scale;
    const previous = this.runHistory[this.runHistory.length - 1];
    const deltaMs = previous ? timestamp - previous.timestamp : null;

    this.runHistory.push({ timestamp, leftLift, rightLift });
    this.pruneRunHistory(timestamp);
    this.leftKneeVelocity = previous && isUsableDelta(deltaMs)
      ? ((leftLift - previous.leftLift) / deltaMs) * 1_000
      : null;
    this.rightKneeVelocity = previous && isUsableDelta(deltaMs)
      ? ((rightLift - previous.rightLift) / deltaMs) * 1_000
      : null;

    const sufficientExcursion =
      getRange(this.runHistory, 'leftLift') >= MOTION_CONTROLLER_CONFIG.runLegExcursionThresholdScale &&
      getRange(this.runHistory, 'rightLift') >= MOTION_CONTROLLER_CONFIG.runLegExcursionThresholdScale;
    const opposingMotion =
      this.leftKneeVelocity !== null &&
      this.rightKneeVelocity !== null &&
      Math.abs(this.leftKneeVelocity) >= MOTION_CONTROLLER_CONFIG.runLegVelocityThresholdScalePerSecond &&
      Math.abs(this.rightKneeVelocity) >= MOTION_CONTROLLER_CONFIG.runLegVelocityThresholdScalePerSecond &&
      this.leftKneeVelocity * this.rightKneeVelocity < 0;

    if (sufficientExcursion && opposingMotion) {
      const direction: -1 | 1 = this.leftKneeVelocity! > 0 ? 1 : -1;
      const interval = this.runLastDirectionAt === null
        ? Number.POSITIVE_INFINITY
        : timestamp - this.runLastDirectionAt;
      if (
        this.runLastDirection !== null &&
        direction !== this.runLastDirection &&
        interval >= MOTION_CONTROLLER_CONFIG.runMinAlternationIntervalMs
      ) {
        this.runAlternations += 1;
      }
      if (this.runLastDirection === null || direction !== this.runLastDirection) {
        this.runLastDirectionAt = timestamp;
      }
      this.runLastDirection = direction;
      this.runLastMotionAt = timestamp;
      if (this.runAlternations >= MOTION_CONTROLLER_CONFIG.runMinAlternations) {
        this.runCandidateSince ??= timestamp;
      }
    } else if (
      this.runLastMotionAt === null ||
      timestamp - this.runLastMotionAt > MOTION_CONTROLLER_CONFIG.runMaxAlternationGapMs
    ) {
      this.resetRunSequence();
    }

    if (
      !this.running &&
      this.runCandidateSince !== null &&
      this.runLastMotionAt !== null &&
      timestamp - this.runCandidateSince >= MOTION_CONTROLLER_CONFIG.runStartConfirmationMs &&
      timestamp - this.runLastMotionAt <= MOTION_CONTROLLER_CONFIG.runMaxAlternationGapMs
    ) {
      this.running = true;
      events.push(makeEvent('RUN_START', timestamp, getLegConfidence(
        leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle,
      )));
    }

    if (
      this.running &&
      this.jumpPhase === 'GROUNDED' &&
      this.runLastMotionAt !== null &&
      timestamp - this.runLastMotionAt >= MOTION_CONTROLLER_CONFIG.runStopTimeoutMs
    ) {
      this.running = false;
      this.resetRunSequence();
      events.push(makeEvent('RUN_STOP', timestamp, getLegConfidence(
        leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle,
      )));
    }
  }

  private processJump(
    timestamp: number,
    scale: number,
    leftHip: MotionPoint | undefined,
    rightHip: MotionPoint | undefined,
    leftAnkle: MotionPoint | undefined,
    rightAnkle: MotionPoint | undefined,
    events: MotionEvent[],
  ): void {
    if (
      !isTrusted(leftHip) || !isTrusted(rightHip) ||
      !isTrusted(leftAnkle) || !isTrusted(rightAnkle) ||
      !Number.isFinite(scale) || scale <= 1e-6
    ) {
      this.clearJumpVelocityReference();
      return;
    }

    const hipY = (leftHip.y + rightHip.y) / 2;
    const baseline = this.jumpBaseline;
    const leftFootRise = baseline ? (baseline.leftFootY - leftAnkle.y) / scale : 0;
    const rightFootRise = baseline ? (baseline.rightFootY - rightAnkle.y) / scale : 0;
    const hipRise = baseline ? (baseline.hipY - hipY) / scale : 0;
    const deltaMs = this.previousJumpTimestamp === null
      ? null
      : timestamp - this.previousJumpTimestamp;
    this.hipUpVelocity = this.previousHipY !== null && isUsableDelta(deltaMs)
      ? ((this.previousHipY - hipY) / scale / deltaMs) * 1_000
      : null;

    if (!this.jumpBaseline) {
      this.jumpBaseline = {
        hipY,
        leftFootY: leftAnkle.y,
        rightFootY: rightAnkle.y,
      };
    }

    if (this.jumpPhase === 'GROUNDED') {
      const bothFeetRose =
        leftFootRise >= MOTION_CONTROLLER_CONFIG.jumpMinFootRiseScale &&
        rightFootRise >= MOTION_CONTROLLER_CONFIG.jumpMinFootRiseScale;
      const takeoff =
        baseline !== null &&
        bothFeetRose &&
        hipRise >= MOTION_CONTROLLER_CONFIG.jumpMinHipRiseScale &&
        (this.hipUpVelocity ?? 0) >= MOTION_CONTROLLER_CONFIG.jumpMinUpwardVelocityScalePerSecond &&
        timestamp - this.lastJumpAt >= MOTION_CONTROLLER_CONFIG.jumpCooldownMs;

      if (takeoff) {
        this.jumpPhase = 'AIRBORNE';
        this.jumpStartedAt = timestamp;
        this.peakHipY = hipY;
        this.landingStartedAt = null;
        this.lastJumpAt = timestamp;
        events.push(makeEvent('JUMP', timestamp, getLegConfidence(
          leftHip, rightHip, leftAnkle, rightAnkle,
        )));
      } else if (!this.running && !this.crouching) {
        this.adaptJumpBaseline(hipY, leftAnkle.y, rightAnkle.y);
      }
    } else {
      this.peakHipY = Math.min(this.peakHipY ?? hipY, hipY);
      const flightExpired =
        timestamp - (this.jumpStartedAt ?? timestamp) >= MOTION_CONTROLLER_CONFIG.jumpFlightTimeoutMs;
      const descended =
        (hipY - (this.peakHipY ?? hipY)) / scale >= MOTION_CONTROLLER_CONFIG.jumpDescentScale;
      if (flightExpired) {
        this.resetJumpState();
        this.adaptJumpBaseline(hipY, leftAnkle.y, rightAnkle.y);
      } else if (descended) {
        this.jumpPhase = 'LANDING';
        const landed = Boolean(
          this.jumpBaseline &&
          (leftAnkle.y - this.jumpBaseline.leftFootY) / scale >= -MOTION_CONTROLLER_CONFIG.jumpLandingToleranceScale &&
          (rightAnkle.y - this.jumpBaseline.rightFootY) / scale >= -MOTION_CONTROLLER_CONFIG.jumpLandingToleranceScale &&
          hipY >= this.jumpBaseline.hipY - scale * MOTION_CONTROLLER_CONFIG.jumpLandingToleranceScale,
        );
        if (landed) {
          this.landingStartedAt ??= timestamp;
          if (timestamp - this.landingStartedAt >= MOTION_CONTROLLER_CONFIG.jumpLandingConfirmationMs) {
            this.resetJumpState();
            this.adaptJumpBaseline(hipY, leftAnkle.y, rightAnkle.y);
          }
        } else {
          this.landingStartedAt = null;
        }
      }
    }

    this.previousHipY = hipY;
    this.previousJumpTimestamp = timestamp;
  }

  private processArm(
    side: 'left' | 'right',
    timestamp: number,
    scale: number | null,
    result: MotionResult,
    events: MotionEvent[],
  ): void {
    const shoulder = result.trustedLandmarks[`${side}Shoulder`];
    const elbow = result.trustedLandmarks[`${side}Elbow`];
    const wrist = result.trustedLandmarks[`${side}Wrist`];
    if (
      !isTrusted(shoulder) || !isTrusted(elbow) || !isTrusted(wrist) ||
      scale === null || scale <= 1e-6
    ) {
      this.setArmPrevious(side, null);
      this.setArmVelocity(side, null);
      this.setArmQuietSince(side, null);
      return;
    }

    const current: RelativeArmPoint = {
      x: (wrist.x - shoulder.x) / scale,
      y: (wrist.y - shoulder.y) / scale,
      confidence: Math.min(shoulder.confidence, elbow.confidence, wrist.confidence),
    };
    const previous = this.getArmPrevious(side);
    const deltaMs = previous ? timestamp - (this.getArmPreviousTimestamp(side) ?? timestamp) : null;
    const displacement = previous ? Math.hypot(current.x - previous.x, current.y - previous.y) : 0;
    const velocity = previous && isUsableDelta(deltaMs)
      ? displacement / (deltaMs / 1_000)
      : null;
    this.setArmVelocity(side, velocity);
    this.setArmPrevious(side, current, timestamp);

    if (!this.isArmArmed(side)) {
      if (
        velocity !== null &&
        velocity <= MOTION_CONTROLLER_CONFIG.armSwingRearmVelocityScalePerSecond &&
        timestamp - this.lastArmSwingAt >= MOTION_CONTROLLER_CONFIG.armSwingCooldownMs
      ) {
        const quietSince = this.getArmQuietSince(side) ?? timestamp;
        this.setArmQuietSince(side, quietSince);
        if (timestamp - quietSince >= MOTION_CONTROLLER_CONFIG.armSwingRearmQuietMs) {
          this.setArmArmed(side, true);
        }
      } else {
        this.setArmQuietSince(side, null);
      }
    }

    if (
      this.isArmArmed(side) &&
      velocity !== null &&
      velocity >= MOTION_CONTROLLER_CONFIG.armSwingVelocityThresholdScalePerSecond &&
      displacement >= MOTION_CONTROLLER_CONFIG.armSwingDisplacementThresholdScale &&
      timestamp - this.lastArmSwingAt >= MOTION_CONTROLLER_CONFIG.armSwingCooldownMs
    ) {
      this.leftArmArmed = false;
      this.rightArmArmed = false;
      this.leftArmQuietSince = null;
      this.rightArmQuietSince = null;
      this.lastArmSwingAt = timestamp;
      events.push(makeEvent('ARM_SWING', timestamp, current.confidence));
    }
  }

  private processCrouch(
    result: MotionResult,
    timestamp: number,
    events: MotionEvent[],
  ): void {
    const squat = result.gestures.find((gesture) => gesture.type === 'SQUAT');
    if (!squat?.available) {
      this.crouchInvalidSince ??= timestamp;
      if (timestamp - this.crouchInvalidSince >= MOTION_CONTROLLER_CONFIG.crouchTrackingLossTimeoutMs) {
        if (this.crouching) {
          events.push(makeEvent('CROUCH_END', timestamp, result.confidence));
        }
        this.crouching = false;
        this.crouchCandidateSince = null;
        this.crouchReleaseSince = null;
      }
      return;
    }
    this.crouchInvalidSince = null;

    const confidence = Math.max(
      MOTION_CONTROLLER_CONFIG.crouchConfidenceFloor,
      squat.confidence,
    );
    if (squat.active) {
      this.crouchReleaseSince = null;
      if (!this.crouching) {
        this.crouchCandidateSince ??= timestamp;
        if (timestamp - this.crouchCandidateSince >= MOTION_CONTROLLER_CONFIG.crouchConfirmationMs) {
          this.crouching = true;
          this.crouchCandidateSince = null;
          events.push(makeEvent('CROUCH_START', timestamp, confidence));
        }
      }
    } else {
      this.crouchCandidateSince = null;
      if (this.crouching) {
        this.crouchReleaseSince ??= timestamp;
        if (timestamp - this.crouchReleaseSince >= MOTION_CONTROLLER_CONFIG.crouchReleaseMs) {
          this.crouching = false;
          this.crouchReleaseSince = null;
          events.push(makeEvent('CROUCH_END', timestamp, confidence));
        }
      }
    }
  }

  private adaptJumpBaseline(hipY: number, leftFootY: number, rightFootY: number): void {
    const adaptation = MOTION_CONTROLLER_CONFIG.jumpBaselineAdaptation;
    this.jumpBaseline = this.jumpBaseline
      ? {
          hipY: blend(this.jumpBaseline.hipY, hipY, adaptation),
          leftFootY: blend(this.jumpBaseline.leftFootY, leftFootY, adaptation),
          rightFootY: blend(this.jumpBaseline.rightFootY, rightFootY, adaptation),
        }
      : { hipY, leftFootY, rightFootY };
  }

  private refreshDiagnostics(
    timestamp: number,
    confidence: number,
    leftKneeVelocity: number | null,
    rightKneeVelocity: number | null,
    hipUpVelocity: number | null,
    scale: number | null,
  ): void {
    const baseline = this.jumpBaseline;
    const leftAnkle = this.motionResult.trustedLandmarks.leftAnkle;
    const rightAnkle = this.motionResult.trustedLandmarks.rightAnkle;
    this.diagnostics = makeDiagnostics(
      this.state,
      confidence,
      this.running,
      this.crouching,
      getGestureConfidence(this.motionResult),
      this.runAlternations,
      this.jumpPhase,
      leftKneeVelocity,
      rightKneeVelocity,
      hipUpVelocity,
      scale && baseline && leftAnkle
        ? (baseline.leftFootY - leftAnkle.y) / scale
        : null,
      scale && baseline && rightAnkle
        ? (baseline.rightFootY - rightAnkle.y) / scale
        : null,
      cooldownRemaining(MOTION_CONTROLLER_CONFIG.jumpCooldownMs, timestamp, this.lastJumpAt),
      this.lastEvent,
      this.runHistory.length,
    );
    this.diagnostics.arm.leftWristVelocityScalePerSecond = this.leftWristVelocity;
    this.diagnostics.arm.rightWristVelocityScalePerSecond = this.rightWristVelocity;
    this.diagnostics.arm.cooldownRemainingMs = cooldownRemaining(
      MOTION_CONTROLLER_CONFIG.armSwingCooldownMs,
      timestamp,
      this.lastArmSwingAt,
    );
  }

  private resetRunSequence(): void {
    this.runLastDirection = null;
    this.runAlternations = 0;
    this.runLastDirectionAt = null;
    this.runLastMotionAt = null;
    this.runCandidateSince = null;
  }

  private pruneRunHistory(timestamp: number): void {
    while (
      this.runHistory.length > 0 &&
      timestamp - this.runHistory[0].timestamp > MOTION_CONTROLLER_CONFIG.historyWindowMs
    ) this.runHistory.shift();
    while (this.runHistory.length > MOTION_CONTROLLER_CONFIG.maxHistorySamples) {
      this.runHistory.shift();
    }
  }

  private clearRunVelocityReference(): void {
    this.runHistory.length = 0;
    this.resetRunSequence();
  }

  private clearJumpVelocityReference(): void {
    this.previousHipY = null;
    this.previousJumpTimestamp = null;
  }

  private resetJumpState(): void {
    this.jumpPhase = 'GROUNDED';
    this.jumpStartedAt = null;
    this.peakHipY = null;
    this.landingStartedAt = null;
    this.clearJumpVelocityReference();
  }

  private resetTemporalReferences(): void {
    this.smoother.reset();
    this.bodyLeanController.reset();
    this.runHistory.length = 0;
    this.resetRunSequence();
    this.clearJumpVelocityReference();
    this.leftArmPrevious = null;
    this.rightArmPrevious = null;
    this.leftArmPreviousTimestamp = null;
    this.rightArmPreviousTimestamp = null;
    this.leftArmQuietSince = null;
    this.rightArmQuietSince = null;
  }

  private resetRecognitionState(): void {
    this.running = false;
    this.crouching = false;
    this.resetRunSequence();
    this.runHistory.length = 0;
    this.resetJumpState();
    this.jumpBaseline = null;
    this.leftArmPrevious = null;
    this.rightArmPrevious = null;
    this.leftArmPreviousTimestamp = null;
    this.rightArmPreviousTimestamp = null;
    this.leftArmArmed = true;
    this.rightArmArmed = true;
    this.lastPoseTimestamp = null;
    this.overallInvalidSince = null;
    this.lowerBodyInvalidSince = null;
    this.crouchInvalidSince = null;
    this.crouchCandidateSince = null;
    this.crouchReleaseSince = null;
  }

  private releaseContinuousInputs(
    timestamp: number,
    confidence: number,
    events: MotionEvent[],
  ): void {
    if (this.running) events.push(makeEvent('RUN_STOP', timestamp, confidence));
    if (this.crouching) events.push(makeEvent('CROUCH_END', timestamp, confidence));
  }

  private getArmPrevious(side: 'left' | 'right'): RelativeArmPoint | null {
    return side === 'left' ? this.leftArmPrevious : this.rightArmPrevious;
  }

  private getArmPreviousTimestamp(side: 'left' | 'right'): number | null {
    return side === 'left' ? this.leftArmPreviousTimestamp : this.rightArmPreviousTimestamp;
  }

  private setArmPrevious(
    side: 'left' | 'right',
    point: RelativeArmPoint | null,
    timestamp?: number,
  ): void {
    if (side === 'left') {
      this.leftArmPrevious = point;
      this.leftArmPreviousTimestamp = point ? timestamp ?? null : null;
    } else {
      this.rightArmPrevious = point;
      this.rightArmPreviousTimestamp = point ? timestamp ?? null : null;
    }
  }

  private getArmQuietSince(side: 'left' | 'right'): number | null {
    return side === 'left' ? this.leftArmQuietSince : this.rightArmQuietSince;
  }

  private setArmQuietSince(side: 'left' | 'right', timestamp: number | null): void {
    if (side === 'left') this.leftArmQuietSince = timestamp;
    else this.rightArmQuietSince = timestamp;
  }

  private isArmArmed(side: 'left' | 'right'): boolean {
    return side === 'left' ? this.leftArmArmed : this.rightArmArmed;
  }

  private setArmArmed(side: 'left' | 'right', armed: boolean): void {
    if (side === 'left') this.leftArmArmed = armed;
    else this.rightArmArmed = armed;
  }

  private setArmVelocity(side: 'left' | 'right', velocity: number | null): void {
    if (side === 'left') this.leftWristVelocity = velocity;
    else this.rightWristVelocity = velocity;
  }
}

function makeDiagnostics(
  state: ContinuousMotionState,
  confidence: number,
  running: boolean,
  crouching: boolean,
  crouchConfidence: number,
  alternations: number,
  jumpPhase: JumpControllerPhase,
  leftKneeVelocity: number | null,
  rightKneeVelocity: number | null,
  hipUpVelocity: number | null,
  leftFootRise: number | null,
  rightFootRise: number | null,
  jumpCooldownRemainingMs: number,
  lastEvent: MotionEvent | null,
  windowSamples: number,
): MotionControllerDiagnostics {
  return {
    state,
    confidence,
    run: {
      active: running,
      leftKneeVelocityScalePerSecond: leftKneeVelocity,
      rightKneeVelocityScalePerSecond: rightKneeVelocity,
      alternations,
      windowSamples,
    },
    jump: {
      phase: jumpPhase,
      hipUpVelocityScalePerSecond: hipUpVelocity,
      leftFootRiseScale: leftFootRise,
      rightFootRiseScale: rightFootRise,
      cooldownRemainingMs: jumpCooldownRemainingMs,
    },
    arm: {
      leftWristVelocityScalePerSecond: null,
      rightWristVelocityScalePerSecond: null,
      cooldownRemainingMs: 0,
    },
    crouch: { active: crouching, confidence: crouchConfidence },
    lastEvent,
  };
}

function makeEvent(
  type: MotionEvent['type'],
  timestamp: number,
  confidence: number,
): MotionEvent {
  const motion = type === 'RUN_START' || type === 'RUN_STOP'
    ? 'RUN'
    : type === 'CROUCH_START' || type === 'CROUCH_END'
      ? 'CROUCH'
      : type;
  const event = { type, timestamp, confidence: clampUnit(confidence), motion } as MotionEvent;
  return event;
}

function isTrusted(point: MotionPoint | undefined): point is MotionPoint {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.confidence) &&
    point.confidence >= MOTION_CONTROLLER_CONFIG.minLandmarkConfidence,
  );
}

function getBodyScale(
  body: MotionBody,
  leftHip: MotionPoint | undefined,
  rightHip: MotionPoint | undefined,
): number | null {
  if (body.shoulderWidth && body.shoulderWidth > 1e-6) return body.shoulderWidth;
  if (isTrusted(leftHip) && isTrusted(rightHip)) {
    const hipWidth = Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y);
    if (hipWidth > 1e-6) return hipWidth;
  }
  const fallback = body.torsoHeight === null ? null : body.torsoHeight * 0.6;
  return fallback && fallback > 1e-6 ? fallback : null;
}

function getRange(samples: readonly RunSample[], key: 'leftLift' | 'rightLift'): number {
  if (samples.length < 2) return 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample[key]);
    max = Math.max(max, sample[key]);
  }
  return max - min;
}

function getLegConfidence(...points: (MotionPoint | undefined)[]): number {
  let confidence = 1;
  for (const point of points) {
    confidence = Math.min(confidence, point?.confidence ?? 0);
  }
  return confidence;
}

function getGestureConfidence(result: MotionResult): number {
  const squat = result.gestures.find((gesture) => gesture.type === 'SQUAT');
  return squat?.confidence ?? 0;
}

function isUsableDelta(deltaMs: number | null): deltaMs is number {
  return Boolean(
    deltaMs !== null &&
    Number.isFinite(deltaMs) &&
    deltaMs > 0 &&
    deltaMs <= MOTION_CONTROLLER_CONFIG.maxFrameGapMs,
  );
}

function cooldownRemaining(cooldownMs: number, timestamp: number, lastAt: number): number {
  if (!Number.isFinite(lastAt)) return 0;
  return Math.max(0, cooldownMs - (timestamp - lastAt));
}

function blend(previous: number, current: number, ratio: number): number {
  return previous * (1 - ratio) + current * ratio;
}
