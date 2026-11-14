import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { PlatformerRenderer } from '../game/platformer/PlatformerRenderer';
import { usePlatformerRuntime } from '../game/platformer/usePlatformerRuntime';
import type { DevMotionEventType, PlatformerSnapshot } from '../game/platformer/types';
import type { MotionEvent } from '../motion/controllerTypes';
import { colors, radius, spacing } from '../theme';
import { CameraScreen, useCameraGameSession } from './CameraScreen';

const DEBUG_PLATFORMER = __DEV__;
const KEEP_AWAKE_TAG = 'active-kids-platformer-gameplay';
// Values from Expo ScreenOrientation.OrientationLock.
const ORIENTATION_LOCK_LANDSCAPE = 5;
const ORIENTATION_LOCK_PORTRAIT_UP = 3;

type GamePhase = 'CAMERA_CHECK' | 'GAMEPLAY';
type InputSource = 'camera' | 'manual';
type PauseReason = 'user' | 'app' | 'camera' | null;

type PlatformerScreenProps = { onHome: () => void };

/** Primary, phone-local game flow. The TV mirrors this screen through Android. */
export function PlatformerScreen({ onHome }: PlatformerScreenProps) {
  const { width, height } = useWindowDimensions();
  const [orientationReady, setOrientationReady] = useState(Platform.OS === 'web');
  const [continueInCurrentOrientation, setContinueInCurrentOrientation] = useState(false);
  const [orientationError, setOrientationError] = useState(false);
  const isLandscape = width >= height;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let isCurrent = true;
    void setScreenOrientationLock(ORIENTATION_LOCK_LANDSCAPE)
      .then(async () => {
        if (isCurrent) {
          await setAndroidNavigationBarHidden(true);
        }
        if (isCurrent) {
          setOrientationReady(true);
        }
      })
      .catch(async () => {
        if (isCurrent) {
          await setAndroidNavigationBarHidden(true);
        }
        if (isCurrent) {
          setOrientationError(true);
          setOrientationReady(true);
        }
      });

    return () => {
      isCurrent = false;
      setAndroidNavigationBarHidden(false);
      void setScreenOrientationLock(ORIENTATION_LOCK_PORTRAIT_UP).catch(() => {});
    };
  }, []);

  if (!orientationReady || (Platform.OS !== 'web' && !isLandscape && !continueInCurrentOrientation)) {
    return (
      <OrientationGate
        error={orientationError}
        onContinue={() => setContinueInCurrentOrientation(true)}
        onRetry={() => {
          setOrientationError(false);
          setOrientationReady(false);
          void setScreenOrientationLock(ORIENTATION_LOCK_LANDSCAPE)
            .then(() => setOrientationReady(true))
            .catch(() => {
              setOrientationError(true);
              setOrientationReady(true);
            });
        }}
        onExit={onHome}
      />
    );
  }

  // Mount the game runtime only after the orientation change so level geometry
  // is initialized with the landscape viewport instead of portrait dimensions.
  return <LandscapePlatformerSession onHome={onHome} width={width} height={height} />;
}

