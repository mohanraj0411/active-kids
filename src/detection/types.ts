export const POSE_LANDMARK_NAMES = [
  'nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner',
  'rightEye', 'rightEyeOuter', 'leftEar', 'rightEar', 'mouthLeft',
  'mouthRight', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftPinky', 'rightPinky', 'leftIndex',
  'rightIndex', 'leftThumb', 'rightThumb', 'leftHip', 'rightHip', 'leftKnee',
  'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel',
  'leftFootIndex', 'rightFootIndex',
] as const;

export type PoseLandmarkName = (typeof POSE_LANDMARK_NAMES)[number];
export type CameraFacing = 'front' | 'back';

export interface PoseLandmark {
  /** Normalized image coordinates. x/y are clamped to [0, 1]. */
  x: number;
  y: number;
  /** MediaPipe image-relative depth; its scale is model-specific. */
  z?: number;
  visibility?: number;
  confidence?: number;
}

export interface WorldPoseLandmark {
  /** MediaPipe world coordinates, in meters. */
  x: number;
  y: number;
  z: number;
  visibility?: number;
  confidence?: number;
}

export interface PoseResult {
  /** Native frame receive time in Unix milliseconds. */
  timestamp: number;
  landmarks: Partial<Record<PoseLandmarkName, PoseLandmark>>;
  /** Preserved separately because these coordinates are in meters, not image space. */
  worldLandmarks?: Partial<Record<PoseLandmarkName, WorldPoseLandmark>>;
  /** Mean reported landmark visibility/presence, not a separate model person score. */
  confidence: number;
  detected: boolean;
  imageSize?: { width: number; height: number };
  cameraFacing?: CameraFacing;
  cameraMirrored?: boolean;
  frameNumber?: number;
  inferenceDurationMs?: number;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  poseModelDelegate?: 'CPU' | 'GPU';
  poseModelVariant?: 'lite' | 'full' | 'heavy';
}

export interface PoseDetectorOutput {
  result: PoseResult;
  /** Candidate index used by the model's skeleton overlay. */
  poseIndex: number;
}

/** The model-specific input is normalized before it reaches motion/game code. */
export interface PoseDetector<InputFrame> {
  process(frame: InputFrame): PoseDetectorOutput;
  reset(): void;
}

export interface PoseDetectionConfig {
  confidenceThreshold: number;
  /** Number of people exposed to the rest of the game; Phase 2 is single-person. */
  maxPeople: number;
  /** Maximum pose inference rate requested from the native camera. */
  targetFps?: number;
  /** Maximum landmark event rate delivered to JavaScript for overlay/UI use. */
  callbackFps?: number;
}

export interface PosePerformanceMetrics {
  intervalMs: number;
  observedFrames: number;
  inferenceCount: number;
  resultCount: number;
  skippedInferenceFrames: number;
  observedFps: number;
  inferenceFps: number;
  resultFps: number;
  averageInferenceDurationMs: number | null;
}

export interface CameraReadyInfo {
  facing: CameraFacing;
  mirrored: boolean;
  imageWidth: number;
  imageHeight: number;
}

export interface PoseDetectorCameraProps {
  cameraFacing: CameraFacing;
  isActive: boolean;
  sessionKey: number;
  /** Hide the native preview surface while leaving inference mounted and active. */
  previewVisible?: boolean;
  motionHighlights?: {
    leftArm: boolean;
    rightArm: boolean;
    lowerBody: boolean;
  };
  onPose: (pose: PoseResult) => void;
  onMetrics: (metrics: PosePerformanceMetrics) => void;
  onReady: (camera: CameraReadyInfo) => void;
  onError: (error: PoseDetectorErrorCode) => void;
}

export type PoseDetectorErrorCode =
  | 'nativeModuleUnavailable'
  | 'cameraPermission'
  | 'cameraFacingUnavailable'
  | 'cameraUnavailable'
  | 'modelInitialization'
  | 'inferenceFailure'
  | 'unsupportedDevice';

export type CameraPermissionState = 'checking' | 'granted' | 'denied';
export type CameraPreviewState = 'starting' | 'ready' | 'unavailable';
export type PoseDetectionState =
  | 'initializing'
  | 'looking'
  | 'detected'
  | 'low-confidence'
  | 'error';
