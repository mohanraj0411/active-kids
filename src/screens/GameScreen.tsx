import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import {
  CameraScreen,
  useCameraGameSession,
  type CameraGameOverlayInfo,
} from './CameraScreen';
import { GAME_CONFIG, TARGET_CONFIG } from '../game/config';
import { GameEngine } from '../game/GameEngine';
import type { GameState, GameStatus } from '../game/types';
import type { GestureEvent } from '../motion/types';
import { colors, radius, spacing } from '../theme';
import { PlatformerScreen } from './PlatformerScreen';

const DEBUG_GAME = __DEV__;

type PauseReason = 'user' | 'camera' | 'app' | null;

type GameScreenProps = {
  onHome: () => void;
};

export function GameScreen({ onHome }: GameScreenProps) {
  const [mode, setMode] = useState<'motion-target' | 'platformer' | null>(null);

  if (mode === 'motion-target') return <MotionTargetGameScreen onHome={onHome} />;
  if (mode === 'platformer') return <PlatformerScreen onHome={onHome} />;

  return (
    <SafeAreaView style={styles.modeRoot}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.modeCard}>
        <Text style={styles.modeEyebrow}>ACTIVE KIDS</Text>
        <Text style={styles.modeTitle}>Choose a game</Text>
        <Text style={styles.modeDescription}>
          Motion Target keeps the original gesture game. Platformer Prototype connects movement to an original 2D runner.
        </Text>
        <AppButton
          title="MOTION TARGET"
          accessibilityLabel="Play Motion Target"
          onPress={() => setMode('motion-target')}
        />
        <AppButton
          title="PLATFORMER PROTOTYPE"
          accessibilityLabel="Play the platformer prototype"
          variant="secondary"
          onPress={() => setMode('platformer')}
        />
        <AppButton title="HOME" variant="light" onPress={onHome} />
      </View>
    </SafeAreaView>
  );
}

