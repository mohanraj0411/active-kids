import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  PanResponder,
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
import type { RuntimePerformanceSnapshot } from '../game/platformer/RuntimePerformanceMeter';
import { amplifyAssistMovement, canStartGame } from '../game/platformer/inputModes';
import { PERFORMANCE_TEST_DURATION_MS, PerformanceTestHarness, type PerformanceTestValues } from '../game/platformer/PerformanceTestHarness';
import type { DevMotionEventType, PlatformerSnapshot } from '../game/platformer/types';
import type { HorizontalMovement, MotionEvent } from '../motion/controllerTypes';
import { NEUTRAL_HORIZONTAL_MOVEMENT } from '../motion/controllerTypes';
import { BODY_LEAN_CONFIG } from '../motion/motionThresholds';
import { colors, radius, spacing } from '../theme';
import { CameraScreen, useCameraGameSession } from './CameraScreen';

const DEBUG_PLATFORMER = __DEV__;
const KEEP_AWAKE_TAG = 'active-kids-platformer-gameplay';
// Values from Expo ScreenOrientation.OrientationLock.
const ORIENTATION_LOCK_LANDSCAPE = 5;
const ORIENTATION_LOCK_PORTRAIT_UP = 3;

type GamePhase = 'MODE_SELECT' | 'CAMERA_CHECK' | 'CALIBRATING' | 'GAMEPLAY';
type InputMode = 'BODY' | 'TOUCH' | 'ASSIST';
type InputSource = 'body' | 'touch';
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
  const { game, input, snapshot, publish, handleMotionEvent, handleHorizontalMovement, handleDeveloperInput } = runtime;
  const [phase, setPhase] = useState<GamePhase>('MODE_SELECT');
  const [inputMode, setInputMode] = useState<InputMode>('BODY');
  const [inputSource, setInputSource] = useState<InputSource>('body');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const cameraInterrupted = useRef(false);
  const cameraMovementRef = useRef<HorizontalMovement>({ direction: 0, intensity: 0 });
  const touchMovementRef = useRef<HorizontalMovement | null>(null);

  const releaseHeldInputs = useCallback(() => {
    cameraMovementRef.current = { direction: 0, intensity: 0 };
    touchMovementRef.current = null;
    input.releaseAll();
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

  const selectTouchMode = useCallback(() => {
    releaseHeldInputs();
    input.selectSource('TOUCH');
    setInputMode('TOUCH');
    setInputSource('touch');
    if (game.currentStatus === 'PAUSED') game.resume();
    else if (game.currentStatus === 'READY') game.start();
    setPauseReason(null);
    setPhase('GAMEPLAY');
    publish();
  }, [game, input, publish, releaseHeldInputs]);

  const selectAssistMode = useCallback(() => {
    releaseHeldInputs();
    input.selectSource('TOUCH');
    setInputMode('ASSIST');
    setInputSource('touch');
    if (game.currentStatus === 'PAUSED') game.resume();
    else if (game.currentStatus === 'READY') game.start();
    setPauseReason(null);
    setPhase('GAMEPLAY');
    publish();
  }, [game, input, publish, releaseHeldInputs]);

  const selectBodyMode = useCallback(() => {
    releaseHeldInputs();
    input.selectSource('BODY');
    setInputMode('BODY');
    setInputSource('body');
    if (game.currentStatus === 'COMPLETE' || game.currentStatus === 'GAME_OVER') game.restart();
    if (game.currentStatus === 'PLAYING') game.pause();
    setPauseReason('user');
    setPhase('CAMERA_CHECK');
  }, [game, input, releaseHeldInputs]);

  const switchToTouchMode = useCallback(() => {
    releaseHeldInputs();
    input.selectSource('TOUCH');
    setInputMode('TOUCH');
    setInputSource('touch');
    if (game.currentStatus === 'PAUSED' && pauseReason === 'camera') game.resume();
    setPauseReason(null);
    setPhase('GAMEPLAY');
    publish();
  }, [game, input, pauseReason, publish, releaseHeldInputs]);

  const beginCameraCalibration = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    setPhase('CALIBRATING');
  }, []);

  const completeCameraCalibration = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    if (game.currentStatus === 'PAUSED') game.resume();
    else if (game.currentStatus === 'READY') game.start();
    setPhase('GAMEPLAY');
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

  const restartCameraGame = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    if (game.currentStatus === 'GAME_OVER') game.retryFromCheckpoint();
    else game.restart();
    setPhase('CALIBRATING');
    publish();
  }, [game, publish]);

  const resumeCameraGame = useCallback(() => {
    setPauseReason(null);
    cameraInterrupted.current = false;
    setPhase('CALIBRATING');
  }, []);

  const handleCameraInterrupted = useCallback(() => {
    if (phase === 'CALIBRATING') {
      setPhase('CAMERA_CHECK');
      releaseHeldInputs();
      return;
    }
    if (inputMode === 'BODY' && inputSource === 'body' && game.currentStatus === 'PLAYING') {
      cameraInterrupted.current = true;
      pauseGame('camera');
    } else {
      releaseHeldInputs();
    }
  }, [game, inputMode, inputSource, pauseGame, phase, releaseHeldInputs]);

  const handleCameraReady = useCallback(() => {
    if (!cameraInterrupted.current || game.currentStatus !== 'PAUSED') return;
    cameraInterrupted.current = false;
    setPauseReason(null);
    setPhase('CALIBRATING');
  }, [game]);

  const handleLocalMotionEvent = useCallback((event: MotionEvent) => {
    if (inputMode !== 'BODY' || inputSource !== 'body' || phase !== 'GAMEPLAY') return;
    // Camera travel uses continuous lean; RUN events remain for legacy, touch,
    // developer, and network consumers.
    if (event.type === 'RUN_START' || event.type === 'RUN_STOP') return;
    handleMotionEvent(event);
  }, [handleMotionEvent, inputMode, inputSource, phase]);

  const handleCameraLean = useCallback((movement: HorizontalMovement) => {
    if (inputSource !== 'body' || phase !== 'GAMEPLAY' || game.currentStatus !== 'PLAYING') {
      cameraMovementRef.current = { direction: 0, intensity: 0 };
      handleHorizontalMovement(NEUTRAL_HORIZONTAL_MOVEMENT, 'BODY');
      return;
    }
    const bodyMovement = inputMode === 'ASSIST' ? amplifyAssistMovement(movement) : movement;
    cameraMovementRef.current = bodyMovement;
    handleHorizontalMovement(touchMovementRef.current ?? bodyMovement, 'BODY');
  }, [game, handleHorizontalMovement, inputMode, inputSource, phase]);

  const handleTouchMovement = useCallback((movement: HorizontalMovement | null) => {
    if (inputSource !== 'touch') {
      touchMovementRef.current = null;
      return;
    }
    if (phase !== 'GAMEPLAY' || game.currentStatus !== 'PLAYING') {
      touchMovementRef.current = null;
      handleHorizontalMovement(NEUTRAL_HORIZONTAL_MOVEMENT, 'TOUCH');
      return;
    }

    touchMovementRef.current = movement;
    handleHorizontalMovement(
      movement ?? NEUTRAL_HORIZONTAL_MOVEMENT,
      'TOUCH',
    );
  }, [game, handleHorizontalMovement, inputSource, phase]);

  const handleTouchInput = useCallback((type: DevMotionEventType) => {
    if (inputSource !== 'touch' || phase !== 'GAMEPLAY' || game.currentStatus !== 'PLAYING') return;
    handleDeveloperInput(type, 'TOUCH');
  }, [game, handleDeveloperInput, inputSource, phase]);

  const changeInputSource = useCallback((source: InputSource) => {
    if (source === inputSource) return;
    releaseHeldInputs();
    input.selectSource(source === 'body' ? 'BODY' : 'TOUCH');
    setInputSource(source);
  }, [input, inputSource, releaseHeldInputs]);

  const changeToBodyMode = useCallback(() => {
    setInputMode('BODY');
    changeInputSource('body');
    if (game.currentStatus === 'PLAYING') game.pause();
    setPauseReason('user');
    setPhase('CAMERA_CHECK');
  }, [changeInputSource, game]);

  const fallbackAssistToTouch = useCallback(() => {
    releaseHeldInputs();
    input.selectSource('TOUCH');
    setInputSource('touch');
  }, [input, releaseHeldInputs]);

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
    input.releaseAll();
  }, [input]);

  if (phase === 'MODE_SELECT') {
    return (
      <InputModeSelection
        onBody={selectBodyMode}
        onTouch={selectTouchMode}
        onAssist={selectAssistMode}
        onExit={exitGame}
        topInset={insets.top}
        bottomInset={insets.bottom}
      />
    );
  }

  if (inputMode === 'TOUCH') {
    return (
      <ManualDeveloperGame
        onExit={exitGame}
        onCameraMode={changeToBodyMode}
        onInput={handleDeveloperInput}
        onTouchInput={handleTouchInput}
        onMovement={handleTouchMovement}
        onStart={startGameplay}
        onPause={() => pauseGame('user')}
        onResume={resumeGame}
        onRestart={restartGame}
        snapshot={snapshot}
        width={Math.max(240, width)}
        height={Math.max(220, height)}
        topInset={insets.top}
        bottomInset={insets.bottom}
        leftInset={insets.left}
        rightInset={insets.right}
        gameFps={runtime.performance.gameRafRateHz}
        performance={runtime.performance}
        onRenderTime={runtime.recordReactRender}
      />
    );
  }

  return (
    <CameraScreen
      gameMode
      previewVisible={phase !== 'GAMEPLAY'}
      motionEnabled={phase === 'CALIBRATING' || (isActivelyPlaying && (inputMode === 'BODY' || inputMode === 'ASSIST'))}
      autoCalibrate={inputMode === 'ASSIST'}
      onExit={exitGame}
      onMotionEvent={handleLocalMotionEvent}
      onHorizontalMovement={handleCameraLean}
      onSessionReady={handleCameraReady}
      onSessionSuspended={inputMode === 'BODY' ? handleCameraInterrupted : fallbackAssistToTouch}
      onSessionError={inputMode === 'BODY' ? handleCameraInterrupted : fallbackAssistToTouch}
    >
      <CameraPlatformerLayer
        phase={phase}
        pauseReason={pauseReason}
        onExit={exitGame}
        onStart={beginCameraCalibration}
        onCalibrationComplete={completeCameraCalibration}
        onPause={() => pauseGame('user')}
        onResume={resumeCameraGame}
        onRestart={restartCameraGame}
        onTouchInput={handleTouchInput}
        onTouchMovement={handleTouchMovement}
        onTouchInputMode={switchToTouchMode}
        onSwitchInput={() => changeInputSource(inputSource === 'body' ? 'touch' : 'body')}
        inputMode={inputMode}
        inputSource={inputSource}
        showDiagnostics={showDiagnostics}
        onToggleDiagnostics={() => setShowDiagnostics((visible) => !visible)}
        snapshot={snapshot}
        width={Math.max(240, width)}
        height={Math.max(220, height)}
        topInset={insets.top}
        bottomInset={insets.bottom}
        leftInset={insets.left}
        rightInset={insets.right}
        gameFps={runtime.performance.gameRafRateHz}
        performance={runtime.performance}
        onRenderTime={runtime.recordReactRender}
      />
      {isActivelyPlaying && <KeepAwakeDuringGameplay />}
    </CameraScreen>
  );
}