function OrientationGate({
  error,
  onContinue,
  onRetry,
  onExit,
}: {
  error: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  return (
    <View style={styles.gateRoot}>
      <StatusBar hidden />
      <Text style={styles.gateEyebrow}>ACTIVE KIDS</Text>
      <Text style={styles.gateTitle}>Turn your phone sideways</Text>
      <Text style={styles.gateDescription}>
        The game plays best in landscape. Turn on Auto-rotate, then turn the phone sideways.
      </Text>
      {error && <Text style={styles.gateError}>This app build cannot rotate automatically. Reinstall the updated Active Kids development app for automatic landscape mode.</Text>}
      <AppButton title="TRY LANDSCAPE AGAIN" onPress={onRetry} />
      <AppButton title="CONTINUE HERE" variant="secondary" onPress={onContinue} />
      <AppButton title="BACK" variant="light" onPress={onExit} />
    </View>
  );
}

function LandscapePlatformerSession({
  onHome,
  width,
  height,
}: PlatformerScreenProps & { width: number; height: number }) {
  const insets = useSafeAreaInsets();
  const runtime = usePlatformerRuntime(Math.max(240, width), Math.max(220, height));
  const { game, input, snapshot, publish, handleMotionEvent, handleDeveloperInput } = runtime;
  const [phase, setPhase] = useState<GamePhase>('CAMERA_CHECK');
  const [inputSource, setInputSource] = useState<InputSource>('camera');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const cameraInterrupted = useRef(false);

  const releaseHeldInputs = useCallback(() => {
    input.handleDeveloperInput('RUN_STOP');
    input.handleDeveloperInput('CROUCH_END');
    publish();
  }, [input, publish]);

  const exitGame = useCallback(() => {
    releaseHeldInputs();
    onHome();
  }, [onHome, releaseHeldInputs]);

  const startGameplay = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    setPhase('GAMEPLAY');
    game.start();
    publish();
  }, [game, publish]);

  const pauseGame = useCallback((reason: Exclude<PauseReason, null> = 'user') => {
    releaseHeldInputs();
    if (game.currentStatus === 'PLAYING') game.pause();
    setPauseReason(reason);
    publish();
  }, [game, publish, releaseHeldInputs]);

  const resumeGame = useCallback(() => {
    if (game.currentStatus !== 'PAUSED') return;
    cameraInterrupted.current = false;
    setPauseReason(null);
    game.resume();
    publish();
  }, [game, publish]);

  const restartGame = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    if (game.currentStatus === 'GAME_OVER') game.retryFromCheckpoint();
    else game.restart();
    game.start();
    setPhase('GAMEPLAY');
    publish();
  }, [game, publish]);

  const handleCameraInterrupted = useCallback(() => {
    if (game.currentStatus === 'PLAYING') {
      cameraInterrupted.current = true;
      pauseGame('camera');
    } else {
      releaseHeldInputs();
    }
  }, [game, pauseGame, releaseHeldInputs]);

  const handleCameraReady = useCallback(() => {
    if (!cameraInterrupted.current || game.currentStatus !== 'PAUSED') return;
    cameraInterrupted.current = false;
    setPauseReason(null);
    game.resume();
    publish();
  }, [game, publish]);

  const handleLocalMotionEvent = useCallback((event: MotionEvent) => {
    if (inputSource !== 'camera' || phase !== 'GAMEPLAY') return;
    handleMotionEvent(event);
  }, [handleMotionEvent, inputSource, phase]);

  const changeInputSource = useCallback((source: InputSource) => {
    if (source === inputSource) return;
    releaseHeldInputs();
    setInputSource(source);
  }, [inputSource, releaseHeldInputs]);

  const isActivelyPlaying = phase === 'GAMEPLAY' && snapshot.status === 'PLAYING';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phase === 'GAMEPLAY' && game.currentStatus === 'PLAYING') {
        pauseGame('app');
      }
    });
    return () => subscription.remove();
  }, [game, pauseGame, phase]);

  useEffect(() => () => {
    input.handleDeveloperInput('RUN_STOP');
    input.handleDeveloperInput('CROUCH_END');
  }, [input]);

  if (inputSource === 'manual') {
    return (
      <ManualDeveloperGame
        onExit={exitGame}
        onCameraMode={() => changeInputSource('camera')}
        onInput={handleDeveloperInput}
        onStart={startGameplay}
        onPause={() => pauseGame('user')}
        onResume={resumeGame}
        onRestart={restartGame}
        snapshot={snapshot}
        width={Math.max(240, width)}
        height={Math.max(220, height)}
        topInset={insets.top}
        bottomInset={insets.bottom}
        gameFps={runtime.gameFps}
      />
    );
  }

  return (
    <CameraScreen
      gameMode
      previewVisible={phase === 'CAMERA_CHECK'}
      motionEnabled={isActivelyPlaying}
      onExit={exitGame}
      onMotionEvent={handleLocalMotionEvent}
      onSessionReady={handleCameraReady}
      onSessionSuspended={handleCameraInterrupted}
      onSessionError={handleCameraInterrupted}
    >
      <CameraPlatformerLayer
        phase={phase}
        pauseReason={pauseReason}
        onExit={exitGame}
        onStart={startGameplay}
        onPause={() => pauseGame('user')}
        onResume={resumeGame}
        onRestart={restartGame}
        onDeveloperInput={handleDeveloperInput}
        onDeveloperMode={() => changeInputSource('manual')}
        showDiagnostics={showDiagnostics}
        onToggleDiagnostics={() => setShowDiagnostics((visible) => !visible)}
        snapshot={snapshot}
        width={Math.max(240, width)}
        height={Math.max(220, height)}
        topInset={insets.top}
        bottomInset={insets.bottom}
        gameFps={runtime.gameFps}
      />
      {isActivelyPlaying && <KeepAwakeDuringGameplay />}
    </CameraScreen>
  );
}

function KeepAwakeDuringGameplay() {
  useKeepAwake(KEEP_AWAKE_TAG);
  return null;
}

function BodySilhouette({ ready }: { ready: boolean }) {
  return (
    <View
      style={[styles.silhouetteFrame, ready && styles.silhouetteFrameReady]}
      accessibilityRole="image"
      accessibilityLabel={ready ? 'Full body is inside the camera frame' : 'Stand several feet back so your full body fits in the frame'}
    >
      <View style={[styles.silhouetteHead, ready && styles.silhouettePartReady]} />
      <View style={[styles.silhouetteBody, ready && styles.silhouettePartReady]} />
      <View style={[styles.silhouetteArm, styles.silhouetteArmLeft, ready && styles.silhouettePartReady]} />
      <View style={[styles.silhouetteArm, styles.silhouetteArmRight, ready && styles.silhouettePartReady]} />
      <View style={[styles.silhouetteLeg, styles.silhouetteLegLeft, ready && styles.silhouettePartReady]} />
      <View style={[styles.silhouetteLeg, styles.silhouetteLegRight, ready && styles.silhouettePartReady]} />
    </View>
  );
}

