import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AppState,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { CameraStatus, type StatusTone } from '../components/CameraStatus';
import {
  assessBodyVisibility,
  getPoseLandmarkScore,
  type BodyVisibilityAssessment,
} from '../detection/bodyVisibility';
import { PoseDetectorCamera } from '../detection/PoseDetectorCamera';
import { DEBUG_POSE, POSE_DETECTION_CONFIG } from '../detection/poseConfig';
import type {
  CameraFacing,
  CameraPermissionState,
  CameraPreviewState,
  CameraReadyInfo,
  PoseDetectionState,
  PoseDetectorErrorCode,
  PoseLandmarkName,
  PosePerformanceMetrics,
  PoseResult,
} from '../detection/types';
import { getMotionHighlights, MotionController } from '../motion';
import { MOTION_CONFIG } from '../motion/thresholds';
import type { GestureEvent, GestureType, MotionResult } from '../motion/types';
import type {
  BodyLeanState,
  ContinuousMotionState,
  HorizontalMovement,
  MotionControllerDiagnostics,
  MotionEvent,
} from '../motion/controllerTypes';
import { NEUTRAL_HORIZONTAL_MOVEMENT } from '../motion/controllerTypes';
import { BODY_LEAN_CONFIG } from '../motion/motionThresholds';
import { MotionProcessingMeter, type MotionProcessingSnapshot } from '../motion/MotionProcessingMeter';
import { colors, radius, spacing } from '../theme';

type CameraScreenProps = {
  onExit: () => void;
  gameMode?: boolean;
  previewVisible?: boolean;
  motionEnabled?: boolean;
  autoCalibrate?: boolean;
  onGestureEvent?: (event: GestureEvent) => void;
  onMotionEvent?: (event: MotionEvent) => void;
  onHorizontalMovement?: (movement: HorizontalMovement) => void;
  onSessionReady?: () => void;
  onSessionSuspended?: () => void;
  onSessionError?: (error: PoseDetectorErrorCode) => void;
  children?: ReactNode;
};

export interface CameraGameOverlayInfo {
  cameraStatus: CameraPreviewState;
  detectorState: PoseDetectionState;
  bodyVisibility: BodyVisibilityAssessment;
  confidence: number | null;
  cameraInfo: CameraReadyInfo | null;
  thermalState: PoseResult['thermalState'] | null;
  poseModelDelegate: PoseResult['poseModelDelegate'] | null;
  poseModelVariant: PoseResult['poseModelVariant'] | null;
  metrics: PosePerformanceMetrics | null;
  lastEvent: GestureEvent | null;
  motionState: ContinuousMotionState;
  motionDiagnostics: MotionControllerDiagnostics | null;
  bodyLean: BodyLeanState;
  motionProcessing: MotionProcessingSnapshot;
  lastMotionEvent: MotionEvent | null;
  errorCode: PoseDetectorErrorCode | null;
  errorMessage: string | null;
  resetMotionController: () => void;
  beginNeutralCalibration: () => void;
  completeNeutralCalibration: () => void;
  retryCamera: () => void;
  flipCamera: () => void;
}

const CameraGameSessionContext = createContext<CameraGameOverlayInfo | null>(null);

export function useCameraGameSession(): CameraGameOverlayInfo {
  const camera = useContext(CameraGameSessionContext);
  if (!camera) {
    throw new Error('Game camera session details are only available in game mode.');
  }
  return camera;
}

interface PoseDisplaySummary {
  state: Exclude<PoseDetectionState, 'initializing' | 'error'>;
  confidence: number;
  inferenceDurationMs: number | null;
  landmarkCount: number;
  hasResult: boolean;
  thermalState: PoseResult['thermalState'] | null;
  poseModelDelegate: PoseResult['poseModelDelegate'] | null;
  poseModelVariant: PoseResult['poseModelVariant'] | null;
  bodyVisibility: BodyVisibilityAssessment;
  landmarkScores: PoseLandmarkScores;
}

interface PoseLandmarkScores {
  head: number | null;
  leftShoulder: number | null;
  rightShoulder: number | null;
  leftHip: number | null;
  rightHip: number | null;
  leftKnee: number | null;
  rightKnee: number | null;
  leftAnkle: number | null;
  rightAnkle: number | null;
}

const UI_POSE_UPDATE_INTERVAL_MS = 400;
const DEBUG_METRICS_UPDATE_INTERVAL_MS = 400;
const EMPTY_BODY_VISIBILITY = assessBodyVisibility(null);
const EMPTY_MOTION_PROCESSING: MotionProcessingSnapshot = {
  sampleCount: 0,
  rateHz: 0,
  averageMs: 0,
  maximumMs: 0,
};
const NEUTRAL_BODY_LEAN: BodyLeanState = {
  direction: 0,
  intensity: 0,
  angleDegrees: 0,
  rawAngleDegrees: null,
  trackingConfidence: 0,
  isTracking: false,
  calibrated: false,
  calibrating: false,
};

