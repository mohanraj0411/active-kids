import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
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
} from './CameraScreen';
import { GameController } from '../game/platformer/GameController';
import { GameInputController } from '../game/platformer/GameInputController';
import { PLATFORMER_CONFIG } from '../game/platformer/config';
import { PlatformerRenderer } from '../game/platformer/PlatformerRenderer';
import type {
  DevMotionEventType,
  PlatformerSnapshot,
} from '../game/platformer/types';
import type { MotionEvent } from '../motion/controllerTypes';
import { colors, radius, spacing } from '../theme';

const DEBUG_PLATFORMER = __DEV__;
const RENDER_INTERVAL_MS = 33;

type InputSource = 'manual' | 'camera';

type PlatformerScreenProps = { onHome: () => void };

export function PlatformerScreen({ onHome }: PlatformerScreenProps) {
  const windowSize = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const stageHeight = clamp(windowSize.height * 0.43, 240, 430);
  const viewportWidth = Math.max(240, windowSize.width);
  const [game] = useState(() => new GameController({ viewportWidth, stageHeight }));
  const [input] = useState(() => new GameInputController(game));
  const [snapshot, setSnapshot] = useState<PlatformerSnapshot>(() => game.getState());
  const cameraInterrupted = useRef(false);
  const [inputSource, setInputSource] = useState<InputSource>(
    DEBUG_PLATFORMER ? 'manual' : 'camera',
  );

  useEffect(() => {
    if (snapshot.status !== 'PLAYING') return;
    let frameId = 0;
    let previousFrameAt: number | null = null;
    let lastRenderAt = 0;

    const frame = (timestamp: number) => {
      if (previousFrameAt !== null) {
        const deltaSeconds = Math.min(
          (timestamp - previousFrameAt) / 1_000,
          PLATFORMER_CONFIG.maxDeltaSeconds,
        );
        game.update(deltaSeconds);
      }
      previousFrameAt = timestamp;

      if (timestamp - lastRenderAt >= RENDER_INTERVAL_MS || game.currentStatus !== 'PLAYING') {
        lastRenderAt = timestamp;
        setSnapshot(game.getState());
      }

      if (game.currentStatus === 'PLAYING') frameId = requestAnimationFrame(frame);
      else setSnapshot(game.getState());
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [game, snapshot.status]);

  const publish = useCallback(() => setSnapshot(game.getState()), [game]);
  const handleMotionEvent = useCallback((event: MotionEvent) => {
    input.handleMotionEvent(event);
    setSnapshot(game.getState());
  }, [game, input]);
  const handleDeveloperInput = useCallback((type: DevMotionEventType) => {
    input.handleDeveloperInput(type);
    setSnapshot(game.getState());
  }, [game, input]);
  const startGame = useCallback(() => {
    game.start();
    publish();
  }, [game, publish]);
  const pauseGame = useCallback(() => {
    game.pause();
    publish();
  }, [game, publish]);
  const resumeGame = useCallback(() => {
    game.resume();
    publish();
  }, [game, publish]);
  const restartGame = useCallback(() => {
    game.restart();
    publish();
  }, [game, publish]);
  const handleCameraInterrupted = useCallback(() => {
    if (game.currentStatus !== 'PLAYING') return;
    cameraInterrupted.current = true;
    game.pause();
    publish();
  }, [game, publish]);
  const handleCameraReady = useCallback(() => {
    if (!cameraInterrupted.current) return;
    cameraInterrupted.current = false;
    game.resume();
    publish();
  }, [game, publish]);
  const changeInputSource = useCallback((source: InputSource) => {
    if (source === inputSource) return;
    input.handleDeveloperInput('RUN_STOP');
    input.handleDeveloperInput('CROUCH_END');
    setInputSource(source);
    setSnapshot(game.getState());
  }, [game, input, inputSource]);

  useEffect(() => {
    if (!DEBUG_PLATFORMER || inputSource !== 'manual' || Platform.OS !== 'web') return;

    const pressed = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (pressed.has(key)) return;
      const action = getKeyboardDownAction(key);
      if (!action) return;
      pressed.add(key);
      event.preventDefault();
      handleDeveloperInput(action);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!pressed.delete(key)) return;
      const action = getKeyboardUpAction(key);
      if (!action) return;
      event.preventDefault();
      handleDeveloperInput(action);
    };

    globalThis.window.addEventListener('keydown', onKeyDown);
    globalThis.window.addEventListener('keyup', onKeyUp);
    return () => {
      globalThis.window.removeEventListener('keydown', onKeyDown);
      globalThis.window.removeEventListener('keyup', onKeyUp);
      if (pressed.has('a') || pressed.has('arrowright')) input.handleDeveloperInput('RUN_STOP');
      if (pressed.has('arrowdown')) input.handleDeveloperInput('CROUCH_END');
    };
  }, [handleDeveloperInput, input, inputSource]);

  if (inputSource === 'camera') {
    return (
      <CameraScreen
        gameMode
        onExit={onHome}
        onMotionEvent={handleMotionEvent}
        onSessionReady={handleCameraReady}
        onSessionSuspended={handleCameraInterrupted}
        onSessionError={handleCameraInterrupted}
      >
        <CameraPlatformerLayer
          onHome={onHome}
          onChangeInputSource={changeInputSource}
          onDeveloperInput={handleDeveloperInput}
          onStart={startGame}
          onPause={pauseGame}
          onResume={resumeGame}
          onRestart={restartGame}
          snapshot={snapshot}
          width={viewportWidth}
          height={stageHeight}
          screenHeight={windowSize.height}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
      </CameraScreen>
    );
  }

  return (
    <SafeAreaView style={styles.manualRoot}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.manualHeader, { paddingTop: spacing.sm }]}>
        <AppButton title="BACK" variant="secondary" onPress={onHome} style={styles.smallHeaderButton} />
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>PLATFORMER</Text>
          <Text style={styles.sourceLabel}>DEV INPUT · TOUCH / KEYS</Text>
        </View>
        <AppButton title="CAMERA INPUT" variant="secondary" onPress={() => changeInputSource('camera')} style={styles.sourceButton} />
      </View>

      <View style={[styles.manualStage, { height: stageHeight }]}>
        <PlatformerRenderer
          state={snapshot}
          width={viewportWidth}
          height={stageHeight}
          debug={DEBUG_PLATFORMER}
        />
        <GameStatusCard
          snapshot={snapshot}
          onRestart={restartGame}
          onStart={startGame}
        />
      </View>

      <StatsRow snapshot={snapshot} />
      {DEBUG_PLATFORMER ? (
        <DeveloperInputPad onInput={handleDeveloperInput} />
      ) : (
        <Text style={styles.playerGuidance}>Run in place to start moving.</Text>
      )}
      <ActionRow
        status={snapshot.status}
        onStart={startGame}
        onPause={pauseGame}
        onResume={resumeGame}
        onRestart={restartGame}
      />
      {DEBUG_PLATFORMER && <DebugReadout snapshot={snapshot} />}
    </SafeAreaView>
  );
}