function TutorialCue({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <View style={styles.tutorialCue} accessibilityLabel={`${title}: ${detail}`}>
      <Text style={styles.tutorialIcon} accessibilityElementsHidden>{icon}</Text>
      <Text style={styles.tutorialTitle}>{title}</Text>
      <Text style={styles.tutorialDetail}>{detail}</Text>
    </View>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultStat}>
      <Text style={styles.resultStatLabel}>{label}</Text>
      <Text style={styles.resultStatValue}>{value}</Text>
    </View>
  );
}

function getGameplayHint(state: PlatformerSnapshot, viewportWidth: number) {
  if (state.elapsedSeconds < 3.5) {
    return { title: 'RUN!', detail: 'Move your body to get going.' };
  }
  if (state.player.crouching) {
    return { title: 'NICE CROUCH!', detail: 'Keep moving when you are ready.' };
  }

  const playerRight = state.player.x + state.player.width;
  let nextGapDistance = Number.POSITIVE_INFINITY;
  let nextEnemyDistance = Number.POSITIVE_INFINITY;
  let nextCollectibleDistance = Number.POSITIVE_INFINITY;
  let nextCrouchGateDistance = Number.POSITIVE_INFINITY;
  for (const object of state.level.objects) {
    if (object.type === 'GAP' && object.x + object.width > state.player.x) {
      nextGapDistance = Math.min(nextGapDistance, object.x - playerRight);
    } else if (object.type === 'ENEMY' && !object.defeated && object.x + object.width > state.player.x) {
      nextEnemyDistance = Math.min(nextEnemyDistance, object.x - playerRight);
    } else if (object.type === 'COLLECTIBLE' && !object.collected && object.x > state.player.x) {
      nextCollectibleDistance = Math.min(nextCollectibleDistance, object.x - playerRight);
    }
  }
  for (const gate of state.level.crouchGates ?? []) {
    if (gate.x + gate.width > state.player.x) {
      nextCrouchGateDistance = Math.min(nextCrouchGateDistance, gate.x - playerRight);
    }
  }

  if (nextGapDistance < viewportWidth * 1.05) {
    return { title: 'JUMP!', detail: 'Jump over the gap.' };
  }
  if (nextEnemyDistance < viewportWidth * 0.95) {
    return { title: 'SWING!', detail: 'Swing an arm to help your new friend.' };
  }
  if (nextCrouchGateDistance < viewportWidth * 0.8) {
    return { title: 'CROUCH!', detail: 'Duck under the leafy arch.' };
  }
  if (nextCollectibleDistance < viewportWidth * 0.8) {
    return { title: 'COLLECT!', detail: 'Run through the stars and fruit.' };
  }
  return state.player.running
    ? { title: 'GREAT RUN!', detail: 'Keep going. Your next surprise is ahead.' }
    : { title: 'MOVE TO RUN!', detail: 'Move your body to guide your explorer.' };
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function CameraPlatformerLayer({
  phase,
  pauseReason,
  onExit,
  onStart,
  onPause,
  onResume,
  onRestart,
  onDeveloperInput,
  onDeveloperMode,
  showDiagnostics,
  onToggleDiagnostics,
  snapshot,
  width,
  height,
  topInset,
  bottomInset,
  gameFps,
}: {
  phase: GamePhase;
  pauseReason: PauseReason;
  onExit: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onDeveloperInput: (type: DevMotionEventType) => void;
  onDeveloperMode: () => void;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  snapshot: PlatformerSnapshot;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  gameFps: number;
}) {
  const camera = useCameraGameSession();
  const canStart = camera.cameraStatus === 'ready' && camera.bodyVisibility.state === 'FULL_BODY';
  const isChecking = phase === 'CAMERA_CHECK';
  const isLandscape = width >= height;
  const canShowLivePreview = camera.cameraStatus === 'ready' || camera.errorCode === 'nativeModuleUnavailable';
  const totalStars = snapshot.level.objects.reduce(
    (total, object) => total + (object.type === 'COLLECTIBLE' && object.kind !== 'FRUIT' ? 1 : 0),
    0,
  );
  const gameplayHint = getGameplayHint(snapshot, width);
  const trackingState = camera.bodyVisibility.state;
  const shouldShowTrackingHint = phase === 'GAMEPLAY' && snapshot.status === 'PLAYING' && trackingState !== 'FULL_BODY';
  const [trackingHintVisible, setTrackingHintVisible] = useState(false);
  const [celebrationPulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const timer = setTimeout(
      () => setTrackingHintVisible(shouldShowTrackingHint),
      shouldShowTrackingHint ? 1_200 : 0,
    );
    return () => clearTimeout(timer);
  }, [shouldShowTrackingHint]);

  useEffect(() => {
    if (snapshot.status !== 'COMPLETE') {
      celebrationPulse.stopAnimation();
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(celebrationPulse, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(celebrationPulse, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [celebrationPulse, snapshot.status]);

  const celebrationScale = celebrationPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1.12],
  });

  const startWhenReady = useCallback(() => {
    if (!canStart) return;
    camera.resetMotionController();
    onStart();
  }, [camera, canStart, onStart]);

  const resumeSafely = useCallback(() => {
    camera.resetMotionController();
    onResume();
  }, [camera, onResume]);

  const restartSafely = useCallback(() => {
    camera.resetMotionController();
    onRestart();
  }, [camera, onRestart]);

  return (
    <View style={styles.gameRoot}>
      <StatusBar hidden />
      {phase === 'GAMEPLAY' && (
        <View style={StyleSheet.absoluteFill}>
          <PlatformerRenderer state={snapshot} width={width} height={height} />
        </View>
      )}

      {isChecking ? (
        <View style={[
          styles.setupShade,
          isLandscape ? styles.setupShadeLandscape : styles.setupShadePortrait,
        ]}>
          <View style={[
            styles.setupLayout,
            isLandscape ? styles.setupLayoutLandscape : styles.setupLayoutPortrait,
            { paddingTop: Math.max(topInset, 16) + 8, paddingBottom: Math.max(bottomInset, 12) + 8 },
          ]}>
            <View style={styles.setupTopRow}>
              <AppButton title="BACK" variant="light" onPress={onExit} style={styles.smallButton} />
              <Text style={styles.setupStep}>CAMERA CHECK</Text>
              {DEBUG_PLATFORMER ? (
                <AppButton title="DEV INPUT" variant="light" onPress={onDeveloperMode} style={styles.devModeButton} />
              ) : <View style={styles.smallButtonSpacer} />}
            </View>

            <ScrollView
              style={!isLandscape && styles.setupScrollPortrait}
              contentContainerStyle={styles.setupScroll}
              showsVerticalScrollIndicator={false}
            >
            <View style={[styles.setupCard, !isLandscape && styles.setupCardPortrait]}>
              <Text style={styles.eyebrow}>READY TO PLAY</Text>
              <Text style={styles.setupTitle}>Your body is the controller</Text>
              <Text style={styles.setupIntro}>
                Stand a few feet back. Keep your whole body in view.
              </Text>

              <View style={styles.cameraCheckRow}>
                <BodySilhouette ready={canStart} />
                <View style={[
                  styles.bodyCheck,
                  canStart ? styles.bodyCheckReady : camera.cameraStatus === 'unavailable' ? styles.bodyCheckError : null,
                ]}>
                  <Text style={styles.bodyCheckTitle}>
                    {camera.cameraStatus === 'unavailable'
                      ? camera.errorCode === 'nativeModuleUnavailable' ? 'POSE MODULE NEEDED' : 'CAMERA UNAVAILABLE'
                      : camera.cameraStatus === 'starting'
                        ? 'SEARCHING FOR YOU'
                        : canStart
                          ? 'READY TO PLAY!'
                        : camera.detectorState === 'low-confidence'
                          ? 'HOLD STILL'
                          : camera.bodyVisibility.state === 'NOT_DETECTED'
                            ? 'STEP INTO THE FRAME'
                            : camera.bodyVisibility.frameTooTight
                              ? 'MOVE BACK'
                              : 'SHOW YOUR WHOLE BODY'}
                  </Text>
                  <Text style={styles.bodyCheckText}>
                    {camera.cameraStatus === 'unavailable'
                      ? camera.errorMessage ?? 'Check camera access and try again.'
                      : camera.cameraStatus === 'starting'
                        ? 'Starting the camera and on-device pose detection…'
                        : canStart
                          ? 'Great! Your head, knees, and feet are all in view.'
                        : camera.detectorState === 'low-confidence'
                          ? 'Face the phone and make sure your whole body is visible.'
                          : camera.bodyVisibility.state === 'NOT_DETECTED'
                            ? 'Stand in front of your phone camera.'
                            : camera.bodyVisibility.message}
                  </Text>
                </View>
              </View>

              <View style={styles.tutorialCard}>
                <Text style={styles.mirrorTitle}>QUICK START</Text>
                <View style={styles.tutorialControls}>
                  <TutorialCue icon="↗" title="RUN" detail="Move" />
                  <TutorialCue icon="↑" title="JUMP" detail="Jump" />
                  <TutorialCue icon="↻" title="SWING" detail="Swing an arm" />
                  <TutorialCue icon="↓" title="CROUCH" detail="Duck down" />
                </View>
              </View>

              <View style={styles.safetyNote}>
                <Text style={styles.safetyTitle}>MAKE SPACE</Text>
                <Text style={styles.safetyText}>Move clear of furniture and sharp objects. An adult should supervise young children.</Text>
              </View>

              <View style={styles.mirrorInstructions}>
                <Text style={styles.mirrorTitle}>PHONE OR TV</Text>
                <Text style={styles.mirrorText}>
                  Set it on a steady surface. TV mirroring is optional.
                </Text>
              </View>

              {camera.cameraStatus === 'unavailable' ? (
                <AppButton
                  title={camera.errorCode === 'nativeModuleUnavailable' ? 'RETRY POSE DETECTION' : 'TRY CAMERA AGAIN'}
                  onPress={camera.retryCamera}
                />
              ) : (
                <AppButton
                  title="START GAME"
                  accessibilityLabel="Start local game"
                  onPress={startWhenReady}
                  disabled={!canStart}
                />
              )}
              <Text style={styles.privacyText}>Pose detection runs on this phone. Camera video is not sent to the TV.</Text>
            </View>
            </ScrollView>
          </View>
          {canShowLivePreview && (
            <View
              pointerEvents="none"
              style={[styles.livePreviewBadge, { top: Math.max(topInset, 16) + 56 }]}
            >
              <View style={styles.livePreviewDot} />
              <Text style={styles.livePreviewText}>
                {camera.errorCode === 'nativeModuleUnavailable' ? 'LIVE CAMERA · POSE OFF' : 'LIVE CAMERA'}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <>
          <View style={[styles.gameHud, { paddingTop: Math.max(topInset, 12) + 4, paddingHorizontal: Math.max(20, width * 0.025) }]}>
            <View style={styles.hudStats}>
              <HudStat label="SCORE" value={String(snapshot.score)} />
              <HudStat label="STARS" value={`${snapshot.stars} / ${totalStars}`} />
            </View>
            <View style={styles.gameActions}>
              {DEBUG_PLATFORMER && <AppButton title={showDiagnostics ? 'DEBUG ON' : 'DEBUG'} variant="light" onPress={onToggleDiagnostics} style={styles.debugButton} />}
              <AppButton
                title={snapshot.status === 'PLAYING' ? 'PAUSE' : 'EXIT'}
                variant="light"
                onPress={snapshot.status === 'PLAYING' ? onPause : onExit}
                style={styles.hudButton}
              />
            </View>
          </View>

          {snapshot.status === 'PLAYING' && (
            <View style={[styles.gameHint, { top: Math.max(topInset, 12) + 54 }]} accessibilityLiveRegion="polite">
              <Text style={styles.gameHintTitle}>{gameplayHint.title}</Text>
              <Text style={styles.gameHintText}>{gameplayHint.detail}</Text>
            </View>
          )}

          {trackingHintVisible && shouldShowTrackingHint && (
            <View style={styles.trackingHint} accessibilityLiveRegion="polite">
              <Text style={styles.trackingHintTitle}>CAN&apos;T SEE YOU</Text>
              <Text style={styles.trackingHintText}>Step back into the frame. Your game is waiting.</Text>
            </View>
          )}

          {DEBUG_PLATFORMER && showDiagnostics && (
            <View style={[styles.diagnostics, { bottom: Math.max(bottomInset, 8) + 6 }]} pointerEvents="none">
              <Text style={styles.diagnosticText}>
                GAME {gameFps} FPS  ·  CAMERA {camera.metrics?.observedFps.toFixed(0) ?? '—'} FPS  ·  POSE {camera.metrics?.inferenceFps.toFixed(0) ?? '—'} FPS
              </Text>
              <Text style={styles.diagnosticText}>
                MOTION {camera.motionState}  ·  CONFIDENCE {camera.confidence === null ? '—' : `${Math.round(camera.confidence * 100)}%`}
              </Text>
            </View>
          )}

          {(snapshot.status === 'PAUSED' || snapshot.status === 'COMPLETE' || snapshot.status === 'GAME_OVER' || camera.cameraStatus === 'unavailable') && (
            <View style={styles.gameModalShade}>
              <View style={styles.gameModal}>
                <Text style={styles.eyebrow}>
                  {camera.cameraStatus === 'unavailable' ? 'CAMERA PAUSED' : snapshot.status === 'COMPLETE' ? 'GREAT JOB!' : snapshot.status === 'GAME_OVER' ? 'KEEP GOING' : 'TAKE A BREATHER'}
                </Text>
                {snapshot.status === 'COMPLETE' && camera.cameraStatus !== 'unavailable' && (
                  <Animated.Text style={[styles.celebration, { transform: [{ scale: celebrationScale }] }]} accessibilityLabel="Celebration">
                    ✨ 🎉 ✨
                  </Animated.Text>
                )}
                <Text style={styles.modalTitle}>
                  {camera.cameraStatus === 'unavailable'
                    ? 'Camera unavailable'
                    : snapshot.status === 'COMPLETE'
                      ? 'LEVEL COMPLETE!'
                      : snapshot.status === 'GAME_OVER'
                        ? 'TRY AGAIN!'
                        : pauseReason === 'camera'
                          ? 'RECONNECTING CAMERA'
                          : 'GAME PAUSED'}
                </Text>
                <Text style={styles.modalDescription}>
                  {camera.cameraStatus === 'unavailable'
                    ? camera.errorMessage ?? 'The camera stopped. Retry when you are ready.'
                    : snapshot.status === 'COMPLETE'
                      ? 'You ran, jumped, collected treats, and helped a friend.'
                      : snapshot.status === 'GAME_OVER'
                        ? 'Your stars are safe. Let&apos;s try again from a nearby checkpoint.'
                        : pauseReason === 'app'
                          ? 'The game paused while Active Kids was away. Resume when you are ready.'
                          : pauseReason === 'camera'
                            ? 'Your game is paused while the camera reconnects.'
                            : 'Resume when you are ready to play.'}
                </Text>
                {snapshot.status === 'COMPLETE' && camera.cameraStatus !== 'unavailable' && (
                  <View style={styles.resultGrid}>
                    <ResultStat label="SCORE" value={String(snapshot.score)} />
                    <ResultStat label="STARS" value={`${snapshot.stars} / ${totalStars}`} />
                    <ResultStat label="DISTANCE" value={`${Math.floor(snapshot.distance)} m`} />
                    <ResultStat label="TIME" value={formatDuration(snapshot.elapsedSeconds)} />
                  </View>
                )}
                {camera.cameraStatus === 'unavailable' ? (
                  <AppButton title="TRY CAMERA AGAIN" onPress={camera.retryCamera} />
                ) : snapshot.status === 'COMPLETE' || snapshot.status === 'GAME_OVER' ? (
                  <AppButton title={snapshot.status === 'GAME_OVER' ? 'TRY AGAIN' : 'PLAY AGAIN'} onPress={restartSafely} />
                ) : snapshot.status === 'PAUSED' && pauseReason !== 'camera' ? (
                  <AppButton title="RESUME" onPress={resumeSafely} />
                ) : null}
                <AppButton title="EXIT GAME" variant="secondary" onPress={onExit} />
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function ManualDeveloperGame({
  onExit,
  onCameraMode,
  onInput,
  onStart,
  onPause,
  onResume,
  onRestart,
  snapshot,
  width,
  height,
  topInset,
  bottomInset,
  gameFps,
}: {
  onExit: () => void;
  onCameraMode: () => void;
  onInput: (type: DevMotionEventType) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  snapshot: PlatformerSnapshot;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  gameFps: number;
}) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!DEBUG_PLATFORMER || Platform.OS !== 'web') return;
    const pressed = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (pressed.has(key)) return;
      const action = getKeyboardDownAction(key);
      if (!action) return;
      pressed.add(key);
      event.preventDefault();
      onInput(action);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!pressed.delete(key)) return;
      const action = getKeyboardUpAction(key);
      if (!action) return;
      event.preventDefault();
      onInput(action);
    };
    globalThis.window.addEventListener('keydown', onKeyDown);
    globalThis.window.addEventListener('keyup', onKeyUp);
    return () => {
      globalThis.window.removeEventListener('keydown', onKeyDown);
      globalThis.window.removeEventListener('keyup', onKeyUp);
      if (pressed.has('a') || pressed.has('arrowright')) onInput('RUN_STOP');
      if (pressed.has('arrowdown')) onInput('CROUCH_END');
    };
  }, [onInput]);

  return (
    <View style={styles.manualRoot}>
      <StatusBar hidden />
      {snapshot.status === 'PLAYING' && <KeepAwakeDuringGameplay />}
      <View style={[styles.manualHeader, { paddingTop: Math.max(topInset, 8) + 4 }]}>
        <AppButton title="BACK" variant="light" onPress={onExit} style={styles.hudButton} />
        <View style={styles.manualTitleBox}>
          <Text style={styles.manualTitle}>DEVELOPER INPUT</Text>
          <Text style={styles.manualSubtitle}>Touch controls{Platform.OS === 'web' ? ' and keyboard' : ''}</Text>
        </View>
        <AppButton title="CAMERA MODE" variant="light" onPress={onCameraMode} style={styles.cameraModeButton} />
      </View>
      <View style={styles.manualWorld}>
        <PlatformerRenderer state={snapshot} width={width} height={height} debug />
        {snapshot.status !== 'PLAYING' && (
          <View style={styles.manualStatus}>
            <Text style={styles.modalTitle}>{snapshot.status === 'READY' ? 'RUN, JUMP, COLLECT' : snapshot.status === 'PAUSED' ? 'GAME PAUSED' : snapshot.status === 'COMPLETE' ? 'LEVEL COMPLETE' : 'NICE TRY!'}</Text>
            <Text style={styles.modalDescription}>Hold RUN, jump the gap, and swing near the friendly spider.</Text>
          </View>
        )}
      </View>
      <View style={[styles.manualFooter, { paddingBottom: Math.max(bottomInset, insets.bottom, 8) + 4 }]}>
        <View style={styles.hudStats}>
          <HudStat label="SCORE" value={String(snapshot.score)} />
          <HudStat label="STARS" value={String(snapshot.collectibles)} />
          <HudStat label="DISTANCE" value={`${Math.floor(snapshot.distance)} m`} />
        </View>
        <DeveloperInputPad onInput={onInput} />
        <View style={styles.gameActions}>
          <AppButton title={snapshot.status === 'PLAYING' ? 'PAUSE' : snapshot.status === 'PAUSED' ? 'RESUME' : snapshot.status === 'READY' ? 'START' : 'PLAY AGAIN'} onPress={snapshot.status === 'PLAYING' ? onPause : snapshot.status === 'PAUSED' ? onResume : snapshot.status === 'READY' ? onStart : onRestart} style={styles.hudButton} />
          <Text style={styles.manualFps}>GAME {gameFps} FPS</Text>
        </View>
      </View>
    </View>
  );
}

function HudStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.hudStat}>
      <Text style={styles.hudStatLabel}>{label}</Text>
      <Text style={styles.hudStatValue}>{value}</Text>
    </View>
  );
}