export function CameraScreen({
  onExit,
  gameMode = false,
  previewVisible = true,
  motionEnabled = true,
  autoCalibrate = false,
  onGestureEvent,
  onMotionEvent,
  onHorizontalMovement,
  onSessionReady,
  onSessionSuspended,
  onSessionError,
  children,
}: CameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [permissionRequestPending, setPermissionRequestPending] = useState(false);
  const [permissionRequestFailed, setPermissionRequestFailed] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraPreviewState>('starting');
  const [cameraInfo, setCameraInfo] = useState<CameraReadyInfo | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('front');
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [detectorError, setDetectorError] = useState<PoseDetectorErrorCode | null>(
    null,
  );
  const [poseSummary, setPoseSummary] = useState<PoseDisplaySummary>(
    createEmptyPoseDisplaySummary,
  );
  const [metrics, setMetrics] = useState<PosePerformanceMetrics | null>(null);
  const [startupTimeMs, setStartupTimeMs] = useState<number | null>(null);
  const [motionResult, setMotionResult] = useState<MotionResult | null>(null);
  const [eventLog, setEventLog] = useState<GestureEvent[]>([]);
  const [lastGestureEvent, setLastGestureEvent] = useState<GestureEvent | null>(null);
  const motionControllerRef = useRef<MotionController | null>(null);
  if (motionControllerRef.current === null) {
    motionControllerRef.current = new MotionController();
  }
  const [motionDiagnostics, setMotionDiagnostics] = useState<MotionControllerDiagnostics | null>(null);
  const [bodyLean, setBodyLean] = useState<BodyLeanState>(NEUTRAL_BODY_LEAN);
  const [motionProcessing, setMotionProcessing] = useState<MotionProcessingSnapshot>(EMPTY_MOTION_PROCESSING);
  const [lastMotionEvent, setLastMotionEvent] = useState<MotionEvent | null>(null);
  const [motionEventLog, setMotionEventLog] = useState<MotionEvent[]>([]);
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState === 'active',
  );
  const motionEnabledRef = useRef(motionEnabled);
  const permissionRequestAttempted = useRef(false);
  const lastPoseUiUpdateAt = useRef(0);
  const lastPoseUiState = useRef<PoseDisplaySummary['state']>('looking');
  const lastMotionUiUpdateAt = useRef(0);
  const lastDebugMetricsUpdateAt = useRef(0);
  const lastPoseArrivalAt = useRef<number | null>(null);
  const trackingLossReported = useRef(true);
  const motionProcessingMeterRef = useRef<MotionProcessingMeter | null>(null);
  if (motionProcessingMeterRef.current === null) {
    motionProcessingMeterRef.current = new MotionProcessingMeter();
  }
  const cameraStartTime = useRef(0);
  const insets = useSafeAreaInsets();

  const resetMotionController = useCallback(() => {
    motionControllerRef.current?.reset();
    setMotionResult(null);
    setEventLog([]);
    setLastGestureEvent(null);
    setMotionDiagnostics(null);
    setBodyLean(motionControllerRef.current?.bodyLeanState ?? NEUTRAL_BODY_LEAN);
    motionProcessingMeterRef.current?.reset();
    setMotionProcessing({ sampleCount: 0, rateHz: 0, averageMs: 0, maximumMs: 0 });
    setLastMotionEvent(null);
    setMotionEventLog([]);
    lastMotionUiUpdateAt.current = 0;
    lastPoseArrivalAt.current = null;
    trackingLossReported.current = true;
  }, []);

  const beginNeutralCalibration = useCallback(() => {
    resetMotionController();
    motionControllerRef.current?.beginNeutralCalibration();
    setBodyLean(motionControllerRef.current?.bodyLeanState ?? NEUTRAL_BODY_LEAN);
    lastPoseArrivalAt.current = Date.now();
    trackingLossReported.current = false;
  }, [resetMotionController]);

  const completeNeutralCalibration = useCallback(() => {
    const next = motionControllerRef.current?.completeNeutralCalibration();
    if (next) setBodyLean(next);
  }, []);

  const releaseMotionInputs = useCallback(() => {
    const timestamp = Date.now();
    onMotionEvent?.({ type: 'RUN_STOP', timestamp, confidence: 1, motion: 'RUN' });
    onMotionEvent?.({ type: 'CROUCH_END', timestamp, confidence: 1, motion: 'CROUCH' });
    onHorizontalMovement?.(NEUTRAL_HORIZONTAL_MOVEMENT);
  }, [onHorizontalMovement, onMotionEvent]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const isActive = nextState === 'active';
      if (!isActive) {
        releaseMotionInputs();
        resetMotionController();
        lastPoseUiUpdateAt.current = 0;
        lastPoseUiState.current = 'looking';
        setPoseSummary(createEmptyPoseDisplaySummary());
        setMetrics(null);
        lastPoseArrivalAt.current = null;
        trackingLossReported.current = true;
      }
      setAppIsActive(isActive);
    });

    return () => subscription.remove();
  }, [releaseMotionInputs, resetMotionController]);

  useEffect(() => () => motionControllerRef.current?.reset(), []);

  useEffect(() => {
    motionEnabledRef.current = motionEnabled;
    if (!motionEnabled) {
      motionControllerRef.current?.reset();
      onHorizontalMovement?.(NEUTRAL_HORIZONTAL_MOVEMENT);
      lastPoseArrivalAt.current = null;
      trackingLossReported.current = true;
      setBodyLean(motionControllerRef.current?.bodyLeanState ?? NEUTRAL_BODY_LEAN);
    }
  }, [motionEnabled, onHorizontalMovement]);

  useEffect(() => {
    if (!motionEnabled) return;
    const watchdog = setInterval(() => {
      const lastPoseAt = lastPoseArrivalAt.current;
      if (
        lastPoseAt === null ||
        trackingLossReported.current ||
        Date.now() - lastPoseAt < BODY_LEAN_CONFIG.trackingLossTimeoutMs
      ) return;

      trackingLossReported.current = true;
      const timestamp = Date.now();
      const events = motionControllerRef.current?.expireTracking(timestamp) ?? [];
      for (const event of events) onMotionEvent?.(event);
      onHorizontalMovement?.(motionControllerRef.current?.bodyLeanState ?? NEUTRAL_HORIZONTAL_MOVEMENT);
      setBodyLean(motionControllerRef.current?.bodyLeanState ?? NEUTRAL_BODY_LEAN);
      setMotionDiagnostics(motionControllerRef.current?.getDebugInfo() ?? null);
    }, 100);
    return () => clearInterval(watchdog);
  }, [motionEnabled, onHorizontalMovement, onMotionEvent]);

  useEffect(() => {
    if (permission?.granted) {
      cameraStartTime.current = Date.now();
    }
  }, [cameraAttempt, cameraFacing, permission?.granted]);

  const askForCameraPermission = useCallback(async () => {
    setPermissionRequestFailed(false);
    setPermissionRequestPending(true);

    try {
      await requestPermission();
    } catch {
      setPermissionRequestFailed(true);
    } finally {
      setPermissionRequestPending(false);
    }
  }, [requestPermission]);

  useEffect(() => {
    if (
      permission === null ||
      permission.granted ||
      !permission.canAskAgain ||
      permissionRequestAttempted.current
    ) {
      return;
    }

    permissionRequestAttempted.current = true;
    void askForCameraPermission();
  }, [askForCameraPermission, permission]);

  let permissionState: CameraPermissionState = 'checking';
  if (permission !== null) {
    permissionState = permission.granted ? 'granted' : 'denied';
  }

  useEffect(() => {
    if (!gameMode || permissionState !== 'denied') return;
    releaseMotionInputs();
    motionControllerRef.current?.reset();
    motionProcessingMeterRef.current?.reset();
    onSessionError?.('cameraPermission');
  }, [gameMode, onSessionError, permissionState, releaseMotionInputs]);

  const handleCameraReady = useCallback((camera: CameraReadyInfo) => {
    setCameraStatus('ready');
    setCameraInfo(camera);
    setDetectorError(null);
    lastPoseUiUpdateAt.current = 0;
    lastPoseUiState.current = 'looking';
    setPoseSummary(createEmptyPoseDisplaySummary());
    setStartupTimeMs(Date.now() - cameraStartTime.current);
    onSessionReady?.();
  }, [onSessionReady]);

  const handleCameraError = useCallback((error: PoseDetectorErrorCode) => {
    releaseMotionInputs();
    resetMotionController();
    setCameraStatus('unavailable');
    setCameraInfo(null);
    setDetectorError(error);
    lastPoseUiUpdateAt.current = 0;
    lastPoseUiState.current = 'looking';
    setPoseSummary(createEmptyPoseDisplaySummary());
    onSessionError?.(error);

    if (__DEV__) {
      if (error === 'nativeModuleUnavailable') {
        console.warn(
          '[CameraScreen] MediaPipe is missing from this app binary. Expo Go cannot load it; rebuild and open the Active Kids development build.',
        );
      } else if (error === 'cameraFacingUnavailable') {
        console.warn(
          '[CameraScreen] The selected camera is not available on this device. Switch cameras and try again.',
        );
      } else {
        console.error('[CameraScreen] Pose camera failed.', error);
      }
    }
  }, [onSessionError, releaseMotionInputs, resetMotionController]);

  const handlePose = useCallback((pose: PoseResult) => {
    lastPoseArrivalAt.current = Date.now();
    trackingLossReported.current = false;
    const controller = motionControllerRef.current;
    const isMotionEnabled = motionEnabledRef.current;
    const processingStartedAt = DEBUG_POSE ? getHighResolutionNow() : 0;
    const isCalibrating = controller?.bodyLeanState.calibrating ?? false;
    let motionEvents: MotionEvent[] = [];
    if (isMotionEnabled && controller) {
      if (isCalibrating) controller.updateCalibrationPose(pose);
      else motionEvents = controller.update(pose);
    }
    if (DEBUG_POSE && controller) {
      motionProcessingMeterRef.current?.record(processingStartedAt, getHighResolutionNow());
    }
    if (isMotionEnabled && controller) {
      onHorizontalMovement?.(controller.bodyLeanState);
    }
    const nextMotion = isMotionEnabled && !isCalibrating ? controller?.lastMotionResult : null;
    if (motionEvents.length > 0) {
      for (const event of motionEvents) onMotionEvent?.(event);
      setLastMotionEvent(motionEvents[motionEvents.length - 1]);
      if (DEBUG_POSE) {
        setMotionEventLog((current) =>
          [...current, ...motionEvents].slice(-MOTION_CONFIG.maxDebugEvents),
        );
      }
    }
    if (nextMotion) {
      if (nextMotion.events.length > 0) {
        for (const event of nextMotion.events) {
          onGestureEvent?.(event);
        }
        setLastGestureEvent(nextMotion.events[nextMotion.events.length - 1]);
      }

      if (DEBUG_POSE && nextMotion.events.length > 0) {
        setEventLog((current) => {
          const next = current.slice();
          for (const event of nextMotion.events) next.push(event);
          return next.slice(-MOTION_CONFIG.maxDebugEvents);
        });
      }

      const now = Date.now();
      if (
        nextMotion.events.length > 0 ||
        motionEvents.length > 0 ||
        now - lastMotionUiUpdateAt.current >= MOTION_CONFIG.debugUiUpdateIntervalMs
      ) {
        lastMotionUiUpdateAt.current = now;
        setMotionResult(nextMotion);
        setMotionDiagnostics(controller?.getDebugInfo() ?? null);
      }
    }

    const now = Date.now();
    if (
      DEBUG_POSE &&
      now - lastDebugMetricsUpdateAt.current >= DEBUG_METRICS_UPDATE_INTERVAL_MS
    ) {
      lastDebugMetricsUpdateAt.current = now;
      setBodyLean(controller?.bodyLeanState ?? NEUTRAL_BODY_LEAN);
      setMotionProcessing(motionProcessingMeterRef.current?.snapshot() ?? EMPTY_MOTION_PROCESSING);
    }

    let state: PoseDisplaySummary['state'] = 'looking';
    if (pose.detected) {
      state =
        pose.confidence < POSE_DETECTION_CONFIG.confidenceThreshold
          ? 'low-confidence'
          : 'detected';
    }

    const stateChanged = state !== lastPoseUiState.current;
    if (
      !stateChanged &&
      now - lastPoseUiUpdateAt.current < UI_POSE_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    const bodyVisibility = assessBodyVisibility(pose);
    lastPoseUiState.current = state;
    lastPoseUiUpdateAt.current = now;
    setPoseSummary({
      state,
      confidence: pose.confidence,
      inferenceDurationMs:
        typeof pose.inferenceDurationMs === 'number' &&
        Number.isFinite(pose.inferenceDurationMs)
          ? pose.inferenceDurationMs
          : null,
      landmarkCount: Object.keys(pose.landmarks).length,
      hasResult: true,
      thermalState: pose.thermalState ?? null,
      poseModelDelegate: pose.poseModelDelegate ?? null,
      poseModelVariant: pose.poseModelVariant ?? null,
      bodyVisibility,
      landmarkScores: getPoseLandmarkScores(pose),
    });
  }, [onGestureEvent, onHorizontalMovement, onMotionEvent]);

  const handleMetrics = useCallback((nextMetrics: PosePerformanceMetrics) => {
    if (DEBUG_POSE) setMetrics(nextMetrics);
  }, []);

  const beginCameraRestart = useCallback(() => {
    onSessionSuspended?.();
    releaseMotionInputs();
    resetMotionController();
    cameraStartTime.current = Date.now();
    lastPoseUiUpdateAt.current = 0;
    lastPoseUiState.current = 'looking';
    lastMotionUiUpdateAt.current = 0;
    setCameraStatus('starting');
    setCameraInfo(null);
    setDetectorError(null);
    setPoseSummary(createEmptyPoseDisplaySummary());
    setMetrics(null);
    setStartupTimeMs(null);
    setEventLog([]);
    setLastGestureEvent(null);
    setMotionEventLog([]);
    lastPoseArrivalAt.current = null;
    trackingLossReported.current = true;
  }, [onSessionSuspended, releaseMotionInputs, resetMotionController]);

  const retryCamera = useCallback(() => {
    beginCameraRestart();
    setCameraAttempt((attempt) => attempt + 1);
  }, [beginCameraRestart]);

  const flipCamera = useCallback(() => {
    beginCameraRestart();
    setCameraFacing((facing) => (facing === 'front' ? 'back' : 'front'));
  }, [beginCameraRestart]);

  useEffect(() => {
    if (!autoCalibrate || cameraStatus !== 'ready') return;
    let calibrationTimer: ReturnType<typeof setTimeout> | null = null;
    const startTimer = setTimeout(() => {
      beginNeutralCalibration();
      calibrationTimer = setTimeout(completeNeutralCalibration, BODY_LEAN_CONFIG.calibrationDurationMs);
    }, 0);
    return () => {
      clearTimeout(startTimer);
      if (calibrationTimer) clearTimeout(calibrationTimer);
    };
  }, [autoCalibrate, beginNeutralCalibration, cameraStatus, completeNeutralCalibration]);

  if (!gameMode && permissionState === 'checking') {
    return (
      <SafeAreaView style={styles.permissionSafeArea}>
        <StatusBar hidden={gameMode} barStyle="dark-content" />
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionEyebrow}>ACTIVE KIDS</Text>
          <Text style={styles.permissionTitle}>Checking camera permission</Text>
          <Text style={styles.permissionDescription}>
            Please wait while we check whether the camera is available.
          </Text>
          <AppButton title="Back" variant="secondary" onPress={onExit} />
        </View>
      </SafeAreaView>
    );
  }

  if (!gameMode && permissionState === 'denied') {
    const canAskAgain = permission?.canAskAgain ?? false;

    return (
      <SafeAreaView style={styles.permissionSafeArea}>
        <StatusBar hidden={gameMode} barStyle="dark-content" />
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionEyebrow}>ACTIVE KIDS</Text>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionDescription}>
            The camera provides the live preview and on-device pose detection.
            Camera frames stay on this device and are not saved or uploaded.
          </Text>

          {permissionRequestPending && (
            <Text style={styles.permissionNotice}>
              Waiting for your permission choice...
            </Text>
          )}

          {!canAskAgain ? (
            <Text style={styles.permissionNotice}>
              Camera access is off for Active Kids. Ask a grown-up to enable it
              in device settings, then return here.
            </Text>
          ) : permissionRequestFailed ? (
            <Text style={styles.permissionError}>
              We couldn&apos;t open the camera permission prompt. Please try again.
            </Text>
          ) : null}

          {canAskAgain && (
            <AppButton
              title={permissionRequestPending ? 'REQUESTING...' : 'ALLOW CAMERA'}
              onPress={() => void askForCameraPermission()}
              disabled={permissionRequestPending}
            />
          )}

          <AppButton title="Back" variant="secondary" onPress={onExit} />
        </View>
      </SafeAreaView>
    );
  }

  const visibleCameraStatus = gameMode && permissionState === 'denied' ? 'unavailable' : cameraStatus;
  const visibleCameraInfo = gameMode && permissionState === 'denied' ? null : cameraInfo;
  const detectorState = getDetectorState(visibleCameraStatus, poseSummary.state);
  const cameraValue = getCameraStatusValue(visibleCameraStatus, appIsActive);
  const detectorValue = getDetectorStatusValue(detectorState);
  const cameraTone = getCameraStatusTone(visibleCameraStatus);
  const detectorTone = getDetectorStatusTone(detectorState);
  const motionHighlights = getMotionHighlights(motionResult);
  const errorMessage = detectorError ? getDetectorErrorMessage(detectorError) : null;
  const gameOverlayInfo: CameraGameOverlayInfo = {
    cameraStatus: visibleCameraStatus,
    detectorState,
    bodyVisibility: poseSummary.bodyVisibility,
    confidence: poseSummary.hasResult ? poseSummary.confidence : null,
    cameraInfo: visibleCameraInfo,
    thermalState: poseSummary.thermalState,
    poseModelDelegate: poseSummary.poseModelDelegate,
    poseModelVariant: poseSummary.poseModelVariant,
    metrics,
    lastEvent: lastGestureEvent,
    motionState: motionDiagnostics?.state ?? 'IDLE',
    motionDiagnostics,
    bodyLean,
    motionProcessing,
    lastMotionEvent,
    errorCode: detectorError,
    errorMessage,
    resetMotionController,
    beginNeutralCalibration,
    completeNeutralCalibration,
    retryCamera,
    flipCamera,
  };
  const poseConfidence =
    !poseSummary.hasResult
      ? 'Confidence: —'
      : 'Confidence: ' + Math.round(poseSummary.confidence * 100) + '%';

  return (
    <CameraGameSessionContext.Provider value={gameOverlayInfo}>
      <View style={styles.cameraContainer}>
        <StatusBar hidden={gameMode} barStyle="light-content" />
        {permissionState !== 'granted' ? (
          <View style={styles.cameraUnavailable} />
        ) : visibleCameraStatus === 'unavailable' ? (
          detectorError === 'nativeModuleUnavailable' && previewVisible && permission?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing={cameraFacing} />
          ) : (
            <View style={styles.cameraUnavailable} />
          )
        ) : (
          <PoseDetectorCamera
            cameraFacing={cameraFacing}
            isActive={appIsActive}
            sessionKey={cameraAttempt}
            previewVisible={previewVisible}
            motionHighlights={motionHighlights}
            onPose={handlePose}
            onMetrics={handleMetrics}
            onReady={handleCameraReady}
            onError={handleCameraError}
          />
        )}

        <View pointerEvents="box-none" style={styles.overlay}>
          {gameMode ? (
            children
          ) : (
            <>
        <View style={styles.topBar}>
          <AppButton
            title="BACK"
            variant="light"
            onPress={onExit}
            style={styles.backButton}
          />
          <Text style={styles.heading}>Camera Setup</Text>
          <Text style={styles.instruction}>
            Move the phone back a little until your whole body fits in view.
          </Text>
        </View>

        {visibleCameraStatus !== 'unavailable' && (
          <View pointerEvents="none" style={styles.guideRegion}>
            <View style={styles.bodyGuide}>
              <View style={styles.guideHead} />
              <View style={styles.guideBody} />
            </View>
          </View>
        )}

        <View
          style={[
            styles.bottomPanel,
            { paddingBottom: Math.max(insets.bottom, spacing.sm) },
          ]}
        >
          <View style={styles.statusRow}>
            <CameraStatus
              label="Camera"
              value={cameraValue}
              tone={cameraTone}
              dark
            />
            <CameraStatus
              label="Detection"
              value={detectorValue}
              tone={detectorTone}
              dark
            />
          </View>

          <Text style={styles.bottomText}>
            {errorMessage ??
              (visibleCameraStatus === 'starting'
                ? 'Loading the on-device pose model and starting the camera...'
                : poseSummary.state === 'looking'
                  ? 'Looking for a person. Keep your whole body in view.'
                  : poseSummary.state === 'low-confidence'
                    ? 'Move into brighter light and keep your whole body in view.'
                    : 'Person detected.')}
          </Text>

          {(poseSummary.hasResult || visibleCameraStatus === 'ready') && (
            <Text
              style={[
                styles.bodyVisibilityText,
                poseSummary.bodyVisibility.state === 'FULL_BODY'
                  ? styles.fullBodyText
                  : styles.partialBodyText,
              ]}
              accessibilityLiveRegion="polite"
            >
              {poseSummary.bodyVisibility.message}
            </Text>
          )}

          {detectorState !== 'initializing' && detectorState !== 'error' && (
            <Text style={styles.confidenceText}>{poseConfidence}</Text>
          )}

          {DEBUG_POSE && (
            <View style={styles.debugPanel}>
              <Text style={styles.debugTitle}>POSE DEBUG · ON DEVICE</Text>
              <Text style={styles.debugText}>
                Detector: MediaPipe Pose Landmarker
              </Text>
              <Text style={styles.debugText}>
                Person:{' '}
                {!poseSummary.hasResult
                  ? 'Waiting'
                  : poseSummary.state === 'detected'
                    ? 'Detected'
                    : poseSummary.state === 'low-confidence'
                      ? 'Low confidence'
                      : 'Not detected'}
                {'  '}Confidence:{' '}
                {poseSummary.hasResult
                  ? Math.round(poseSummary.confidence * 100) + '%'
                  : '—'}
                {'  '}Landmarks:{' '}
                {poseSummary.hasResult ? poseSummary.landmarkCount : '—'}
              </Text>
              <Text style={styles.debugText}>
                Model: {poseSummary.poseModelVariant ?? '—'} / {poseSummary.poseModelDelegate ?? '—'}
                {'  '}Capture: {cameraInfo ? `${cameraInfo.imageWidth}×${cameraInfo.imageHeight}` : '—'}
                {'  '}Thermal: {poseSummary.thermalState ?? '—'}
              </Text>
              <Text style={styles.debugText}>
                Camera capture rate: {metrics ? metrics.observedFps.toFixed(1) : 'N/A'} Hz
                {'  '}Pose inference rate: {metrics ? metrics.inferenceFps.toFixed(1) : 'N/A'} Hz
                {'  '}Pose result rate: {metrics ? metrics.resultFps.toFixed(1) : 'N/A'} Hz
                {'  '}Pose latency avg: {metrics?.averageInferenceDurationMs == null ? '—' : metrics.averageInferenceDurationMs.toFixed(0) + ' ms'}
                {'  '}Last: {poseSummary.inferenceDurationMs === null ? '—' : poseSummary.inferenceDurationMs.toFixed(0) + ' ms'}
                {'  '}Startup: {startupTimeMs === null ? '—' : startupTimeMs + ' ms'}
              </Text>
              <Text style={styles.debugText}>
                Cadence-skipped frames: {metrics?.skippedInferenceFrames ?? '—'}
                {'  '}Motion processing: {motionProcessing.rateHz.toFixed(1)} Hz, {motionProcessing.sampleCount ? motionProcessing.averageMs.toFixed(2) : '—'}/{motionProcessing.sampleCount ? motionProcessing.maximumMs.toFixed(2) : '—'} ms avg/max
              </Text>
              <Text style={styles.debugText}>
                Lean: {bodyLean.angleDegrees >= 0 ? '+' : ''}{bodyLean.angleDegrees.toFixed(1)}°
                {'  '}Direction: {bodyLean.direction < 0 ? 'LEFT' : bodyLean.direction > 0 ? 'RIGHT' : 'CENTER'}
                {'  '}Intensity: {bodyLean.intensity.toFixed(2)}
                {'  '}Torso tracking: {Math.round(bodyLean.trackingConfidence * 100)}%
                {'  '}Calibration: {bodyLean.calibrating ? 'IN PROGRESS' : bodyLean.calibrated ? 'READY' : 'NOT CALIBRATED'}
              </Text>
              <Text style={styles.debugText}>
                Body: {poseSummary.bodyVisibility.state} · Head {formatCheck(poseSummary.bodyVisibility.checkpoints.head)} · Shoulders {formatCheck(poseSummary.bodyVisibility.checkpoints.shoulders)} · Hips {formatCheck(poseSummary.bodyVisibility.checkpoints.hips)} · Knees {formatCheck(poseSummary.bodyVisibility.checkpoints.knees)} · Feet {formatCheck(poseSummary.bodyVisibility.checkpoints.feet)}
              </Text>
              <Text style={styles.debugText}>
                Head {formatScore(poseSummary.landmarkScores.head)} · Shoulder L/R {formatScore(poseSummary.landmarkScores.leftShoulder)}/{formatScore(poseSummary.landmarkScores.rightShoulder)} · Hip L/R {formatScore(poseSummary.landmarkScores.leftHip)}/{formatScore(poseSummary.landmarkScores.rightHip)}
              </Text>
              <Text style={styles.debugText}>
                Knee L/R {formatScore(poseSummary.landmarkScores.leftKnee)}/{formatScore(poseSummary.landmarkScores.rightKnee)} · Ankle L/R {formatScore(poseSummary.landmarkScores.leftAnkle)}/{formatScore(poseSummary.landmarkScores.rightAnkle)}
              </Text>
              <Text style={styles.debugText}>
                Motion center: {formatCoordinate(motionResult?.body.centerX)}, {formatCoordinate(motionResult?.body.centerY)}
                {'  '}Move: {motionResult?.movementDirection ?? 'UNKNOWN'}
              </Text>
              <Text style={styles.debugText}>
                Hands: L {formatGesture(motionResult, 'LEFT_HAND_UP', 'UP', 'DOWN')}
                {'  '}R {formatGesture(motionResult, 'RIGHT_HAND_UP', 'UP', 'DOWN')}
                {'  '}Both {formatGesture(motionResult, 'BOTH_HANDS_UP', 'UP', 'DOWN')}
              </Text>
              <Text style={styles.debugText}>
                Squat: {formatGesture(motionResult, 'SQUAT', 'YES', 'NO')} / {motionResult?.squatPhase ?? 'unknown'}
                {'  '}Jump: {formatGesture(motionResult, 'JUMP', 'YES', 'NO')} / {motionResult?.jumpPhase ?? 'unknown'}
              </Text>
              <Text style={styles.debugText}>
                Controller: {motionDiagnostics?.state ?? 'IDLE'} · Run {motionDiagnostics?.run.active ? 'ON' : 'OFF'}
                {'  '}Knee velocity L/R {formatMotionMetric(motionDiagnostics?.run.leftKneeVelocityScalePerSecond ?? null)}/{formatMotionMetric(motionDiagnostics?.run.rightKneeVelocityScalePerSecond ?? null)}
                {'  '}Alternations {motionDiagnostics?.run.alternations ?? 0}
              </Text>
              <Text style={styles.debugText}>
                Jump {motionDiagnostics?.jump.phase ?? 'GROUNDED'} · Hip up {formatMotionMetric(motionDiagnostics?.jump.hipUpVelocityScalePerSecond ?? null)} scale/s
                {'  '}Feet rise L/R {formatMotionMetric(motionDiagnostics?.jump.leftFootRiseScale ?? null)}/{formatMotionMetric(motionDiagnostics?.jump.rightFootRiseScale ?? null)}
                {'  '}Cooldown {Math.ceil(motionDiagnostics?.jump.cooldownRemainingMs ?? 0)} ms
              </Text>
              <Text style={styles.debugText}>
                Wrist velocity L/R {formatMotionMetric(motionDiagnostics?.arm.leftWristVelocityScalePerSecond ?? null)}/{formatMotionMetric(motionDiagnostics?.arm.rightWristVelocityScalePerSecond ?? null)} scale/s
                {'  '}Swing cooldown {Math.ceil(motionDiagnostics?.arm.cooldownRemainingMs ?? 0)} ms
                {'  '}Crouch {motionDiagnostics?.crouch.active ? 'ON' : 'OFF'}
              </Text>
              <Text style={styles.debugText}>
                Motion events (latest 3, max {MOTION_CONFIG.maxDebugEvents}): {motionEventLog.length === 0 ? 'none' : motionEventLog.slice(-3).map((event) => `${event.type}@${formatEventTime(event.timestamp)}`).join(' · ')}
              </Text>
              <Text style={styles.debugText}>Gesture events (latest 3, max {MOTION_CONFIG.maxDebugEvents}):</Text>
              {eventLog.length === 0 ? (
                <Text style={styles.eventText}>No events yet</Text>
              ) : (
                eventLog.slice(-3).map((event, index) => (
                  <Text
                    key={event.timestamp + '-' + event.type + '-' + index}
                    style={styles.eventText}
                  >
                    {formatEventTime(event.timestamp)} {event.type}
                  </Text>
                ))
              )}
            </View>
          )}

          <View style={styles.buttonRow}>
            {visibleCameraStatus === 'unavailable' ? (
              detectorError === 'cameraFacingUnavailable' ? (
                <AppButton
                  title={cameraFacing === 'front' ? 'TRY BACK CAMERA' : 'TRY FRONT CAMERA'}
                  onPress={flipCamera}
                />
              ) : (
                <AppButton title="TRY AGAIN" onPress={retryCamera} />
              )
            ) : (
              <AppButton
                title="FLIP CAMERA"
                variant="light"
                onPress={flipCamera}
                disabled={visibleCameraStatus === 'starting'}
                style={styles.actionButton}
              />
            )}
            <AppButton
              title="STOP GAME"
              variant="danger"
              onPress={onExit}
              style={styles.actionButton}
            />
          </View>
        </View>
            </>
          )}
        </View>
      </View>
    </CameraGameSessionContext.Provider>
  );
}