function CameraPlatformerLayer({
  onHome,
  onChangeInputSource,
  onDeveloperInput,
  onStart,
  onPause,
  onResume,
  onRestart,
  snapshot,
  width,
  height,
  screenHeight,
  topInset,
  bottomInset,
}: {
  onHome: () => void;
  onChangeInputSource: (source: InputSource) => void;
  onDeveloperInput: (type: DevMotionEventType) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  snapshot: PlatformerSnapshot;
  width: number;
  height: number;
  screenHeight: number;
  topInset: number;
  bottomInset: number;
}) {
  const camera = useCameraGameSession();
  const stageTop = Math.min(screenHeight * 0.32, 210);
  return (
    <View pointerEvents="box-none" style={styles.cameraLayer}>
      <View pointerEvents="box-none" style={[styles.cameraHeader, { paddingTop: Math.max(topInset, spacing.sm) + spacing.xs }]}>
        <AppButton title="BACK" variant="light" onPress={onHome} style={styles.smallHeaderButton} />
        <View style={styles.headerTitles}>
          <Text style={styles.cameraTitle}>PLATFORMER</Text>
          <Text style={styles.cameraSourceLabel}>CAMERA INPUT · {getCameraLabel(camera.detectorState)}</Text>
        </View>
        {DEBUG_PLATFORMER ? (
          <AppButton title="DEV INPUT" variant="light" onPress={() => onChangeInputSource('manual')} style={styles.sourceButton} />
        ) : (
          <AppButton title="FLIP" variant="light" onPress={camera.flipCamera} style={styles.smallHeaderButton} />
        )}
      </View>

      {camera.cameraStatus === 'unavailable' && (
        <View style={[styles.cameraErrorNotice, { top: stageTop - 74 }]}>
          <Text style={styles.cameraErrorText}>{camera.errorMessage ?? 'Camera unavailable.'}</Text>
          <AppButton title="RETRY CAMERA" variant="light" onPress={camera.retryCamera} />
        </View>
      )}

      <View pointerEvents="box-none" style={[styles.cameraStage, { top: stageTop, height, width }]}>
        <PlatformerRenderer state={snapshot} width={width} height={height} debug={DEBUG_PLATFORMER} />
        <GameStatusCard snapshot={snapshot} onRestart={onRestart} onStart={onStart} />
      </View>

      <View pointerEvents="box-none" style={[styles.cameraFooter, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
        <StatsRow snapshot={snapshot} compact />
        <Text style={styles.cameraMotionText}>
          {camera.lastMotionEvent ? `LAST EVENT · ${camera.lastMotionEvent.type}` : 'RUN IN PLACE TO START'}
        </Text>
        {DEBUG_PLATFORMER && <DeveloperInputPad onInput={onDeveloperInput} compact />}
        <ActionRow
          status={snapshot.status}
          onStart={onStart}
          onPause={onPause}
          onResume={onResume}
          onRestart={onRestart}
          compact
        />
        {DEBUG_PLATFORMER && <DebugReadout snapshot={snapshot} compact />}
      </View>
    </View>
  );
}

function StatsRow({ snapshot, compact = false }: { snapshot: PlatformerSnapshot; compact?: boolean }) {
  return (
    <View style={[styles.statsRow, compact && styles.compactStatsRow]}>
      <Stat label="SCORE" value={String(snapshot.score)} />
      <Stat label="STARS" value={String(snapshot.collectibles)} />
      <Stat label="DISTANCE" value={`${Math.floor(snapshot.distance)} m`} />
      <Stat label="TIME" value={`${snapshot.elapsedSeconds.toFixed(1)} s`} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function GameStatusCard({
  snapshot,
  onRestart,
  onStart,
}: {
  snapshot: PlatformerSnapshot;
  onRestart: () => void;
  onStart: () => void;
}) {
  const [successScale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (snapshot.status !== 'COMPLETE') {
      successScale.stopAnimation();
      successScale.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(successScale, {
          toValue: 1.045,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(successScale, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [snapshot.status, successScale]);

  if (snapshot.status === 'PLAYING') return null;
  const isComplete = snapshot.status === 'COMPLETE';
  const isGameOver = snapshot.status === 'GAME_OVER';
  return (
    <View pointerEvents="box-none" style={styles.statusCardPosition}>
      <Animated.View
        style={[
          styles.statusCard,
          isComplete && { transform: [{ scale: successScale }] },
        ]}
      >
        <Text style={styles.statusEyebrow}>
          {isComplete ? 'GREAT JOB!' : isGameOver ? 'TRY AGAIN' : snapshot.status === 'PAUSED' ? 'TAKE A BREATHER' : 'READY WHEN YOU ARE'}
        </Text>
        <Text style={styles.statusTitle}>
          {isComplete ? 'LEVEL COMPLETE' : isGameOver ? 'NICE TRY!' : snapshot.status === 'PAUSED' ? 'GAME PAUSED' : 'RUN, JUMP, COLLECT'}
        </Text>
        <Text style={styles.statusDescription}>
          {isComplete
            ? `${snapshot.score} points · ${snapshot.collectibles} stars`
            : isGameOver
              ? 'Restart and give it another go.'
              : snapshot.status === 'PAUSED'
                ? 'Resume when you are ready to play.'
                : 'Hold RUN, jump the gap, and swing near the friendly spider.'}
        </Text>
        {(isComplete || isGameOver) ? (
          <AppButton title="RESTART LEVEL" onPress={onRestart} style={styles.statusButton} />
        ) : snapshot.status === 'PAUSED' ? null : (
          <AppButton title="START LEVEL" onPress={onStart} style={styles.statusButton} />
        )}
      </Animated.View>
    </View>
  );
}

function DeveloperInputPad({
  onInput,
  compact = false,
}: {
  onInput: (type: DevMotionEventType) => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.devPad, compact && styles.compactDevPad]}>
      <Text style={styles.devPadLabel}>DEV INPUT · {Platform.OS === 'web' ? 'KEYS + TOUCH' : 'TOUCH'}</Text>
      <View style={styles.devButtonRow}>
        <HoldInputButton
          title="RUN"
          onStart={() => onInput('RUN_START')}
          onEnd={() => onInput('RUN_STOP')}
          style={styles.runButton}
        />
        <PressInputButton title="JUMP" onPress={() => onInput('JUMP')} />
        <PressInputButton title="ATTACK" onPress={() => onInput('ARM_SWING')} />
        <HoldInputButton
          title="CROUCH"
          onStart={() => onInput('CROUCH_START')}
          onEnd={() => onInput('CROUCH_END')}
        />
      </View>
    </View>
  );
}

function HoldInputButton({
  title,
  onStart,
  onEnd,
  style,
}: {
  title: string;
  onStart: () => void;
  onEnd: () => void;
  style?: object;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Developer ${title.toLowerCase()} input`}
      onPressIn={onStart}
      onPressOut={onEnd}
      style={({ pressed }) => [styles.devButton, style, pressed && styles.devButtonPressed]}
    >
      <Text style={styles.devButtonText}>{title}</Text>
    </Pressable>
  );
}

function PressInputButton({ title, onPress }: { title: string; onPress: () => void }) {
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

function ActionRow({
  status,
  onStart,
  onPause,
  onResume,
  onRestart,
  compact = false,
}: {
  status: PlatformerSnapshot['status'];
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.actionRow, compact && styles.compactActionRow]}>
      {status === 'READY' ? (
        <AppButton title="START" onPress={onStart} style={styles.actionButton} />
      ) : status === 'PLAYING' ? (
        <AppButton title="PAUSE" variant="secondary" onPress={onPause} style={styles.actionButton} />
      ) : status === 'PAUSED' ? (
        <AppButton title="RESUME" onPress={onResume} style={styles.actionButton} />
      ) : (
        <AppButton title="PLAY AGAIN" onPress={onRestart} style={styles.actionButton} />
      )}
      <AppButton title="RESTART" variant="secondary" onPress={onRestart} style={styles.actionButton} />
    </View>
  );
}

function DebugReadout({ snapshot, compact = false }: { snapshot: PlatformerSnapshot; compact?: boolean }) {
  return (
    <View style={[styles.debugReadout, compact && styles.compactDebugReadout]}>
      <Text style={styles.debugText}>
        ACTIVE KIDS DEBUG · {snapshot.status} · PLAYER {snapshot.player.state} · EVENT {snapshot.latestMotionEvent?.type ?? '—'}
      </Text>
      <Text style={styles.debugText}>
        X {snapshot.player.x.toFixed(0)} · Y {snapshot.player.y.toFixed(0)} · VX {snapshot.player.velocityX.toFixed(0)} · VY {snapshot.player.velocityY.toFixed(0)} · GROUNDED {snapshot.player.grounded ? 'YES' : 'NO'} · ATTACK {snapshot.player.attackHitActive ? 'HIT' : snapshot.player.attacking ? 'WINDUP/RECOVERY' : 'READY'}
      </Text>
    </View>
  );
}

function getKeyboardDownAction(key: string): DevMotionEventType | null {
  if (key === 'a' || key === 'arrowright') return 'RUN_START';
  if (key === ' ' || key === 'spacebar') return 'JUMP';
  if (key === 'f') return 'ARM_SWING';
  if (key === 'arrowdown') return 'CROUCH_START';
  return null;
}

function getKeyboardUpAction(key: string): DevMotionEventType | null {
  if (key === 'a' || key === 'arrowright') return 'RUN_STOP';
  if (key === 'arrowdown') return 'CROUCH_END';
  return null;
}

function getCameraLabel(state: ReturnType<typeof useCameraGameSession>['detectorState']): string {
  switch (state) {
    case 'detected': return 'POSE READY';
    case 'low-confidence': return 'LOW CONFIDENCE';
    case 'looking': return 'LOOKING';
    case 'initializing': return 'LOADING';
    case 'error': return 'UNAVAILABLE';
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const styles = StyleSheet.create({
  manualRoot: {
    flex: 1,
    backgroundColor: '#F2F8F7',
    gap: spacing.sm,
  },
  manualHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerTitles: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  sourceLabel: {
    marginTop: 2,
    color: colors.primary,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  cameraTitle: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  cameraSourceLabel: {
    marginTop: 2,
    color: '#D8F3E8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.35,
  },
  smallHeaderButton: {
    minWidth: 72,
    minHeight: 42,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  sourceButton: {
    minWidth: 92,
    minHeight: 42,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  manualStage: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: '#A9E7FF',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  compactStatsRow: {
    paddingHorizontal: 0,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  statValue: {
    marginTop: 2,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  playerGuidance: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  devPad: {
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  compactDevPad: {
    paddingHorizontal: 0,
    gap: 2,
  },
  devPadLabel: {
    color: colors.primaryDark,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.65,
    textAlign: 'center',
  },
  devButtonRow: {
    flexDirection: 'row',
    gap: 5,
  },
  devButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 45,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#C9D4F5',
    backgroundColor: '#FFFFFF',
  },
  runButton: {
    backgroundColor: '#E7F7EF',
    borderColor: '#8CD3AA',
  },
  devButtonPressed: {
    backgroundColor: '#DCE3FF',
    transform: [{ scale: 0.97 }],
  },
  devButtonText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.25,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  compactActionRow: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
  },
  debugReadout: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: '#172A3A',
  },
  compactDebugReadout: {
    paddingHorizontal: spacing.xs,
  },
  debugText: {
    color: '#D5F6E5',
    fontSize: 8,
    lineHeight: 12,
    fontVariant: ['tabular-nums'],
  },
  cameraLayer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  cameraHeader: {
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  cameraStage: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
    backgroundColor: '#A9E7FF',
  },
  cameraFooter: {
    zIndex: 2,
    gap: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(15,24,35,0.7)',
  },
  cameraMotionText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  cameraErrorNotice: {
    position: 'absolute',
    zIndex: 3,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(30,25,40,0.86)',
  },
  cameraErrorText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusCardPosition: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  statusCard: {
    width: '88%',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.91)',
  },
  statusEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statusTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  statusDescription: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusButton: {
    minHeight: 42,
    minWidth: 150,
    marginTop: spacing.sm,
  },
});