function DeveloperInputPad({ onInput }: { onInput: (type: DevMotionEventType) => void }) {
  return (
    <View style={styles.devPad}>
      <HoldButton title="RUN" onStart={() => onInput('RUN_START')} onEnd={() => onInput('RUN_STOP')} />
      <TapButton title="JUMP" onPress={() => onInput('JUMP')} />
      <TapButton title="SWING" onPress={() => onInput('ARM_SWING')} />
      <HoldButton title="CROUCH" onStart={() => onInput('CROUCH_START')} onEnd={() => onInput('CROUCH_END')} />
    </View>
  );
}

function HoldButton({ title, onStart, onEnd }: { title: string; onStart: () => void; onEnd: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Developer ${title.toLowerCase()} input`}
      onPressIn={onStart}
      onPressOut={onEnd}
      style={({ pressed }) => [styles.devButton, pressed && styles.devButtonPressed]}
    >
      <Text style={styles.devButtonText}>{title}</Text>
    </Pressable>
  );
}

function TapButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Developer ${title.toLowerCase()} input`}
      onPress={onPress}
      style={({ pressed }) => [styles.devButton, pressed && styles.devButtonPressed]}
    >
      <Text style={styles.devButtonText}>{title}</Text>
    </Pressable>
  );
}

function getKeyboardDownAction(key: string): DevMotionEventType | null {
  if (key === 'a' || key === 'arrowright') return 'RUN_START';
  if (key === ' ' || key === 'spacebar') return 'JUMP';
  if (key === 'f') return 'ARM_SWING';
  if (key === 'arrowdown') return 'CROUCH_START';
  return null;
}