function createEmptyPoseDisplaySummary(): PoseDisplaySummary {
  return {
    state: 'looking',
    confidence: 0,
    inferenceDurationMs: null,
    landmarkCount: 0,
    hasResult: false,
    thermalState: null,
    poseModelDelegate: null,
    poseModelVariant: null,
    bodyVisibility: EMPTY_BODY_VISIBILITY,
    landmarkScores: {
      head: null,
      leftShoulder: null,
      rightShoulder: null,
      leftHip: null,
      rightHip: null,
      leftKnee: null,
      rightKnee: null,
      leftAnkle: null,
      rightAnkle: null,
    },
  };
}

function getHighResolutionNow(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}

function getPoseLandmarkScores(pose: PoseResult): PoseLandmarkScores {
  return {
    head: getBestLandmarkScore(pose, [
      'nose',
      'leftEye',
      'rightEye',
      'leftEar',
      'rightEar',
    ]),
    leftShoulder: getPoseLandmarkScore(pose, 'leftShoulder'),
    rightShoulder: getPoseLandmarkScore(pose, 'rightShoulder'),
    leftHip: getPoseLandmarkScore(pose, 'leftHip'),
    rightHip: getPoseLandmarkScore(pose, 'rightHip'),
    leftKnee: getPoseLandmarkScore(pose, 'leftKnee'),
    rightKnee: getPoseLandmarkScore(pose, 'rightKnee'),
    leftAnkle: getPoseLandmarkScore(pose, 'leftAnkle'),
    rightAnkle: getPoseLandmarkScore(pose, 'rightAnkle'),
  };
}

