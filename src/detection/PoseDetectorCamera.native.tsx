import {
  PoseCameraView,
  PoseSkeleton,
  type LandmarkName,
  getCameraCapabilities,
  getLandmark,
  projectLandmark,
  type CameraCapabilities,
  type CameraConfiguration,
  type InferenceError,
  type Landmark as MediaPipeLandmark,
  type PoseFrame,
  type PosePerformanceMetrics as MediaPipePerformanceMetrics,
} from 'expo-mediapipe-pose';
import { Line, Svg } from 'react-native-svg';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { MediaPipePoseAdapter } from './PoseDetector';
import { DEBUG_POSE, MEDIAPIPE_CONFIG, POSE_DETECTION_CONFIG } from './poseConfig';
import type {
  CameraReadyInfo,
  PoseDetectorCameraProps,
  PoseDetectorErrorCode,
} from './types';

type CapabilityState =
  | {
      sessionKey: number;
      cameraFacing: 'front' | 'back';
      status: 'ready';
      capabilities: CameraCapabilities;
    }
  | {
      sessionKey: number;
      cameraFacing: 'front' | 'back';
      status: 'error';
      code: PoseDetectorErrorCode;
    };

interface CameraMode {
  lens: 'wide' | 'ultraWide';
  previewFps: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface OverlaySnapshot {
  sessionKey: number;
  cameraFacing: 'front' | 'back';
  frame: PoseFrame;
}

export function PoseDetectorCamera({
  cameraFacing,
  isActive,
  sessionKey,
  previewVisible = true,
  motionHighlights,
  onPose,
  onMetrics,
  onReady,
  onError,
}: PoseDetectorCameraProps) {
  const [capabilityState, setCapabilityState] = useState<CapabilityState | null>(
    null,
  );
  const [overlaySnapshot, setOverlaySnapshot] = useState<OverlaySnapshot | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    sessionKey: number;
    code: PoseDetectorErrorCode;
  } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const adapter = useMemo(() => new MediaPipePoseAdapter(), []);
  const reportedFailureRef = useRef<{
    sessionKey: number;
    code: PoseDetectorErrorCode;
  } | null>(null);
  const isMountedRef = useRef(true);
  const lastOverlayUpdateAt = useRef(0);

  const reportError = useCallback(
    (code: PoseDetectorErrorCode) => {
      if (
        reportedFailureRef.current?.sessionKey === sessionKey &&
        reportedFailureRef.current.code === code
      ) {
        return;
      }
      reportedFailureRef.current = { sessionKey, code };
      setFailure({ sessionKey, code });
      onError(code);
    },
    [onError, sessionKey],
  );

  useEffect(() => {
    isMountedRef.current = true;
    adapter.reset();
    reportedFailureRef.current = null;
    let isCurrent = true;

    void getCameraCapabilities()
      .then((capabilities) => {
        if (!isCurrent) {
          return;
        }

        const state: CapabilityState = {
          sessionKey,
          cameraFacing,
          status: 'ready',
          capabilities,
        };
        setCapabilityState(state);

        if (capabilities.status === 'permissionRequired') {
          reportError('cameraPermission');
        } else if (capabilities.status === 'unavailable') {
          reportError('unsupportedDevice');
        } else if (!findCameraMode(capabilities, cameraFacing)) {
          reportError('cameraFacingUnavailable');
        }
      })
      .catch(() => {
        if (isCurrent) {
          setCapabilityState({
            sessionKey,
            cameraFacing,
            status: 'error',
            code: 'nativeModuleUnavailable',
          });
          reportError('nativeModuleUnavailable');
        }
      });

    return () => {
      isCurrent = false;
      isMountedRef.current = false;
      adapter.reset();
    };
  }, [adapter, cameraFacing, reportError, sessionKey]);

  const activeCapability =
    capabilityState?.sessionKey === sessionKey &&
    capabilityState.cameraFacing === cameraFacing
      ? capabilityState
      : null;
  const cameraMode =
    activeCapability?.status === 'ready'
      ? findCameraMode(activeCapability.capabilities, cameraFacing)
      : null;
  const hasFailed =
    failure?.sessionKey === sessionKey ||
    (activeCapability?.status === 'error' &&
      activeCapability.sessionKey === sessionKey);

