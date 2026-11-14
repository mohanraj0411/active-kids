import { useCameraPermissions } from 'expo-camera';
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
  ContinuousMotionState,
  MotionControllerDiagnostics,
  MotionEvent,
} from '../motion/controllerTypes';
import { colors, radius, spacing } from '../theme';

type CameraScreenProps = {
  onExit: () => void;
  gameMode?: boolean;
  onGestureEvent?: (event: GestureEvent) => void;
  onMotionEvent?: (event: MotionEvent) => void;
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
  metrics: PosePerformanceMetrics | null;
  lastEvent: GestureEvent | null;
  motionState: ContinuousMotionState;
  motionDiagnostics: MotionControllerDiagnostics | null;
  lastMotionEvent: MotionEvent | null;
  errorMessage: string | null;
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
const EMPTY_BODY_VISIBILITY = assessBodyVisibility(null);

export function CameraScreen({
  onExit,
  gameMode = false,
  onGestureEvent,
  onMotionEvent,
  onSessionReady,
  onSessionSuspended,
  onSessionError,
  children,
}: CameraScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [permissionRequestPending, setPermissionRequestPending] = useState(false);
  const [permissionRequestFailed, setPermissionRequestFailed] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraPreviewState>('starting');
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
  const [motionDiagnostics, setMotionDiagnostics] = useState<MotionControllerDiagnostics | null>(null);
  const [lastMotionEvent, setLastMotionEvent] = useState<MotionEvent | null>(null);
  const [motionEventLog, setMotionEventLog] = useState<MotionEvent[]>([]);
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState === 'active',
  );
  const motionControllerRef = useRef<MotionController | null>(null);
  if (motionControllerRef.current === null) {
    motionControllerRef.current = new MotionController();
  }
  const permissionRequestAttempted = useRef(false);
  const lastPoseUiUpdateAt = useRef(0);
  const lastPoseUiState = useRef<PoseDisplaySummary['state']>('looking');
  const lastMotionUiUpdateAt = useRef(0);
  const cameraStartTime = useRef(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const isActive = nextState === 'active';
      if (!isActive) {
        motionControllerRef.current?.reset();
        setMotionResult(null);
        setEventLog([]);
        setLastGestureEvent(null);
        setMotionDiagnostics(null);
        setLastMotionEvent(null);
        setMotionEventLog([]);
        lastPoseUiUpdateAt.current = 0;
        lastPoseUiState.current = 'looking';
        setPoseSummary(createEmptyPoseDisplaySummary());
        setMetrics(null);
      }
      setAppIsActive(isActive);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => () => motionControllerRef.current?.reset(), []);

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

  const handleCameraReady = useCallback((_camera: CameraReadyInfo) => {
    setCameraStatus('ready');
    setDetectorError(null);
    lastPoseUiUpdateAt.current = 0;
    lastPoseUiState.current = 'looking';
    setPoseSummary(createEmptyPoseDisplaySummary());
    setStartupTimeMs(Date.now() - cameraStartTime.current);
    onSessionReady?.();
  }, [onSessionReady]);

  const handleCameraError = useCallback((error: PoseDetectorErrorCode) => {
    motionControllerRef.current?.reset();
    setMotionResult(null);
    setEventLog([]);
    setLastGestureEvent(null);
    setMotionDiagnostics(null);
    setLastMotionEvent(null);
    setMotionEventLog([]);
    setCameraStatus('unavailable');
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
      } else {
        console.error('[CameraScreen] Pose camera failed.', error);
      }
    }
  }, [onSessionError]);

  const handlePose = useCallback((pose: PoseResult) => {
    const controller = motionControllerRef.current;
    const motionEvents = controller?.update(pose) ?? [];
    const nextMotion = controller?.lastMotionResult;
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

    const bodyVisibility = assessBodyVisibility(pose);
    let state: PoseDisplaySummary['state'] = 'looking';
    if (pose.detected) {
      state =
        pose.confidence < POSE_DETECTION_CONFIG.confidenceThreshold
          ? 'low-confidence'
          : 'detected';
    }

    const now = Date.now();
    const stateChanged = state !== lastPoseUiState.current;
    if (
      !stateChanged &&
      now - lastPoseUiUpdateAt.current < UI_POSE_UPDATE_INTERVAL_MS
    ) {
      return;
    }

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
      bodyVisibility,
      landmarkScores: getPoseLandmarkScores(pose),
    });
  }, [onGestureEvent, onMotionEvent]);

  const handleMetrics = useCallback((nextMetrics: PosePerformanceMetrics) => {
    setMetrics(nextMetrics);
  }, []);

  const beginCameraRestart = useCallback(() => {
    onSessionSuspended?.();
    motionControllerRef.current?.reset();
    cameraStartTime.current = Date.now();
    lastPoseUiUpdateAt.current = 0;
    lastPoseUiState.current = 'looking';
    lastMotionUiUpdateAt.current = 0;
    setCameraStatus('starting');
    setDetectorError(null);
    setPoseSummary(createEmptyPoseDisplaySummary());
    setMetrics(null);
    setStartupTimeMs(null);
    setMotionResult(null);
    setEventLog([]);
    setLastGestureEvent(null);
    setMotionDiagnostics(null);
    setLastMotionEvent(null);
    setMotionEventLog([]);
  }, [onSessionSuspended]);

  const retryCamera = useCallback(() => {
    beginCameraRestart();
    setCameraAttempt((attempt) => attempt + 1);
  }, [beginCameraRestart]);

  const flipCamera = useCallback(() => {
    beginCameraRestart();
    setCameraFacing((facing) => (facing === 'front' ? 'back' : 'front'));
  }, [beginCameraRestart]);

  if (permissionState === 'checking') {
    return (
      <SafeAreaView style={styles.permissionSafeArea}>
        <StatusBar barStyle="dark-content" />
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

  if (permissionState === 'denied') {
    const canAskAgain = permission?.canAskAgain ?? false;

    return (
      <SafeAreaView style={styles.permissionSafeArea}>
        <StatusBar barStyle="dark-content" />
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

  const detectorState = getDetectorState(cameraStatus, poseSummary.state);
  const cameraValue = getCameraStatusValue(cameraStatus, appIsActive);
  const detectorValue = getDetectorStatusValue(detectorState);
  const cameraTone = getCameraStatusTone(cameraStatus);
  const detectorTone = getDetectorStatusTone(detectorState);
  const motionHighlights = getMotionHighlights(motionResult);
  const errorMessage = detectorError ? getDetectorErrorMessage(detectorError) : null;
  const gameOverlayInfo: CameraGameOverlayInfo = {
    cameraStatus,
    detectorState,
    bodyVisibility: poseSummary.bodyVisibility,
    confidence: poseSummary.hasResult ? poseSummary.confidence : null,
    metrics,
    lastEvent: lastGestureEvent,
    motionState: motionDiagnostics?.state ?? 'IDLE',
    motionDiagnostics,
    lastMotionEvent,
    errorMessage,
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
        <StatusBar barStyle="light-content" />
        {cameraStatus === 'unavailable' ? (
          <View style={styles.cameraUnavailable} />
        ) : (
          <PoseDetectorCamera
            cameraFacing={cameraFacing}
            isActive={appIsActive}
            sessionKey={cameraAttempt}
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

        {cameraStatus !== 'unavailable' && (
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
              (cameraStatus === 'starting'
                ? 'Loading the on-device pose model and starting the camera...'
                : poseSummary.state === 'looking'
                  ? 'Looking for a person. Keep your whole body in view.'
                  : poseSummary.state === 'low-confidence'
                    ? 'Move into brighter light and keep your whole body in view.'
                    : 'Person detected.')}
          </Text>

          {(poseSummary.hasResult || cameraStatus === 'ready') && (
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
                Camera input FPS: {metrics ? metrics.observedFps.toFixed(1) : '—'}
                {'  '}Pose FPS: {metrics ? metrics.inferenceFps.toFixed(1) : '—'}
                {'  '}Results FPS: {metrics ? metrics.resultFps.toFixed(1) : '—'}
                {'  '}Pose inference: {poseSummary.inferenceDurationMs === null ? '—' : poseSummary.inferenceDurationMs.toFixed(0) + ' ms'}
                {'  '}Startup: {startupTimeMs === null ? '—' : startupTimeMs + ' ms'}
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
            {cameraStatus === 'unavailable' ? (
              <AppButton title="TRY AGAIN" onPress={retryCamera} />
            ) : (
              <AppButton
                title="FLIP CAMERA"
                variant="light"
                onPress={flipCamera}
                disabled={cameraStatus === 'starting'}
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