function getBestLandmarkScore(
  pose: PoseResult,
  names: readonly PoseLandmarkName[],
): number | null {
  let highestScore: number | null = null;
  for (const name of names) {
    const score = getPoseLandmarkScore(pose, name);
    if (score !== null && (highestScore === null || score > highestScore)) {
      highestScore = score;
    }
  }
  return highestScore;
}

function formatCoordinate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : '--';
}

function formatMotionMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

function formatScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function formatCheck(visible: boolean): string {
  return visible ? '✓' : '—';
}

function formatGesture(
  result: MotionResult | null,
  type: GestureType,
  activeLabel: string,
  inactiveLabel: string,
): string {
  const gesture = result?.gestures.find((candidate) => candidate.type === type);
  if (!gesture?.available) return '--';
  const confidence = Math.round(gesture.confidence * 100);
  return (gesture.active ? activeLabel : inactiveLabel) + ' ' + confidence + '%';
}

function formatEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getDetectorState(
  cameraStatus: CameraPreviewState,
  poseState: PoseDisplaySummary['state'],
): PoseDetectionState {
  if (cameraStatus === 'unavailable') {
    return 'error';
  }
  if (cameraStatus === 'starting') {
    return 'initializing';
  }
  return poseState;
}

function getCameraStatusValue(
  status: CameraPreviewState,
  appIsActive: boolean,
): string {
  switch (status) {
    case 'ready':
      return appIsActive ? 'Ready' : 'Paused';
    case 'unavailable':
      return 'Unavailable';
    case 'starting':
      return 'Starting';
  }
}