  const handleLandmark = useCallback(
    (frame: PoseFrame) => {
      try {
        const output = adapter.process(frame);

        if (isMountedRef.current) {
          // Setup preview is intentionally capped below the camera callback rate;
          // gameplay hides this overlay entirely and avoids per-frame React work.
          const now = Date.now();
          if (previewVisible && now - lastOverlayUpdateAt.current >= 100) {
            const selectedPose = frame.poses?.[output.poseIndex];
            const selectedLandmarks = selectedPose?.landmarks ??
              (frame.poses?.length ? [] : frame.landmarks);
            const selectedWorldLandmarks = selectedPose?.worldLandmarks ??
              (frame.poses?.length ? [] : frame.worldLandmarks);
            const nextOverlayFrame: PoseFrame = {
              landmarks: selectedLandmarks.map(withVisibilityFallback),
              worldLandmarks: selectedWorldLandmarks,
              additionalData: frame.additionalData,
            };
            lastOverlayUpdateAt.current = now;
            setOverlaySnapshot({ sessionKey, cameraFacing, frame: nextOverlayFrame });
          }
          onPose(output.result);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[PoseDetectorCamera] Invalid landmark output.', error);
        }
        reportError('inferenceFailure');
      }
    },
    [adapter, cameraFacing, onPose, previewVisible, reportError, sessionKey],
  );

  const handleMetrics = useCallback(
    (metrics: MediaPipePerformanceMetrics) => {
      onMetrics({
        intervalMs: metrics.intervalMs,
        observedFrames: metrics.observedFrames,
        inferenceCount: metrics.inferenceCount,
        resultCount: metrics.resultCount,
        skippedInferenceFrames: metrics.skippedInferenceFrames,
        observedFps: metrics.observedFps,
        inferenceFps: metrics.inferenceFps,
        resultFps: metrics.resultFps,
        averageInferenceDurationMs: metrics.averageInferenceDurationMs,
      });
    },
    [onMetrics],
  );

  const handleCameraConfigured = useCallback(
    (configuration: CameraConfiguration) => {
      reportedFailureRef.current = null;
      const camera: CameraReadyInfo = {
        facing: configuration.effectiveFacing,
        mirrored: configuration.mirrored,
        imageWidth: configuration.captureWidth,
        imageHeight: configuration.captureHeight,
      };
      onReady(camera);
    },
    [onReady],
  );