async function setAndroidNavigationBarHidden(hidden: boolean): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const navigationBar = requireOptionalNativeModule<{
      setHidden: (isHidden: boolean) => Promise<void>;
    }>('ExpoNavigationBar');
    await navigationBar?.setHidden(hidden);
  } catch {
    // Some Android navigation modes do not allow an app to hide the system bar.
  }
}

async function setScreenOrientationLock(orientationLock: number): Promise<void> {
  const screenOrientation = requireOptionalNativeModule<{
    lockAsync?: (lock: number) => Promise<void>;
  }>('ExpoScreenOrientation');
  if (!screenOrientation?.lockAsync) {
    throw new Error('Screen orientation controls are not included in this app binary.');
  }
  await screenOrientation.lockAsync(orientationLock);
}

function getKeyboardUpAction(key: string): DevMotionEventType | null {
  if (key === 'a' || key === 'arrowright') return 'RUN_STOP';
  if (key === 'arrowdown') return 'CROUCH_END';
  return null;
}

const styles = StyleSheet.create({
  gateRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: '#12243A',
  },
  gateEyebrow: { color: '#9CE8C1', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  gateTitle: { color: colors.white, fontSize: 30, lineHeight: 36, fontWeight: '900', textAlign: 'center' },
  gateDescription: { maxWidth: 420, color: '#E0E9F2', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  gateError: { color: '#FDE68A', fontSize: 14, textAlign: 'center' },
  gameRoot: { flex: 1, backgroundColor: '#A9E7FF', overflow: 'hidden' },
  setupShade: { ...StyleSheet.absoluteFill, justifyContent: 'center', backgroundColor: 'rgba(8, 20, 34, 0.08)' },
  setupShadeLandscape: { backgroundColor: 'transparent' },
  setupShadePortrait: { backgroundColor: 'transparent' },
  setupLayout: { flex: 1, justifyContent: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.md },
  setupLayoutLandscape: { width: '54%', maxWidth: 480, alignSelf: 'flex-start', backgroundColor: 'rgba(8,20,34,0.48)' },
  setupLayoutPortrait: { justifyContent: 'space-between' },
  setupScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xs },
  setupScrollPortrait: { flexGrow: 0, flexShrink: 1, maxHeight: '64%' },
  setupTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  setupStep: { color: colors.white, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  setupCard: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.97)' },
  setupCardPortrait: { backgroundColor: 'rgba(255,255,255,0.74)' },
  livePreviewBadge: { position: 'absolute', right: spacing.md, zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: 'rgba(12,31,46,0.88)' },
  livePreviewDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#56E39F' },
  livePreviewText: { color: colors.white, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  eyebrow: { color: colors.primaryDark, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  setupTitle: { color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: '900' },
  setupIntro: { color: colors.textSecondary, fontSize: 13, lineHeight: 17 },
  cameraCheckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  silhouetteFrame: { width: 64, height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: '#B8C6D5', backgroundColor: '#F1F5F8' },
  silhouetteFrameReady: { borderColor: '#45B77C', backgroundColor: '#ECFAF1' },
  silhouetteHead: { position: 'absolute', top: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: '#9BAEC0' },
  silhouetteBody: { position: 'absolute', top: 26, width: 12, height: 23, borderRadius: 6, backgroundColor: '#9BAEC0' },
  silhouetteArm: { position: 'absolute', top: 29, width: 4, height: 20, borderRadius: 3, backgroundColor: '#9BAEC0' },
  silhouetteArmLeft: { left: 18, transform: [{ rotate: '22deg' }] },
  silhouetteArmRight: { right: 18, transform: [{ rotate: '-22deg' }] },
  silhouetteLeg: { position: 'absolute', top: 46, width: 5, height: 23, borderRadius: 3, backgroundColor: '#9BAEC0' },
  silhouetteLegLeft: { left: 25, transform: [{ rotate: '7deg' }] },
  silhouetteLegRight: { right: 25, transform: [{ rotate: '-7deg' }] },
  silhouettePartReady: { backgroundColor: '#45B77C' },
  bodyCheck: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: '#FFF4D6' },
  tutorialCard: { gap: spacing.xs, padding: spacing.xs, borderRadius: radius.md, backgroundColor: 'rgba(244,247,255,0.88)' },
  tutorialControls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tutorialCue: { flex: 1, minWidth: 82, alignItems: 'center', gap: 1, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.white },
  tutorialIcon: { color: colors.primaryDark, fontSize: 16, lineHeight: 19, fontWeight: '900' },
  tutorialTitle: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  tutorialDetail: { color: colors.textSecondary, fontSize: 9, textAlign: 'center' },
  safetyNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.xs, borderRadius: radius.md, backgroundColor: '#FFF7E6' },
  safetyTitle: { color: '#8A5A13', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  safetyText: { flex: 1, color: '#684E2E', fontSize: 10, lineHeight: 14 },
  bodyCheckReady: { backgroundColor: '#DDF8E9' },
  bodyCheckError: { backgroundColor: '#FCE6E6' },
  bodyCheckTitle: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  bodyCheckText: { marginTop: 3, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  mirrorInstructions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  mirrorTitle: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  mirrorText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  privacyText: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  smallButton: { minWidth: 78, minHeight: 40 },
  smallButtonSpacer: { width: 94 },
  devModeButton: { minWidth: 94, minHeight: 40, paddingHorizontal: spacing.sm },
  gameHud: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  hudStats: { flexDirection: 'row', gap: spacing.xs },
  hudStat: { minWidth: 92, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.94)' },
  hudStatLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  hudStatValue: { marginTop: 2, color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  gameActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hudButton: { minWidth: 82, minHeight: 48, paddingHorizontal: spacing.sm },
  debugButton: { minWidth: 72, minHeight: 48, paddingHorizontal: spacing.xs },
  gameHint: { position: 'absolute', top: 62, alignSelf: 'center', zIndex: 2, minWidth: 190, alignItems: 'center', gap: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(28,54,80,0.9)' },
  gameHintTitle: { color: '#FFE46B', fontSize: 20, lineHeight: 24, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center' },
  gameHintText: { color: colors.white, fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  trackingHint: { position: 'absolute', bottom: '18%', alignSelf: 'center', zIndex: 3, alignItems: 'center', gap: 2, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(28,54,80,0.92)' },
  trackingHintTitle: { color: '#FFE46B', fontSize: 19, fontWeight: '900' },
  trackingHintText: { color: colors.white, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  diagnostics: { position: 'absolute', left: 12, zIndex: 2, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: 'rgba(18,42,58,0.78)' },
  diagnosticText: { color: '#E6FFF1', fontSize: 9, lineHeight: 13, fontVariant: ['tabular-nums'] },
  gameModalShade: { ...StyleSheet.absoluteFill, zIndex: 3, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(14,27,38,0.34)' },
  gameModal: { width: '100%', maxWidth: 420, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.98)' },
  modalTitle: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '900' },
  modalDescription: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  celebration: { alignSelf: 'center', fontSize: 30, lineHeight: 38, letterSpacing: 4 },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  resultStat: { flexGrow: 1, flexBasis: '45%', alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: '#EEF7F2' },
  resultStatLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  resultStatValue: { marginTop: 2, color: colors.primaryDark, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  manualRoot: { flex: 1, backgroundColor: '#A9E7FF' },
  manualHeader: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  manualTitleBox: { flex: 1, alignItems: 'center' },
  manualTitle: { color: colors.text, fontSize: 14, fontWeight: '900', letterSpacing: 0.7 },
  manualSubtitle: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  cameraModeButton: { minWidth: 112, minHeight: 40, paddingHorizontal: spacing.sm },
  manualWorld: { ...StyleSheet.absoluteFill, top: 0 },
  manualStatus: { position: 'absolute', top: '40%', alignSelf: 'center', width: '70%', maxWidth: 440, gap: spacing.xs, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.9)' },
  manualFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, backgroundColor: 'rgba(242,248,247,0.94)' },
  devPad: { flexDirection: 'row', gap: spacing.xs },
  devButton: { flex: 1, minWidth: 0, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: radius.md, borderWidth: 1, borderColor: '#C9D4F5', backgroundColor: '#FFFFFF' },
  devButtonPressed: { backgroundColor: '#DCE3FF', transform: [{ scale: 0.97 }] },
  devButtonText: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.25 },
  manualFps: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
});