function getCameraStatusTone(status: CameraPreviewState): StatusTone {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'unavailable':
      return 'error';
    case 'starting':
      return 'neutral';
  }
}

function getDetectorStatusValue(status: PoseDetectionState): string {
  switch (status) {
    case 'initializing':
      return 'Initializing detector';
    case 'looking':
      return 'Looking for person';
    case 'detected':
      return 'Person detected';
    case 'low-confidence':
      return 'Low confidence';
    case 'error':
      return 'Unavailable';
  }
}

function getDetectorStatusTone(status: PoseDetectionState): StatusTone {
  switch (status) {
    case 'detected':
      return 'ready';
    case 'low-confidence':
      return 'attention';
    case 'error':
      return 'error';
    case 'initializing':
    case 'looking':
      return 'neutral';
  }
}

function getDetectorErrorMessage(error: PoseDetectorErrorCode): string {
  switch (error) {
    case 'nativeModuleUnavailable':
      return 'Pose detection is not included in Expo Go. Install and open the Active Kids development build.';
    case 'cameraPermission':
      return 'Camera access is needed. Enable it in device settings and try again.';
    case 'cameraFacingUnavailable':
      return 'This device does not have a compatible camera facing this way. Try the other camera.';
    case 'cameraUnavailable':
      return 'The camera could not start. Close other apps using it, then try again.';
    case 'modelInitialization':
      return 'The pose model could not load. Reinstall the development build and try again.';
    case 'inferenceFailure':
      return 'Pose detection stopped unexpectedly. Try starting the camera again.';
    case 'unsupportedDevice':
      return 'On-device pose detection is available on supported iOS and Android devices.';
  }
}