  const handleInferenceError = useCallback(
    (error: InferenceError) => {
      reportError(mapNativeError(error));
    },
    [reportError],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const canMountCamera =
    activeCapability?.status === 'ready' &&
    activeCapability.capabilities.status === 'available' &&
    cameraMode !== null &&
    !hasFailed;
  const overlayFrame =
    overlaySnapshot?.sessionKey === sessionKey &&
    overlaySnapshot.cameraFacing === cameraFacing
      ? overlaySnapshot.frame
      : null;

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {canMountCamera && cameraMode && (
        <PoseCameraView
          key={sessionKey}
          // Keep a laid-out native view attached: Android binds ImageAnalysis separately
          // from PreviewView drawing, and iOS delivers frames from AVCaptureVideoDataOutput.
          style={[StyleSheet.absoluteFill, !previewVisible && styles.hiddenPreview]}
          isActive={isActive && !hasFailed}
          cameraFacing={cameraFacing}
          cameraLens={cameraMode.lens}
          previewFps={cameraMode.previewFps}
          frameLimit={Math.min(
            POSE_DETECTION_CONFIG.targetFps ?? cameraMode.previewFps,
            cameraMode.previewFps,
          )}
          callbackFps={Math.min(
            POSE_DETECTION_CONFIG.callbackFps ??
              POSE_DETECTION_CONFIG.targetFps ??
              cameraMode.previewFps,
            cameraMode.previewFps,
          )}
          poseModelVariant={MEDIAPIPE_CONFIG.modelVariant}
          maxPoses={MEDIAPIPE_CONFIG.candidatePeople}
          minPoseDetectionConfidence={MEDIAPIPE_CONFIG.minPoseDetectionConfidence}
          minPosePresenceConfidence={MEDIAPIPE_CONFIG.minPosePresenceConfidence}
          minTrackingConfidence={MEDIAPIPE_CONFIG.minTrackingConfidence}
          segmentationEnabled={false}
          skeleton={false}
          onCameraConfigured={handleCameraConfigured}
          onInferenceError={handleInferenceError}
          onLandmark={handleLandmark}
          onPerformanceMetrics={DEBUG_POSE ? handleMetrics : undefined}
        />
      )}

      {previewVisible && overlayFrame && stageSize.width > 0 && stageSize.height > 0 && (
        <View pointerEvents="none" style={styles.overlay}>
          <PoseSkeleton
            frame={overlayFrame}
            width={stageSize.width}
            height={stageSize.height}
            color="#56E39F"
            jointRadius={4}
            lineWidth={3}
            minVisibility={POSE_DETECTION_CONFIG.confidenceThreshold}
          />
          <GestureHighlightOverlay
            frame={overlayFrame}
            width={stageSize.width}
            height={stageSize.height}
            highlights={motionHighlights}
          />
          <EyeCenterConnections
            frame={overlayFrame}
            width={stageSize.width}
            height={stageSize.height}
          />
        </View>
      )}
    </View>
  );
}

function GestureHighlightOverlay({
  frame,
  width,
  height,
  highlights,
}: {
  frame: PoseFrame;
  width: number;
  height: number;
  highlights: PoseDetectorCameraProps['motionHighlights'];
}) {
  const imageSize = {
    width: frame.additionalData.width,
    height: frame.additionalData.height,
  };
  if (imageSize.width <= 0 || imageSize.height <= 0) return null;

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {highlights?.leftArm && (
        <>
          {renderHighlightedBone(frame, 'leftShoulder', 'leftElbow', imageSize, { width, height }, 'left-shoulder-elbow')}
          {renderHighlightedBone(frame, 'leftElbow', 'leftWrist', imageSize, { width, height }, 'left-elbow-wrist')}
        </>
      )}
      {highlights?.rightArm && (
        <>
          {renderHighlightedBone(frame, 'rightShoulder', 'rightElbow', imageSize, { width, height }, 'right-shoulder-elbow')}
          {renderHighlightedBone(frame, 'rightElbow', 'rightWrist', imageSize, { width, height }, 'right-elbow-wrist')}
        </>
      )}
      {highlights?.lowerBody && (
        <>
          {renderHighlightedBone(frame, 'leftHip', 'leftKnee', imageSize, { width, height }, 'left-hip-knee')}
          {renderHighlightedBone(frame, 'leftKnee', 'leftAnkle', imageSize, { width, height }, 'left-knee-ankle')}
          {renderHighlightedBone(frame, 'rightHip', 'rightKnee', imageSize, { width, height }, 'right-hip-knee')}
          {renderHighlightedBone(frame, 'rightKnee', 'rightAnkle', imageSize, { width, height }, 'right-knee-ankle')}
        </>
      )}
    </Svg>
  );
}

function renderHighlightedBone(
  frame: PoseFrame,
  startName: LandmarkName,
  endName: LandmarkName,
  imageSize: { width: number; height: number },
  viewSize: { width: number; height: number },
  key: string,
) {
  const start = getVisiblePoint(frame, startName);
  const end = getVisiblePoint(frame, endName);
  if (!start || !end) return null;

  const projectedStart = projectLandmark(start, imageSize, viewSize);
  const projectedEnd = projectLandmark(end, imageSize, viewSize);
  return (
    <Line
      key={key}
      x1={projectedStart.x}
      y1={projectedStart.y}
      x2={projectedEnd.x}
      y2={projectedEnd.y}
      stroke="#FFD54A"
      strokeWidth={6}
      strokeLinecap="round"
      opacity={0.95}
    />
  );
}