function KeepAwakeDuringGameplay() {
  useKeepAwake(KEEP_AWAKE_TAG);
  return null;
}

function InputModeSelection({
  onBody,
  onTouch,
  onAssist,
  onExit,
  topInset,
  bottomInset,
}: {
  onBody: () => void;
  onTouch: () => void;
  onAssist: () => void;
  onExit: () => void;
  topInset: number;
  bottomInset: number;
}) {
  return (
    <View style={[styles.modeSelectRoot, { paddingTop: Math.max(topInset, 14) + 8, paddingBottom: Math.max(bottomInset, 12) + 8 }]}>
      <View style={[styles.modeSelectHeader, { top: Math.max(topInset, 14) + 8 }]}>
        <AppButton title="BACK" variant="light" onPress={onExit} style={styles.smallButton} />
        <Text style={styles.modeSelectEyebrow}>ACTIVE KIDS</Text>
        <View style={styles.smallButtonSpacer} />
      </View>
      <Text style={styles.modeSelectTitle}>HOW DO YOU WANT TO PLAY?</Text>
      <View style={styles.modeSelectOptions}>
        <ModeChoice icon="↔" title="BODY" detail="Move with your body." onPress={onBody} />
        <ModeChoice icon="●" title="TOUCH" detail="Use the controls on screen." onPress={onTouch} />
        <ModeChoice icon="＋" title="ASSIST" detail="Small body leans with touch help." onPress={onAssist} />
      </View>
      <Text style={styles.modeSelectFootnote}>Touch play never needs camera access. Assist keeps touch controls ready if body input is unavailable.</Text>
    </View>
  );
}