const styles = StyleSheet.create({
  permissionSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  permissionContainer: {
    width: '100%',
    maxWidth: 520,
    flex: 1,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  permissionEyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  permissionDescription: {
    maxWidth: 380,
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  permissionNotice: {
    maxWidth: 380,
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  permissionError: {
    maxWidth: 380,
    color: '#A31D2D',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraUnavailable: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#111827',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  topBar: {
    paddingTop: 70,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 62,
    left: spacing.sm,
    minWidth: 88,
    minHeight: 44,
    zIndex: 1,
  },
  heading: {
    color: colors.white,
    fontSize: 20,
    lineHeight: 31,
    fontWeight: '900',
  },
  instruction: {
    maxWidth: 310,
    marginTop: spacing.xs,
    color: colors.white,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  guideRegion: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyGuide: {
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.38,
  },
  guideHead: {
    width: 72,
    height: 72,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: 36,
  },
  guideBody: {
    width: 126,
    height: 170,
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: radius.lg,
  },
  bottomPanel: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bottomText: {
    color: colors.white,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
  },
  bodyVisibilityText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    textAlign: 'center',
  },
  fullBodyText: {
    color: '#86EFAC',
  },
  partialBodyText: {
    color: '#FDE68A',
  },
  confidenceText: {
    color: '#D1FAE5',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  debugPanel: {
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  debugTitle: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  debugText: {
    color: colors.white,
    fontSize: 10,
    lineHeight: 14,
  },
  eventText: {
    color: '#D1FAE5',
    fontSize: 9,
    lineHeight: 12,
    fontVariant: ['tabular-nums'],
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
});
