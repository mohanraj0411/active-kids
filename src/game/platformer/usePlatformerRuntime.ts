import { useCallback, useEffect, useState } from 'react';

import type { MotionEvent } from '../../motion/controllerTypes';
import { GameController } from './GameController';
import { GameInputController } from './GameInputController';
import { PLATFORMER_CONFIG } from './config';
import type { DevMotionEventType, PlatformerSnapshot } from './types';

const RENDER_INTERVAL_MS = 16;

/** Owns the local platformer's game loop and input adapters. */
export function usePlatformerRuntime(viewportWidth: number, stageHeight: number) {
  const [game] = useState(() => new GameController({ viewportWidth, stageHeight }));
  const [input] = useState(() => new GameInputController(game));
  const [snapshot, setSnapshot] = useState<PlatformerSnapshot>(() => game.getState());
  const [measuredGameFps, setMeasuredGameFps] = useState(0);

  useEffect(() => {
    if (snapshot.status !== 'PLAYING') {
      return;
    }
    let frameId = 0;
    let previousFrameAt: number | null = null;
    let lastRenderAt = 0;
    let fpsWindowStartedAt: number | null = null;
    let fpsFrameCount = 0;

    const frame = (timestamp: number) => {
      fpsWindowStartedAt ??= timestamp;
      fpsFrameCount += 1;
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

      const fpsWindowDuration = timestamp - fpsWindowStartedAt;
      if (fpsWindowDuration >= 1_000) {
        setMeasuredGameFps(Math.round((fpsFrameCount * 1_000) / fpsWindowDuration));
        fpsWindowStartedAt = timestamp;
        fpsFrameCount = 0;
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
    handleDeveloperInput,
    start,
    pause,
    resume,
    restart,
    gameFps: snapshot.status === 'PLAYING' ? measuredGameFps : 0,
  };
}