function ModeChoice({ icon, title, detail, onPress }: {
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.modeChoice, pressed && styles.modeChoicePressed]}
    >
      <Text style={styles.modeChoiceIcon}>{icon}</Text>
      <Text style={styles.modeChoiceTitle}>{title}</Text>
      <Text style={styles.modeChoiceDetail}>{detail}</Text>
    </Pressable>
  );
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
  if (state.respawning) {
    return { title: 'BACK IN A MOMENT!', detail: 'Your stars are safe. Meet you at the checkpoint.' };
  }
  if (state.player.x - state.level.startX < viewportWidth * 0.35 && state.elapsedSeconds < 5) {
    return { title: 'LEAN RIGHT!', detail: 'Lean your body or move the left joystick.' };
  }
  if (state.player.crouching) {
    return { title: 'NICE CROUCH!', detail: 'Keep moving when you are ready.' };
  }

  const challengeDistance = state.challenge
    ? state.challenge.targetX - state.player.x - state.player.width
    : Number.POSITIVE_INFINITY;
  const challengeLead = state.difficulty === 'EASY' ? 1.25 : state.difficulty === 'CHALLENGE' ? 0.92 : 1;
  if (state.challenge && challengeDistance < viewportWidth * challengeLead && challengeDistance > -viewportWidth * 0.25) {
    return { title: state.challenge.title, detail: state.challenge.prompt };
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
  const recentFeedback = state.feedback && state.elapsedSeconds - state.feedback.time < 1.2
    ? state.feedback
    : null;
  if (recentFeedback?.type === 'GATE') {
    return { title: 'CROUCH TO PASS!', detail: 'Duck under the leafy arch.' };
  }
  if (recentFeedback?.type === 'MISSION') {
    return { title: 'MISSION COMPLETE!', detail: 'A bonus star is yours!' };
  }
  if (recentFeedback && (recentFeedback.type === 'COLLECTIBLE' || recentFeedback.type === 'ENEMY_HIT' || recentFeedback.type === 'LANDING' || recentFeedback.type === 'COMBO')) {
    return {
      title: state.combo > 1 ? `COMBO x${state.combo}!` : 'GREAT!',
      detail: state.combo > 1 ? 'Keep the good moves going.' : 'You did it. Keep exploring!',
    };
  }
  return state.player.running
    ? { title: 'GREAT RUN!', detail: 'Keep going. Your next surprise is ahead.' }
    : { title: 'MOVE TO RUN!', detail: 'Use the left joystick or lean to guide your explorer.' };
}

