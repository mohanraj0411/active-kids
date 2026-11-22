import { useCallback, useEffect, useState } from 'react';

import type { HorizontalMovement, MotionEvent } from '../../motion/controllerTypes';
import { GameController } from './GameController';
import { GameInputController } from './GameInputController';
import { PLATFORMER_CONFIG } from './config';
import { RuntimePerformanceMeter, type RuntimePerformanceSnapshot } from './RuntimePerformanceMeter';
import type { DevMotionEventType, PlatformerSnapshot } from './types';
import type { GameInputSource } from './inputActions';

const RENDER_INTERVAL_MS = 16;
const SIMULATION_STEP_SECONDS = 1 / 60;
const EMPTY_METRICS: RuntimePerformanceSnapshot = {
  gameRafRateHz: 0,
  simulationRateHz: 0,
  simulationAverageMs: 0,
  simulationMaximumMs: 0,
  renderLoopRateHz: 0,
  reactCommitRateHz: 0,
  reactRenderAverageMs: 0,
  reactRenderMaximumMs: 0,
};

/** Owns the local platformer's game loop and input adapters. */
export function usePlatformerRuntime(viewportWidth: number, stageHeight: number) {
  const [game] = useState(() => new GameController({ viewportWidth, stageHeight }));
  const [input] = useState(() => new GameInputController(game));
  const [snapshot, setSnapshot] = useState<PlatformerSnapshot>(() => game.getState());
  const [performance, setPerformance] = useState<RuntimePerformanceSnapshot>(EMPTY_METRICS);
  const [meter] = useState(() => new RuntimePerformanceMeter());

  useEffect(() => {
    if (snapshot.status !== 'PLAYING') {
      return;
    }
    let frameId = 0;
    let previousFrameAt: number | null = null;
    let lastRenderAt = 0;
    let accumulator = 0;
    let lastMetricsAt = 0;

    const frame = (timestamp: number) => {
      meter.recordRaf(timestamp);
      if (previousFrameAt !== null) {
        const rawDeltaSeconds = (timestamp - previousFrameAt) / 1_000;
        accumulator += Math.min(
          (timestamp - previousFrameAt) / 1_000,
          PLATFORMER_CONFIG.maxDeltaSeconds,
        );
        const maximumSteps = Math.ceil(PLATFORMER_CONFIG.maxDeltaSeconds / SIMULATION_STEP_SECONDS);
        let steps = 0;
        while (accumulator >= SIMULATION_STEP_SECONDS && steps < maximumSteps) {
          const startedAt = getHighResolutionNow();
          game.update(SIMULATION_STEP_SECONDS);
          meter.recordSimulation(getHighResolutionNow() - startedAt);
          accumulator -= SIMULATION_STEP_SECONDS;
          steps += 1;
        }
        if (rawDeltaSeconds > PLATFORMER_CONFIG.maxDeltaSeconds) accumulator = 0;
      }
      previousFrameAt = timestamp;

      if (timestamp - lastRenderAt >= RENDER_INTERVAL_MS || game.currentStatus !== 'PLAYING') {
        lastRenderAt = timestamp;
        meter.recordRenderLoop();
        setSnapshot(game.getState());
      }

      if (timestamp - lastMetricsAt >= 1_000) {
        lastMetricsAt = timestamp;
        setPerformance(meter.snapshot(timestamp));
      }

      if (game.currentStatus === 'PLAYING') frameId = requestAnimationFrame(frame);
      else setSnapshot(game.getState());
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [game, meter, snapshot.status]);

  const publish = useCallback(() => setSnapshot(game.getState()), [game]);
  const handleMotionEvent = useCallback((event: MotionEvent) => {
    input.handleMotionEvent(event);
    setSnapshot(game.getState());
  }, [game, input]);
  const handleHorizontalMovement = useCallback((movement: HorizontalMovement, source: GameInputSource = input.currentSource) => {
    // The RAF loop publishes snapshots independently at its render cadence.
    input.handleHorizontalMovement(movement, source);
  }, [input]);
  const handleDeveloperInput = useCallback((type: DevMotionEventType, source: GameInputSource = input.currentSource) => {
    input.handleDeveloperInput(type, source);
    setSnapshot(game.getState());
  }, [game, input]);
  const start = useCallback(() => {
    game.start();
    publish();
  }, [game, publish]);
  const pause = useCallback(() => {
    game.pause();
    publish();
  }, [game, publish]);
  const resume = useCallback(() => {
    game.resume();
    publish();
  }, [game, publish]);
  const restart = useCallback(() => {
    game.restart();
    publish();
  }, [game, publish]);

  return {
    game,
    input,
    snapshot,
    publish,
    handleMotionEvent,
    handleHorizontalMovement,
    handleDeveloperInput,
    start,
    pause,
    resume,
    restart,
    performance: snapshot.status === 'PLAYING' ? performance : EMPTY_METRICS,
    recordReactRender: useCallback((durationMs: number) => meter.recordReactRender(durationMs), [meter]),
  };
}

function getHighResolutionNow(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}