function findCameraMode(
  capabilities: CameraCapabilities,
  facing: 'front' | 'back',
): CameraMode | null {
  if (capabilities.status !== 'available') {
    return null;
  }

  const preferredLens = facing === 'front' ? 'ultraWide' : 'wide';
  const camera = capabilities.cameras.find(
    (candidate) => candidate.facing === facing && candidate.lens === preferredLens,
  ) ?? capabilities.cameras.find(
    (candidate) => candidate.facing === facing && candidate.lens === 'wide',
  );
  if (!camera) {
    return null;
  }

  const frameRates = camera.modes
    .map((mode) => mode.previewFps)
    .filter((fps) => Number.isFinite(fps) && fps > 0);
  if (frameRates.length === 0) {
    return null;
  }

  const atOrBelowTarget = frameRates.filter(
    (fps) => fps <= MEDIAPIPE_CONFIG.maxPreviewFps,
  );
  const supportedFrameRate = (atOrBelowTarget.length
    ? atOrBelowTarget
    : frameRates
  ).sort((first, second) => first - second)[
    atOrBelowTarget.length ? atOrBelowTarget.length - 1 : 0
  ];

  return Number.isFinite(supportedFrameRate)
    ? { lens: camera.lens, previewFps: supportedFrameRate }
    : null;
}

function mapNativeError(error: InferenceError): PoseDetectorErrorCode {
  switch (error.code) {
    case 'cameraPermission':
      return 'cameraPermission';
    case 'cameraConfiguration':
    case 'cameraRuntime':
      return 'cameraUnavailable';
    case 'modelInitialization':
      return 'modelInitialization';
    case 'nativeViewInitialization':
      return 'unsupportedDevice';
    case 'inferenceRuntime':
    case 'invalidNativeEvent':
    case 'segmentationCleanup':
      return 'inferenceFailure';
  }
}

function EyeCenterConnections({
  frame,
  width,
  height,
}: {
  frame: PoseFrame;
  width: number;
  height: number;
}) {
  const imageSize = {
    width: frame.additionalData.width,
    height: frame.additionalData.height,
  };
  const nose = getVisiblePoint(frame, 'nose');
  const leftEye = getVisiblePoint(frame, 'leftEye');
  const rightEye = getVisiblePoint(frame, 'rightEye');

  if (!nose || (!leftEye && !rightEye)) {
    return null;
  }

  const project = (point: MediaPipeLandmark): ProjectedPoint =>
    projectLandmark(point, imageSize, { width, height });
  const projectedNose = project(nose);
  const projectedLeftEye = leftEye ? project(leftEye) : null;
  const projectedRightEye = rightEye ? project(rightEye) : null;

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {projectedLeftEye && (
        <Line
          x1={projectedNose.x}
          y1={projectedNose.y}
          x2={projectedLeftEye.x}
          y2={projectedLeftEye.y}
          stroke="#56E39F"
          strokeWidth={3}
          strokeLinecap="round"
        />
      )}
      {projectedRightEye && (
        <Line
          x1={projectedNose.x}
          y1={projectedNose.y}
          x2={projectedRightEye.x}
          y2={projectedRightEye.y}
          stroke="#56E39F"
          strokeWidth={3}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

function getVisiblePoint(
  frame: PoseFrame,
  name: LandmarkName,
): MediaPipeLandmark | null {
  const point = getLandmark(frame, name);
  const visibility = point?.visibility ?? point?.presence;
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    typeof visibility !== 'number' ||
    !Number.isFinite(visibility) ||
    visibility < POSE_DETECTION_CONFIG.confidenceThreshold
  ) {
    return null;
  }

  return { ...point, visibility };
}

function withVisibilityFallback(point: MediaPipeLandmark): MediaPipeLandmark {
  const visibility = point.visibility ?? point.presence;
  return typeof visibility === 'number' && Number.isFinite(visibility)
    ? { ...point, visibility: Math.min(1, Math.max(0, visibility)) }
    : point;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#111827',
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  hiddenPreview: {
    opacity: 0,
  },
});