function MissionHud({
  mission,
  toast,
  elapsedSeconds,
  top,
  left,
}: {
  mission: PlatformerSnapshot['mission'];
  toast: PlatformerSnapshot['missionToast'];
  elapsedSeconds: number;
  top: number;
  left: number;
}) {
  const showToast = toast != null && elapsedSeconds - toast.time < 1.8;
  if (!mission && !showToast) return null;
  const progress = mission ? Math.min(1, mission.progress / mission.target) : 1;
  return (
    <View pointerEvents="none" style={[styles.missionHud, { top, left }]} accessibilityLiveRegion="polite">
      <Text style={styles.missionHudEyebrow}>{showToast ? 'MISSION COMPLETE!' : 'MISSION'}</Text>
      <Text style={styles.missionHudTitle} numberOfLines={1}>
        {showToast ? toast.title : mission?.title}
      </Text>
      <Text style={styles.missionHudDescription} numberOfLines={1}>
        {showToast ? 'BONUS STAR +25 POINTS' : mission?.description}
      </Text>
      {!showToast && mission && (
        <View style={styles.missionProgressRow}>
          <View style={styles.missionProgressTrack}>
            <View style={[styles.missionProgressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.missionProgressText}>{mission.progress}/{mission.target}</Text>
        </View>
      )}
    </View>
  );
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
  onCalibrationComplete,
  onPause,
  onResume,
  onRestart,
  onTouchInput,
  onTouchMovement,
  onTouchInputMode,
  onSwitchInput,
  inputMode,
  inputSource,
  showDiagnostics,
  onToggleDiagnostics,
  snapshot,
  width,
  height,
  topInset,
  bottomInset,
  leftInset,
  rightInset,
  gameFps,
  performance,
  onRenderTime,
}: {
  phase: GamePhase;
  pauseReason: PauseReason;
  onExit: () => void;
  onStart: () => void;
  onCalibrationComplete: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onTouchInput: (type: DevMotionEventType) => void;
  onTouchMovement: (movement: HorizontalMovement | null) => void;
  onTouchInputMode: () => void;
  onSwitchInput: () => void;
  inputMode: InputMode;
  inputSource: InputSource;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  snapshot: PlatformerSnapshot;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  leftInset: number;
  rightInset: number;
  gameFps: number;
  performance: RuntimePerformanceSnapshot;
  onRenderTime: (durationMs: number) => void;
}) {
  const camera = useCameraGameSession();
  const beginNeutralCalibration = camera.beginNeutralCalibration;
  const completeNeutralCalibration = camera.completeNeutralCalibration;
  const bodyLeanIsCalibrating = camera.bodyLean.calibrating;
  const canStart = canStartGame(
    inputMode,
    camera.cameraStatus === 'ready',
    camera.bodyVisibility.state === 'FULL_BODY',
  );
  const isChecking = phase === 'CAMERA_CHECK';
  const [calibrationCountdown, setCalibrationCountdown] = useState(
    Math.ceil(BODY_LEAN_CONFIG.calibrationDurationMs / 1_000),
  );
  const isLandscape = width >= height;
  const canShowLivePreview = camera.cameraStatus === 'ready' || camera.errorCode === 'nativeModuleUnavailable';
  const totalStars = snapshot.level.objects.reduce(
    (total, object) => total + (object.type === 'COLLECTIBLE' && object.kind !== 'FRUIT' ? 1 : 0),
    snapshot.missionBonusStarsAvailable,
  );
  const gameplayHint = getGameplayHint(snapshot, width);
  const trackingState = camera.bodyVisibility.state;
  const shouldShowTrackingHint = inputMode === 'BODY' && phase === 'GAMEPLAY' && snapshot.status === 'PLAYING' && trackingState !== 'FULL_BODY';
  const [trackingHintVisible, setTrackingHintVisible] = useState(false);
  const [celebrationPulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (phase !== 'CALIBRATING') return;
    if (!bodyLeanIsCalibrating) beginNeutralCalibration();
    const startedAt = Date.now();
    const resetCountdown = setTimeout(
      () => setCalibrationCountdown(Math.ceil(BODY_LEAN_CONFIG.calibrationDurationMs / 1_000)),
      0,
    );
    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((BODY_LEAN_CONFIG.calibrationDurationMs - (Date.now() - startedAt)) / 1_000),
      );
      setCalibrationCountdown((current) => current === remaining ? current : remaining);
    };
    const interval = setInterval(updateCountdown, 150);
    const timeout = setTimeout(() => {
      completeNeutralCalibration();
      onCalibrationComplete();
    }, BODY_LEAN_CONFIG.calibrationDurationMs);
    return () => {
      clearTimeout(resetCountdown);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [beginNeutralCalibration, bodyLeanIsCalibrating, completeNeutralCalibration, onCalibrationComplete, phase]);

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
    setCalibrationCountdown(Math.ceil(BODY_LEAN_CONFIG.calibrationDurationMs / 1_000));
    beginNeutralCalibration();
    onStart();
  }, [beginNeutralCalibration, canStart, onStart]);

  const resumeSafely = useCallback(() => {
    setCalibrationCountdown(Math.ceil(BODY_LEAN_CONFIG.calibrationDurationMs / 1_000));
    beginNeutralCalibration();
    onResume();
  }, [beginNeutralCalibration, onResume]);

  const restartSafely = useCallback(() => {
    setCalibrationCountdown(Math.ceil(BODY_LEAN_CONFIG.calibrationDurationMs / 1_000));
    beginNeutralCalibration();
    onRestart();
  }, [beginNeutralCalibration, onRestart]);

  return (
    <View style={styles.gameRoot}>
      <StatusBar hidden />
      {phase === 'GAMEPLAY' && (
        <View style={StyleSheet.absoluteFill}>
          <PlatformerRenderer state={snapshot} width={width} height={height} onRenderTime={onRenderTime} />
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
              <View style={styles.smallButtonSpacer} />
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
              <Text style={styles.setupIntro}>Make some clear space. Stay away from sharp objects. Ask an adult if needed.</Text>

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
                  <TutorialCue icon="↔" title="LEAN" detail="Lean left or right" />
                  <TutorialCue icon="↑" title="JUMP" detail="Jump" />
                  <TutorialCue icon="↻" title="SWING" detail="Swing an arm" />
                  <TutorialCue icon="↓" title="CROUCH" detail="Duck down" />
                </View>
                <Text style={styles.touchControlHint}>During play, move with the left joystick and use the separate buttons on the right.</Text>
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
                <>
                  <AppButton title={camera.errorCode === 'nativeModuleUnavailable' ? 'RETRY POSE DETECTION' : 'TRY CAMERA AGAIN'} onPress={camera.retryCamera} />
                  <AppButton title="USE TOUCH MODE" variant="secondary" onPress={onTouchInputMode} />
                </>
              ) : (
                <>
                  <AppButton title="START GAME" accessibilityLabel="Start local game" onPress={startWhenReady} disabled={!canStart} />
                  <AppButton title="USE TOUCH MODE" variant="secondary" onPress={onTouchInputMode} />
                </>
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
      ) : phase === 'CALIBRATING' ? (
        <View style={styles.calibrationShade}>
          <View style={styles.calibrationCard}>
            <Text style={styles.eyebrow}>GET READY</Text>
            <Text style={styles.calibrationTitle}>Stand normally</Text>
            <Text style={styles.calibrationDescription}>
              Keep your whole body in view while we find your center.
            </Text>
            <Text style={styles.calibrationCountdown}>
              {calibrationCountdown > 0 ? calibrationCountdown : 'GO!'}
            </Text>
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.gameHud, { paddingTop: Math.max(topInset, 12) + 4, paddingHorizontal: Math.max(20, width * 0.025) }]}>
            <View style={styles.hudStats}>
              <HudStat label="SCORE" value={String(snapshot.score)} />
              <HudStat label="STARS" value={`${snapshot.stars} / ${totalStars}`} />
              <HudStat
                label="HEARTS"
                value={`${'♥'.repeat(snapshot.hearts)}${'♡'.repeat(Math.max(0, 3 - snapshot.hearts))}`}
              />
              {snapshot.combo > 1 && <HudStat label="COMBO" value={`×${snapshot.combo}`} />}
            </View>
            <View style={styles.gameActions}>
              <Text style={styles.inputModeBadge}>
                {inputMode === 'ASSIST' ? `BODY ASSIST · ${inputSource === 'body' ? 'BODY ACTIVE' : 'TOUCH ACTIVE'}` : inputSource === 'body' ? 'BODY MODE ACTIVE' : 'TOUCH INPUT ACTIVE'}
              </Text>
              <AppButton
                title={inputSource === 'body' ? 'TOUCH INPUT' : 'BODY INPUT'}
                variant="light"
                onPress={onSwitchInput}
                style={styles.debugButton}
              />
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

          {snapshot.status === 'PLAYING' && (
            <MissionHud
              mission={snapshot.mission}
              toast={snapshot.missionToast}
              elapsedSeconds={snapshot.elapsedSeconds}
              top={Math.max(topInset, 12) + 66}
              left={Math.max(leftInset, 14) + 4}
            />
          )}

          {trackingHintVisible && shouldShowTrackingHint && (
            <View style={styles.trackingHint} accessibilityLiveRegion="polite">
              <Text style={styles.trackingHintTitle}>CAN&apos;T SEE YOU</Text>
              <Text style={styles.trackingHintText}>Step back into the frame. Your game is waiting.</Text>
            </View>
          )}

          {DEBUG_PLATFORMER && showDiagnostics && (
            <View style={[styles.diagnostics, { bottom: Math.max(bottomInset, 8) + 6 }]} pointerEvents="none">
              <Text style={styles.diagnosticText}>CAMERA CAPTURE {camera.metrics?.observedFps.toFixed(1) ?? 'N/A'} Hz · POSE INFERENCE {camera.metrics?.inferenceFps.toFixed(1) ?? 'N/A'} Hz</Text>
              <Text style={styles.diagnosticText}>MOTION {camera.motionProcessing.rateHz.toFixed(1)} Hz · {camera.motionProcessing.averageMs.toFixed(2)} ms avg · {camera.motionProcessing.maximumMs.toFixed(2)} ms max</Text>
              <Text style={styles.diagnosticText}>SIMULATION {performance.simulationRateHz.toFixed(1)} Hz · {performance.simulationAverageMs.toFixed(2)}/{performance.simulationMaximumMs.toFixed(2)} ms avg/max</Text>
              <Text style={styles.diagnosticText}>GAME RAF {gameFps.toFixed(1)} Hz · RENDER LOOP {performance.renderLoopRateHz.toFixed(1)} Hz · REACT COMMIT {performance.reactCommitRateHz.toFixed(1)} Hz</Text>
              <Text style={styles.diagnosticText}>REACT RENDER {performance.reactRenderAverageMs.toFixed(2)}/{performance.reactRenderMaximumMs.toFixed(2)} ms avg/max · CAMERA→POSE N/A · POSE→GAME N/A</Text>
              <Text style={styles.diagnosticText}>
                LEAN {camera.bodyLean.angleDegrees >= 0 ? '+' : ''}{camera.bodyLean.angleDegrees.toFixed(1)}°  ·  {camera.bodyLean.direction < 0 ? 'LEFT' : camera.bodyLean.direction > 0 ? 'RIGHT' : 'CENTER'} {Math.round(camera.bodyLean.intensity * 100)}%  ·  TORSO {Math.round(camera.bodyLean.trackingConfidence * 100)}%
              </Text>
              <Text style={styles.diagnosticText}>
                INFERENCE {camera.metrics?.averageInferenceDurationMs == null ? '—' : `${camera.metrics.averageInferenceDurationMs.toFixed(0)} ms`}  ·  MOTION {camera.motionProcessing.sampleCount ? `${camera.motionProcessing.averageMs.toFixed(2)} ms avg` : '—'}  ·  CADENCE SKIPS {camera.metrics?.skippedInferenceFrames ?? '—'}
              </Text>
              <Text style={styles.diagnosticText}>
                MODEL {camera.poseModelVariant ?? '—'} / {camera.poseModelDelegate ?? '—'} · {camera.cameraInfo ? `${camera.cameraInfo.imageWidth}×${camera.cameraInfo.imageHeight}` : 'N/A'} · THERMAL {camera.thermalState ?? 'N/A'} · CPU N/A · MEMORY N/A · NETWORK N/A
              </Text>
              <Text style={styles.diagnosticText}>
                CALIBRATION {camera.bodyLean.calibrating ? 'IN PROGRESS' : camera.bodyLean.calibrated ? 'READY' : 'NOT RECORDED'}  ·  ACTIONS {camera.motionState}
              </Text>
              <Text style={styles.diagnosticText}>
                ADAPT {snapshot.difficulty} · SCORE {Math.round(snapshot.performance.performanceScore)} · COMBO ×{snapshot.combo} · MISSION {snapshot.mission ? `${snapshot.mission.progress}/${snapshot.mission.target}` : 'DONE'}
              </Text>
            </View>
          )}

          {DEBUG_PLATFORMER && (
            <PerformanceTestControl
              inputMode={inputMode}
              width={width}
              height={height}
              cameraState={camera.cameraStatus}
              performance={performance}
              captureRateHz={camera.metrics?.observedFps ?? null}
              poseRateHz={camera.metrics?.inferenceFps ?? null}
              motionRateHz={camera.motionProcessing.rateHz}
              skippedPoseFrames={camera.metrics?.skippedInferenceFrames ?? null}
              thermalState={camera.thermalState ?? null}
              enabled={snapshot.status === 'PLAYING'}
            />
          )}

          {snapshot.status === 'PLAYING' && (
            <GameTouchControls
              onMovementChange={onTouchMovement}
              onInput={onTouchInput}
              leftInset={leftInset}
              rightInset={rightInset}
              bottomInset={bottomInset}
            />
          )}

          {(snapshot.status === 'PAUSED' || snapshot.status === 'COMPLETE' || snapshot.status === 'GAME_OVER' || (inputMode === 'BODY' && camera.cameraStatus === 'unavailable')) && (
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
                      ? 'You ran, jumped, collected stars, and helped your spider friends.'
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
                    <ResultStat label="FRIENDS HELPED" value={String(snapshot.enemiesDefeated)} />
                    <ResultStat label="BEST COMBO" value={`×${snapshot.bestCombo}`} />
                    <ResultStat label="DISTANCE" value={`${Math.floor(snapshot.distance)} m`} />
                    <ResultStat label="TIME" value={formatDuration(snapshot.elapsedSeconds)} />
                  </View>
                )}
                {camera.cameraStatus === 'unavailable' ? (
                  camera.errorCode === 'cameraFacingUnavailable' ? (
                    <AppButton title="TRY OTHER CAMERA" onPress={camera.flipCamera} />
                  ) : (
                    <AppButton title="TRY CAMERA AGAIN" onPress={camera.retryCamera} />
                  )
                ) : snapshot.status === 'COMPLETE' || snapshot.status === 'GAME_OVER' ? (
                  <AppButton title={snapshot.status === 'GAME_OVER' ? 'TRY AGAIN' : 'PLAY AGAIN'} onPress={restartSafely} />
                ) : snapshot.status === 'PAUSED' && pauseReason !== 'camera' ? (
                  <AppButton title="RESUME" onPress={resumeSafely} />
                ) : null}
                <AppButton
                  title={snapshot.status === 'COMPLETE' ? 'CONTINUE' : 'EXIT GAME'}
                  variant="secondary"
                  onPress={onExit}
                />
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
  onTouchInput,
  onMovement,
  onStart,
  onPause,
  onResume,
  onRestart,
  snapshot,
  width,
  height,
  topInset,
  bottomInset,
  leftInset,
  rightInset,
  gameFps,
  performance,
  onRenderTime,
}: {
  onExit: () => void;
  onCameraMode: () => void;
  onInput: (type: DevMotionEventType) => void;
  onTouchInput: (type: DevMotionEventType) => void;
  onMovement: (movement: HorizontalMovement | null) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  snapshot: PlatformerSnapshot;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  leftInset: number;
  rightInset: number;
  gameFps: number;
  performance: RuntimePerformanceSnapshot;
  onRenderTime: (durationMs: number) => void;
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
          <Text style={styles.manualTitle}>TOUCH MODE</Text>
          <Text style={styles.manualSubtitle}>Camera-free play{Platform.OS === 'web' ? ' · keyboard available' : ''}</Text>
        </View>
        <AppButton title="BODY MODE" variant="light" onPress={onCameraMode} style={styles.cameraModeButton} />
      </View>
      <View style={styles.manualWorld}>
        <PlatformerRenderer state={snapshot} width={width} height={height} debug={DEBUG_PLATFORMER} onRenderTime={onRenderTime} />
        {snapshot.status !== 'PLAYING' && (
          <View style={styles.manualStatus}>
            <Text style={styles.modalTitle}>{snapshot.status === 'READY' ? 'RUN, JUMP, COLLECT' : snapshot.status === 'PAUSED' ? 'GAME PAUSED' : snapshot.status === 'COMPLETE' ? 'LEVEL COMPLETE' : 'NICE TRY!'}</Text>
            <Text style={styles.modalDescription}>Move with the left joystick. Tap Jump or Swing, and hold Crouch.</Text>
          </View>
        )}
      </View>
      {DEBUG_PLATFORMER && (
        <PerformanceTestControl
          inputMode="TOUCH"
          width={width}
          height={height}
          cameraState="OFF"
          performance={performance}
          captureRateHz={null}
          poseRateHz={null}
          motionRateHz={null}
          skippedPoseFrames={null}
          thermalState={null}
          enabled={snapshot.status === 'PLAYING'}
        />
      )}
      <View style={[styles.manualFooter, styles.manualFooterCentered, { paddingBottom: Math.max(bottomInset, insets.bottom, 8) + 4 }]}>
        <View style={styles.gameActions}>
          <AppButton title={snapshot.status === 'PLAYING' ? 'PAUSE' : snapshot.status === 'PAUSED' ? 'RESUME' : snapshot.status === 'READY' ? 'START' : 'PLAY AGAIN'} onPress={snapshot.status === 'PLAYING' ? onPause : snapshot.status === 'PAUSED' ? onResume : snapshot.status === 'READY' ? onStart : onRestart} style={styles.hudButton} />
          <Text style={styles.manualFps}>GAME RAF {gameFps.toFixed(1)} Hz</Text>
        </View>
      </View>
      {snapshot.status !== 'COMPLETE' && snapshot.status !== 'GAME_OVER' && (
        <GameTouchControls
          onMovementChange={onMovement}
          onInput={onTouchInput}
          leftInset={leftInset}
          rightInset={rightInset}
          bottomInset={Math.max(bottomInset, insets.bottom)}
        />
      )}
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

function PerformanceTestControl({
  inputMode,
  width,
  height,
  cameraState,
  performance,
  captureRateHz,
  poseRateHz,
  motionRateHz,
  skippedPoseFrames,
  thermalState,
  enabled,
}: {
  inputMode: InputMode;
  width: number;
  height: number;
  cameraState: string;
  performance: RuntimePerformanceSnapshot;
  captureRateHz: number | null;
  poseRateHz: number | null;
  motionRateHz: number | null;
  skippedPoseFrames: number | null;
  thermalState: string | null;
  enabled: boolean;
}) {
  const [harness] = useState(() => new PerformanceTestHarness());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [report, setReport] = useState<ReturnType<PerformanceTestHarness['finish']>>(null);
  const latestValues = useRef({
    performance, captureRateHz, poseRateHz, motionRateHz, skippedPoseFrames, thermalState,
  });

  useEffect(() => {
    latestValues.current = { performance, captureRateHz, poseRateHz, motionRateHz, skippedPoseFrames, thermalState };
  }, [captureRateHz, motionRateHz, performance, poseRateHz, skippedPoseFrames, thermalState]);

  useEffect(() => {
    if (startedAt == null) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const current = latestValues.current;
      const sample: PerformanceTestValues = {
        gameRafRateHz: current.performance.gameRafRateHz,
        simulationRateHz: current.performance.simulationRateHz,
        renderLoopRateHz: current.performance.renderLoopRateHz,
        reactCommitRateHz: current.performance.reactCommitRateHz,
        reactRenderMs: current.performance.reactRenderAverageMs,
        captureRateHz: current.captureRateHz,
        poseRateHz: current.poseRateHz,
        motionRateHz: current.motionRateHz,
        inputLatencyMs: null,
        memoryMb: null,
        skippedPoseFrames: current.skippedPoseFrames,
      };
      harness.record(sample, current.thermalState);
      setClockNow(now);
      if (now - startedAt >= PERFORMANCE_TEST_DURATION_MS) {
        const finished = harness.finish(now);
        setReport(finished);
        setStartedAt(null);
        if (finished && __DEV__) console.info('[PerformanceTest] 5-minute run complete.', finished);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [harness, startedAt]);

  const startTest = () => {
    const now = Date.now();
    harness.start({
      device: 'N/A (device model not exposed)',
      os: Platform.OS,
      osVersion: 'N/A (OS version not exposed)',
      ram: 'N/A (memory capacity not exposed)',
      build: __DEV__ ? 'Development' : 'Production',
      screenResolution: `${Math.round(width)}×${Math.round(height)}`,
      inputMode,
      cameraState,
    }, now);
    setReport(null);
    setClockNow(now);
    setStartedAt(now);
  };

  const stopTest = () => {
    const now = Date.now();
    const finished = harness.finish(now);
    setReport(finished);
    setStartedAt(null);
    if (finished && __DEV__) console.info('[PerformanceTest] Run stopped.', finished);
  };

  const remainingSeconds = startedAt == null
    ? PERFORMANCE_TEST_DURATION_MS / 1_000
    : Math.max(0, Math.ceil((PERFORMANCE_TEST_DURATION_MS - (clockNow - startedAt)) / 1_000));
  const simulationSummary = report?.metrics.simulationRateHz;
  return (
    <View style={styles.performanceTestControl}>
      <AppButton
        title={startedAt == null ? '5 MIN PERF TEST' : `STOP · ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`}
        variant="light"
        style={styles.performanceTestButton}
        onPress={startedAt == null ? startTest : stopTest}
        disabled={startedAt == null && !enabled}
      />
      {report && (
        <Text style={styles.performanceTestSummary}>
          LAST {report.durationSeconds.toFixed(0)}s · SIM {formatMetric(simulationSummary?.average)} avg / {formatMetric(simulationSummary?.minimum)} min · RAF {formatMetric(report.metrics.gameRafRateHz?.average)} avg · POSE {formatMetric(report.metrics.poseRateHz?.average)} Hz · LATENCY {formatMetric(report.metrics.inputLatencyMs?.average)} ms · MEMORY {formatMetric(report.metrics.memoryMb?.average)} MB
        </Text>
      )}
    </View>
  );
}

function formatMetric(value: number | undefined): string {
  return value == null ? 'N/A' : value.toFixed(1);
}

function GameTouchControls({
  onMovementChange,
  onInput,
  leftInset,
  rightInset,
  bottomInset,
}: {
  onMovementChange: (movement: HorizontalMovement | null) => void;
  onInput: (type: DevMotionEventType) => void;
  leftInset: number;
  rightInset: number;
  bottomInset: number;
}) {
  return (
    <View pointerEvents="box-none" style={styles.touchControlsRoot}>
      <View
        pointerEvents="box-none"
        style={[
          styles.movementControlPosition,
          { left: Math.max(leftInset, 14) + 10, bottom: Math.max(bottomInset, 10) + 10 },
        ]}
      >
        <MovementJoystick onChange={onMovementChange} />
      </View>
      <View
        style={[
          styles.actionControlsPosition,
          { right: Math.max(rightInset, 14) + 10, bottom: Math.max(bottomInset, 10) + 12 },
        ]}
      >
        <TouchActionButton icon="↻" label="SWING" onPress={() => onInput('ARM_SWING')} />
        <TouchActionButton
          icon="↓"
          label="CROUCH"
          onPressIn={() => onInput('CROUCH_START')}
          onPressOut={() => onInput('CROUCH_END')}
        />
        <TouchActionButton
          icon="↑"
          label="JUMP"
          large
          onPress={() => onInput('JUMP')}
        />
      </View>
    </View>
  );
}

function MovementJoystick({
  onChange,
}: {
  onChange: (movement: HorizontalMovement | null) => void;
}) {
  const [thumbPosition, setThumbPosition] = useState({ x: 0, y: 0 });
  const updateFromPoint = useCallback((x: number, y: number) => {
    const maxTravel = 42;
    const offsetX = x - 70;
    const offsetY = y - 70;
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    const scale = distance > maxTravel ? maxTravel / distance : 1;
    const thumbX = offsetX * scale;
    const thumbY = offsetY * scale;
    const normalizedX = thumbX / maxTravel;
    const centered = Math.abs(normalizedX) < 0.12;

    setThumbPosition({ x: thumbX, y: thumbY });
    onChange({
      direction: centered ? 0 : normalizedX < 0 ? -1 : 1,
      intensity: centered ? 0 : Math.abs(normalizedX),
    });
  }, [onChange]);
  const returnToCenter = useCallback(() => {
    setThumbPosition({ x: 0, y: 0 });
    onChange(null);
  }, [onChange]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      updateFromPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
    },
    onPanResponderMove: (event) => {
      updateFromPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
    },
    onPanResponderRelease: returnToCenter,
    onPanResponderTerminate: returnToCenter,
    onPanResponderTerminationRequest: () => false,
  }), [returnToCenter, updateFromPoint]);

  useEffect(() => () => onChange(null), [onChange]);

  return (
    <View
      {...panResponder.panHandlers}
      style={styles.joystickBase}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Movement joystick. Slide left or right to move."
    >
      <View pointerEvents="none" style={styles.joystickTrack} />
      <View
        pointerEvents="none"
        style={[
          styles.joystickThumb,
          { transform: [{ translateX: thumbPosition.x }, { translateY: thumbPosition.y }] },
        ]}
      >
        <Text style={styles.joystickThumbIcon}>↔</Text>
      </View>
    </View>
  );
}

