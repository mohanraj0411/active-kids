import { PLATFORMER_CONFIG } from './config';
import type { PlatformerLevel } from './types';

/** One fixed POC course; its dimensions scale with the available screen width. */
export function createPlatformerLevel(
  viewportWidth: number,
  stageHeight: number,
): PlatformerLevel {
  const scale = Math.max(0.65, viewportWidth / PLATFORMER_CONFIG.referenceWidth);
  const groundY = stageHeight - 48 * scale;
  const gapX = viewportWidth * 1.52;
  const gapWidth = viewportWidth * 0.42;
  const finishX = viewportWidth * 6.45;

  return {
    worldWidth: finishX + viewportWidth * 0.5,
    groundY,
    startX: 42 * scale,
    objects: [
      {
        type: 'COLLECTIBLE',
        id: 'star-start',
        x: viewportWidth * 0.82,
        y: groundY - 112 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      {
        type: 'GAP',
        id: 'first-gap',
        x: gapX,
        width: gapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'gap-step',
        x: gapX + gapWidth * 0.24,
        y: groundY - 42 * scale,
        width: gapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-gap',
        x: gapX + gapWidth + viewportWidth * 0.28,
        y: groundY - 105 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      {
        type: 'ENEMY',
        id: 'friendly-spider',
        x: viewportWidth * 3.55,
        y: groundY - 39 * scale,
        width: 44 * scale,
        height: 39 * scale,
        defeated: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-finish-approach',
        x: viewportWidth * 4.8,
        y: groundY - 118 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      { type: 'FINISH', id: 'finish-flag', x: finishX },
    ],
  };
}