function MotionTargetGameScreen({ onHome }: GameScreenProps) {
  const [gameEngine] = useState(() => new GameEngine());
  const [gameState, setGameState] = useState<GameState>(() => gameEngine.getState());
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const mountedRef = useRef(true);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const publishState = useCallback((force = false) => {
    const nextState = gameEngine.getState();
    if (!mountedRef.current) return;
    setGameState((current) =>
      force || getVisibleStateKey(current) !== getVisibleStateKey(nextState)
        ? nextState
        : current,
    );
  }, [gameEngine]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      gameEngine.stop();
    };
  }, [gameEngine]);

  const handleSessionReady = useCallback(() => {
    const engine = gameEngine;

    const status = engine.getState().status;
    if (status === 'IDLE') {
      setPauseReason(null);
      engine.start();
    } else if (
      status === 'PAUSED' &&
      pauseReason === 'camera' &&
      AppState.currentState === 'active'
    ) {
      setPauseReason(null);
      engine.resume();
    }
    publishState(true);
  }, [gameEngine, pauseReason, publishState]);

  const handleSessionSuspended = useCallback(() => {
    const engine = gameEngine;
    const status = engine.getState().status;
    if (isActiveGameStatus(status)) {
      setPauseReason('camera');
      engine.pause();
      publishState(true);
    }
  }, [gameEngine, publishState]);

  const handleSessionError = useCallback(() => {
    const engine = gameEngine;
    const status = engine.getState().status;
    if (isActiveGameStatus(status)) {
      setPauseReason('camera');
      engine.pause();
      publishState(true);
    }
  }, [gameEngine, publishState]);

  const handleGestureEvent = useCallback(
    (event: GestureEvent) => {
      gameEngine.handleGesture(event);
      publishState(true);
    },
    [gameEngine, publishState],
  );

  const pauseGame = useCallback(() => {
    const engine = gameEngine;
    if (!isActiveGameStatus(engine.getState().status)) return;
    setPauseReason('user');
    engine.pause();
    publishState(true);
  }, [gameEngine, publishState]);

  const resumeGame = useCallback(() => {
    const engine = gameEngine;
    if (engine.getState().status !== 'PAUSED') return;
    setPauseReason(null);
    engine.resume();
    publishState(true);
  }, [gameEngine, publishState]);

  const retryGame = useCallback(() => {
    const engine = gameEngine;
    if (engine.getState().status !== 'GAME_OVER') return;
    setPauseReason(null);
    engine.stop();
    publishState(true);
  }, [gameEngine, publishState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const engine = gameEngine;

      if (nextState !== 'active') {
        if (isActiveGameStatus(engine.getState().status)) {
          setPauseReason('app');
          engine.pause();
          publishState(true);
        }
        return;
      }

      if (pauseReason === 'app') {
        setPauseReason(null);
        engine.resume();
        publishState(true);
      }
    });

    return () => subscription.remove();
  }, [gameEngine, pauseReason, publishState]);

  useEffect(() => {
    if (!isTimedGameStatus(gameState.status)) return;

    let frameId = 0;
    let lastFrameAt: number | null = null;
    const engine = gameEngine;

    const frame = (timestamp: number) => {
      if (lastFrameAt !== null) {
        engine.tick(timestamp - lastFrameAt);
      }
      lastFrameAt = timestamp;
      publishState();

      if (isTimedGameStatus(engine.getState().status)) {
        frameId = requestAnimationFrame(frame);
      }
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [gameEngine, gameState.status, publishState]);

  if (gameState.status === 'GAME_OVER') {
    return (
      <GameResultScreen
        gameState={gameState}
        onPlayAgain={retryGame}
        onHome={onHome}
      />
    );
  }

  return (
    <CameraScreen
      gameMode
      onExit={onHome}
      onGestureEvent={handleGestureEvent}
      onSessionReady={handleSessionReady}
      onSessionSuspended={handleSessionSuspended}
      onSessionError={handleSessionError}
    >
      <GameCameraOverlay
        gameState={gameState}
        pauseReason={pauseReason}
        onPause={pauseGame}
        onResume={resumeGame}
        onExit={onHome}
        width={window.width}
        topInset={insets.top}
        bottomInset={insets.bottom}
      />
    </CameraScreen>
  );
}

function GameCameraOverlay({
  gameState,
  pauseReason,
  onPause,
  onResume,
  onExit,
  width,
  topInset,
  bottomInset,
}: {
  gameState: GameState;
  pauseReason: PauseReason;
  onPause: () => void;
  onResume: () => void;
  onExit: () => void;
  width: number;
  topInset: number;
  bottomInset: number;
}) {
  const camera = useCameraGameSession();
  const target = gameState.currentTarget
    ? TARGET_CONFIG.actions[gameState.currentTarget]
    : null;
  const countdownLabel = getCountdownLabel(gameState.countdownRemainingMs);
  const secondsRemaining = Math.max(0, Math.ceil(gameState.timeRemainingMs / 1_000));
  const displayedRound = gameState.currentRound || 1;
  const cameraUnavailable = camera.cameraStatus === 'unavailable';
  const cameraStarting = camera.cameraStatus === 'starting';
  return (
    <View pointerEvents="box-none" style={styles.gameOverlay}>
      <View
        pointerEvents="box-none"
        style={[styles.gameHeader, { paddingTop: Math.max(topInset, spacing.sm) + spacing.sm }]}
      >
        <View style={styles.statsRow}>
          <StatChip label="ROUND" value={`${displayedRound}/${gameState.totalRounds}`} />
          <StatChip label="SCORE" value={String(gameState.score)} />
          <StatChip label="COMBO" value={`${gameState.consecutiveSuccesses}x`} />
          <AppButton
            title="PAUSE"
            accessibilityLabel="Pause game"
            onPress={onPause}
            disabled={!isActiveGameStatus(gameState.status)}
            variant="light"
            style={styles.pauseButton}
          />
        </View>
      </View>

      <View pointerEvents="box-none" style={styles.centerStage}>
        {cameraUnavailable ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Camera unavailable</Text>
            <Text style={styles.noticeText}>
              {camera.errorMessage ?? 'The camera could not start. Try again.'}
            </Text>
            <AppButton
              title="TRY AGAIN"
              accessibilityLabel="Retry camera"
              onPress={camera.retryCamera}
            />
            <AppButton
              title="EXIT GAME"
              accessibilityLabel="Exit game"
              variant="secondary"
              onPress={onExit}
            />
          </View>
        ) : cameraStarting && gameState.status === 'PAUSED' && pauseReason === 'camera' ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Reconnecting camera</Text>
            <Text style={styles.noticeText}>Your game timer is paused.</Text>
            <AppButton
              title="EXIT GAME"
              accessibilityLabel="Exit game"
              variant="secondary"
              onPress={onExit}
            />
          </View>
        ) : gameState.status === 'PAUSED' ? (
          <View style={styles.pauseCard}>
            <Text style={styles.pauseTitle}>
              GAME PAUSED
            </Text>
            <Text style={styles.pauseText}>Take a break. Your round is waiting.</Text>
            {pauseReason !== 'app' && (
              <AppButton
                title="RESUME"
                accessibilityLabel="Resume game"
                onPress={onResume}
              />
            )}
            <AppButton
              title="EXIT GAME"
              accessibilityLabel="Exit game"
              variant="secondary"
              onPress={onExit}
            />
          </View>
        ) : gameState.status === 'COUNTDOWN' ? (
          <View style={styles.countdownCard}>
            <Text style={styles.countdownEyebrow}>GET READY</Text>
            <Text style={[styles.countdownNumber, { fontSize: countdownLabel === 'GO!' ? 62 : Math.min(88, width * 0.22) }]}>
              {countdownLabel}
            </Text>
          </View>
        ) : cameraStarting || gameState.status === 'IDLE' ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Getting ready</Text>
            <Text style={styles.noticeText}>
              Starting the camera and preparing pose detection...
            </Text>
          </View>
        ) : target ? (
          <View style={styles.targetCard}>
            {gameState.status === 'SUCCESS' ? (
              <>
                <Text style={styles.feedbackIcon}>✓</Text>
                <Text style={styles.feedbackTitle}>GREAT!</Text>
                <Text style={styles.pointsText}>+{gameState.lastAwardedPoints}</Text>
              </>
            ) : gameState.status === 'MISSED' ? (
              <>
                <Text style={styles.feedbackTitle}>TIME&apos;S UP</Text>
                <Text style={styles.targetInstruction}>Next target coming up</Text>
              </>
            ) : (
              <>
                <Text style={[styles.targetIcon, { fontSize: Math.min(52, width * 0.13) }]}>
                  {target.icon}
                </Text>
                <Text style={styles.targetTitle}>{target.title}</Text>
                <Text style={styles.targetInstruction}>{target.instruction}</Text>
              </>
            )}
          </View>
        ) : null}
      </View>

      <View
        pointerEvents="box-none"
        style={[styles.gameFooter, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}
      >
        {gameState.status === 'PLAYING' && (
          <View style={styles.timerBadge} accessibilityLiveRegion="polite">
            <Text style={styles.timerNumber}>{secondsRemaining}</Text>
            <Text style={styles.timerLabel}>SECONDS</Text>
          </View>
        )}

        <View style={styles.detectionRow}>
          <Text style={styles.detectionText}>
            Camera: {camera.cameraStatus === 'ready' ? 'Ready' : camera.cameraStatus === 'starting' ? 'Starting' : 'Unavailable'}
          </Text>
          <Text style={styles.detectionText}>
            Pose: {getDetectorLabel(camera)}
          </Text>
          <Text style={styles.detectionText}>
            {camera.confidence === null ? '—' : `${Math.round(camera.confidence * 100)}%`}
          </Text>
        </View>
        {(camera.confidence !== null || camera.cameraStatus === 'ready') && (
          <Text
            style={[
              styles.bodyGuidance,
              camera.bodyVisibility.state === 'FULL_BODY'
                ? styles.bodyGuidanceReady
                : styles.bodyGuidanceNeedsSpace,
            ]}
            accessibilityLiveRegion="polite"
          >
            {camera.bodyVisibility.message}
          </Text>
        )}

        {DEBUG_GAME && (
          <View style={styles.debugPanel}>
            <Text style={styles.debugText}>
              GAME {gameState.status} · TARGET {gameState.currentTarget ?? '—'} · TIME {gameState.status === 'COUNTDOWN' ? countdownLabel : `${secondsRemaining}s`}
            </Text>
            <Text style={styles.debugText}>
              SCORE {gameState.score} · COMBO {gameState.consecutiveSuccesses} · LAST GESTURE {gameState.lastGestureEvent ?? '—'}
            </Text>
            <Text style={styles.debugText}>
              EVENT {camera.lastEvent?.type ?? '—'} · INPUT {camera.metrics?.observedFps.toFixed(1) ?? '—'} FPS · POSE {camera.metrics?.inferenceFps.toFixed(1) ?? '—'} FPS · CONFIDENCE {camera.confidence === null ? '—' : `${Math.round(camera.confidence * 100)}%`}
            </Text>
            <Text style={styles.debugText}>
              MOTION {camera.motionState} · EVENT {camera.lastMotionEvent?.type ?? '—'} · RUN ALT {camera.motionDiagnostics?.run.alternations ?? 0} · JUMP {camera.motionDiagnostics?.jump.phase ?? 'GROUNDED'}
            </Text>
          </View>
        )}

        <AppButton
          title="FLIP CAMERA"
          accessibilityLabel="Flip camera"
          variant="light"
          onPress={camera.flipCamera}
          disabled={cameraStarting || cameraUnavailable}
          style={styles.flipButton}
        />
      </View>
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statChip} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function GameResultScreen({
  gameState,
  onPlayAgain,
  onHome,
}: {
  gameState: GameState;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  return (
    <SafeAreaView style={styles.resultSafeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={styles.resultScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.resultCard}>
          <Text style={styles.resultEyebrow}>MOTION TARGET</Text>
          <Text style={styles.resultTitle}>GAME COMPLETE</Text>
          <Text style={styles.resultScore}>{gameState.score}</Text>
          <Text style={styles.resultScoreLabel}>POINTS</Text>

          <View style={styles.resultStats}>
            <ResultRow label="Rounds completed" value={`${gameState.completedRounds}/${gameState.totalRounds}`} />
            <ResultRow label="Successful" value={String(gameState.successfulRounds)} />
            <ResultRow label="Missed" value={String(gameState.missedRounds)} />
            <ResultRow label="Best combo" value={`${gameState.bestCombo}x`} />
            <ResultRow label="Accuracy" value={`${gameState.accuracyPercent}%`} />
          </View>

          <View style={styles.resultButtons}>
            <AppButton
              title="PLAY AGAIN"
              accessibilityLabel="Play again"
              onPress={onPlayAgain}
            />
            <AppButton
              title="HOME"
              accessibilityLabel="Go home"
              variant="secondary"
              onPress={onHome}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultRowLabel}>{label}</Text>
      <Text style={styles.resultRowValue}>{value}</Text>
    </View>
  );
}

function getCountdownLabel(remainingMs: number): string {
  if (remainingMs <= GAME_CONFIG.countdownGoDurationMs) return 'GO!';
  return String(
    Math.max(
      1,
      Math.ceil(
        (remainingMs - GAME_CONFIG.countdownGoDurationMs) / 1_000,
      ),
    ),
  );
}

function getVisibleStateKey(state: GameState): string {
  const seconds = Math.ceil(Math.max(0, state.timeRemainingMs) / 1_000);
  const countdown =
    state.status === 'COUNTDOWN'
      ? getCountdownLabel(state.countdownRemainingMs)
      : '';
  return [
    state.status,
    state.score,
    state.currentRound,
    state.totalRounds,
    state.currentTarget,
    seconds,
    countdown,
    state.consecutiveSuccesses,
    state.consecutiveMisses,
    state.successfulRounds,
    state.missedRounds,
    state.completedRounds,
    state.bestCombo,
    state.accuracyPercent,
    state.pausedFrom,
    state.lastGestureEvent,
    state.lastAwardedPoints,
  ].join('|');
}

function isTimedGameStatus(status: GameStatus): boolean {
  return (
    status === 'COUNTDOWN' ||
    status === 'PLAYING' ||
    status === 'SUCCESS' ||
    status === 'MISSED'
  );
}

function isActiveGameStatus(status: GameStatus): boolean {
  return isTimedGameStatus(status);
}

function getDetectorLabel(camera: CameraGameOverlayInfo): string {
  switch (camera.detectorState) {
    case 'detected':
      return 'Person detected';
    case 'low-confidence':
      return 'Low confidence';
    case 'looking':
      return 'Looking for person';
    case 'initializing':
      return 'Loading';
    case 'error':
      return 'Unavailable';
  }
}

const styles = StyleSheet.create({
  modeRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.background,
  },
  modeCard: {
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  modeEyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  modeTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  modeDescription: {
    marginBottom: spacing.sm,
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  gameOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  gameHeader: {
    width: '100%',
    paddingHorizontal: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  statChip: {
    minWidth: 0,
    flex: 1,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  statValue: {
    marginTop: 2,
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pauseButton: {
    minWidth: 72,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  countdownCard: {
    width: '76%',
    minHeight: 196,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,24,40,0.78)',
  },
  countdownEyebrow: {
    color: colors.secondary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  countdownNumber: {
    marginTop: spacing.sm,
    color: colors.white,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  targetCard: {
    width: '100%',
    maxWidth: 440,
    minHeight: 178,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,24,40,0.78)',
  },
  targetIcon: {
    marginBottom: spacing.xs,
  },
  targetTitle: {
    color: colors.white,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    textAlign: 'center',
  },
  targetInstruction: {
    marginTop: spacing.xs,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  feedbackIcon: {
    color: '#86EFAC',
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '900',
  },
  feedbackTitle: {
    color: colors.white,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    textAlign: 'center',
  },
  pointsText: {
    marginTop: spacing.xs,
    color: colors.secondary,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  timerBadge: {
    minWidth: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  timerNumber: {
    color: colors.secondary,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  timerLabel: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  gameFooter: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  detectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  detectionText: {
    flexShrink: 1,
    color: colors.white,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  bodyGuidance: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  bodyGuidanceReady: {
    color: '#86EFAC',
  },
  bodyGuidanceNeedsSpace: {
    color: '#FDE68A',
  },
  debugPanel: {
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  debugText: {
    color: '#D1FAE5',
    fontSize: 9,
    lineHeight: 12,
    fontVariant: ['tabular-nums'],
  },
  flipButton: {
    minHeight: 56,
    marginTop: spacing.xs,
    borderRadius: radius.md,
  },
  noticeCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,24,40,0.9)',
  },
  noticeTitle: {
    color: colors.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  noticeText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  pauseCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,24,40,0.92)',
  },
  pauseTitle: {
    color: colors.white,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  pauseText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  resultSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  resultScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  resultCard: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  resultEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  resultTitle: {
    marginTop: spacing.xs,
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    textAlign: 'center',
  },
  resultScore: {
    marginTop: spacing.md,
    color: colors.primary,
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  resultScoreLabel: {
    marginTop: -spacing.xs,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  resultStats: {
    width: '100%',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultRowLabel: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  resultRowValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  resultButtons: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