function TouchActionButton({
  icon,
  label,
  large = false,
  onPress,
  onPressIn,
  onPressOut,
}: {
  icon: string;
  label: string;
  large?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.touchActionButton,
        large && styles.touchActionButtonLarge,
        pressed && styles.touchActionButtonPressed,
      ]}
    >
      <Text style={[styles.touchActionIcon, large && styles.touchActionIconLarge]}>{icon}</Text>
      <Text style={styles.touchActionLabel}>{label}</Text>
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
  modeSelectRoot: { flex: 1, justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, backgroundColor: '#F4F8FC' },
  modeSelectHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  modeSelectEyebrow: { color: colors.primaryDark, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  modeSelectTitle: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
  modeSelectOptions: { flexDirection: 'row', gap: spacing.md },
  modeChoice: { flex: 1, minHeight: 164, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, borderWidth: 2, borderColor: '#D5E1EC', backgroundColor: colors.white },
  modeChoicePressed: { borderColor: colors.primary, backgroundColor: '#ECF6FF', transform: [{ scale: 0.98 }] },
  modeChoiceIcon: { color: colors.primaryDark, fontSize: 34, lineHeight: 42, fontWeight: '900' },
  modeChoiceTitle: { color: colors.text, fontSize: 17, fontWeight: '900', letterSpacing: 0.7 },
  modeChoiceDetail: { maxWidth: 190, color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  modeSelectFootnote: { alignSelf: 'center', maxWidth: 560, color: colors.textSecondary, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  gameRoot: { flex: 1, backgroundColor: '#A9E7FF', overflow: 'hidden' },
  touchControlsRoot: { ...StyleSheet.absoluteFill, zIndex: 2 },
  movementControlPosition: { position: 'absolute' },
  actionControlsPosition: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  joystickBase: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', borderRadius: 70, borderWidth: 2, borderColor: 'rgba(255,255,255,0.76)', backgroundColor: 'rgba(13,30,48,0.38)' },
  joystickTrack: { position: 'absolute', width: 88, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  joystickThumb: { position: 'absolute', width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 27, borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)', backgroundColor: 'rgba(45,82,115,0.92)' },
  joystickThumbIcon: { color: colors.white, fontSize: 25, lineHeight: 28, fontWeight: '900' },
  touchActionButton: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 35, borderWidth: 2, borderColor: 'rgba(255,255,255,0.82)', backgroundColor: 'rgba(13,30,48,0.72)' },
  touchActionButtonLarge: { width: 86, height: 86, borderRadius: 43, backgroundColor: 'rgba(76,83,237,0.82)' },
  touchActionButtonPressed: { opacity: 0.78, transform: [{ scale: 0.94 }] },
  touchActionIcon: { color: colors.white, fontSize: 22, lineHeight: 25, fontWeight: '900' },
  touchActionIconLarge: { fontSize: 28, lineHeight: 31 },
  touchActionLabel: { marginTop: 1, color: colors.white, fontSize: 9, lineHeight: 11, fontWeight: '900', letterSpacing: 0.35 },
  setupShade: { ...StyleSheet.absoluteFill, justifyContent: 'center', backgroundColor: 'rgba(8, 20, 34, 0.08)' },
  setupShadeLandscape: { backgroundColor: 'transparent' },
  setupShadePortrait: { backgroundColor: 'transparent' },
  calibrationShade: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(8,20,34,0.35)' },
  calibrationCard: { width: '100%', maxWidth: 420, alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.97)' },
  calibrationTitle: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '900', textAlign: 'center' },
  calibrationDescription: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  calibrationCountdown: { color: colors.primaryDark, fontSize: 54, lineHeight: 62, fontWeight: '900', fontVariant: ['tabular-nums'] },
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
  touchControlHint: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
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
  inputModeBadge: { color: '#FFF3B4', fontSize: 10, fontWeight: '900', letterSpacing: 0.35 },
  performanceTestControl: { position: 'absolute', top: 54, left: 10, zIndex: 6, maxWidth: '68%', padding: 5, borderRadius: radius.sm, backgroundColor: 'rgba(18,42,58,0.9)' },
  performanceTestButton: { minWidth: 108, minHeight: 36, paddingHorizontal: spacing.xs },
  performanceTestSummary: { marginTop: 3, color: '#E6FFF1', fontSize: 8, lineHeight: 11, fontVariant: ['tabular-nums'] },
  hudButton: { minWidth: 82, minHeight: 48, paddingHorizontal: spacing.sm },
  debugButton: { minWidth: 72, minHeight: 48, paddingHorizontal: spacing.xs },
  gameHint: { position: 'absolute', top: 62, alignSelf: 'center', zIndex: 2, minWidth: 190, alignItems: 'center', gap: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(28,54,80,0.9)' },
  missionHud: { position: 'absolute', zIndex: 2, width: 205, gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.92)', backgroundColor: 'rgba(20,43,63,0.88)' },
  missionHudEyebrow: { color: '#FFE46B', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  missionHudTitle: { color: colors.white, fontSize: 13, lineHeight: 16, fontWeight: '900' },
  missionHudDescription: { color: '#F1F7FC', fontSize: 11, lineHeight: 14, fontWeight: '700' },
  missionProgressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 1 },
  missionProgressTrack: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  missionProgressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: '#FFE46B' },
  missionProgressText: { color: colors.white, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
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
  manualFooterCentered: { left: '38%', right: '38%', alignItems: 'center', paddingHorizontal: spacing.xs, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  manualFps: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
});
