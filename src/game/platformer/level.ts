import { PLATFORMER_CONFIG } from './config';
import type { EnemyObject, PlatformerLevel } from './types';

/** One fixed POC course; its dimensions scale with the available screen width. */
export function createPlatformerLevel(
  viewportWidth: number,
  stageHeight: number,
): PlatformerLevel {
  const scale = Math.max(0.65, viewportWidth / PLATFORMER_CONFIG.referenceWidth);
  // Stretch the course to a relaxed two-minute pace without making any single
  // jump larger or squeezing the time to react to an obstacle.
  const courseX = (viewportUnits: number) => viewportWidth * viewportUnits * 1.4;
  // Keep the playable scene and character comfortably in frame in both
  // landscape and the portrait fallback used by older native builds.
  const groundY = Math.min(stageHeight - 48 * scale, stageHeight * 0.68);
  const gapX = courseX(1.52);
  const gapWidth = viewportWidth * 0.42;
  const secondGapX = courseX(5.25);
  const secondGapWidth = viewportWidth * 0.34;
  const thirdGapX = courseX(10.15);
  const thirdGapWidth = viewportWidth * 0.36;
  const fourthGapX = courseX(15.1);
  const fourthGapWidth = viewportWidth * 0.34;
  const fifthGapX = courseX(20.75);
  const sixthGapX = courseX(25.75);
  const seventhGapX = courseX(30.75);
  const extraGapWidth = viewportWidth * 0.34;
  const finishX = courseX(36);
  const spiderX = courseX(3.55);
  const secondSpiderX = courseX(7.55);
  const thirdSpiderX = courseX(12.25);
  const fourthSpiderX = courseX(17.4);
  const fifthSpiderX = courseX(22.85);
  const sixthSpiderX = courseX(27.85);
  const seventhSpiderX = courseX(32.85);

  const checkpoints = [
    gapX - viewportWidth * 0.55,
    spiderX - viewportWidth * 0.6,
    secondGapX - viewportWidth * 0.55,
    secondSpiderX - viewportWidth * 0.6,
    thirdGapX - viewportWidth * 0.55,
    thirdSpiderX - viewportWidth * 0.6,
    fourthGapX - viewportWidth * 0.55,
    fourthSpiderX - viewportWidth * 0.6,
    fifthGapX - viewportWidth * 0.55,
    fifthSpiderX - viewportWidth * 0.6,
    sixthGapX - viewportWidth * 0.55,
    sixthSpiderX - viewportWidth * 0.6,
    seventhGapX - viewportWidth * 0.55,
    seventhSpiderX - viewportWidth * 0.6,
  ];
  const crouchGates = [{ x: courseX(4.25), width: viewportWidth * 0.62 }];
  const objects: PlatformerLevel['objects'] = [
      {
        type: 'COLLECTIBLE',
        id: 'star-start',
        x: courseX(0.82),
        y: groundY - 112 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-first-friend',
        x: courseX(5.7),
        y: groundY - 88 * scale,
        radius: 14 * scale,
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
        x: gapX + gapWidth + courseX(0.28),
        y: groundY - 105 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      createFriendlySpider('friendly-spider', spiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-finish-approach',
        x: courseX(4.8),
        y: groundY - 118 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'second-gap',
        x: secondGapX,
        width: secondGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'second-gap-step',
        x: secondGapX + secondGapWidth * 0.24,
        y: groundY - 38 * scale,
        width: secondGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-second-gap',
        x: secondGapX + secondGapWidth + courseX(0.28),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-two', secondSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-before-third-gap',
        x: thirdGapX - courseX(0.42),
        y: groundY - 115 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-trail-two',
        x: courseX(6.5),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'third-gap',
        x: thirdGapX,
        width: thirdGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'third-gap-step',
        x: thirdGapX + thirdGapWidth * 0.24,
        y: groundY - 40 * scale,
        width: thirdGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-third-gap',
        x: thirdGapX + thirdGapWidth + courseX(0.3),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-three', thirdSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-after-third-friend',
        x: courseX(18.8),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-before-third-friend',
        x: courseX(16),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-before-fourth-gap',
        x: fourthGapX - courseX(0.42),
        y: groundY - 116 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'fourth-gap',
        x: fourthGapX,
        width: fourthGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'fourth-gap-step',
        x: fourthGapX + fourthGapWidth * 0.24,
        y: groundY - 40 * scale,
        width: fourthGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-fourth-gap',
        x: fourthGapX + fourthGapWidth + courseX(0.3),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-four', fourthSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-before-fifth-gap',
        x: courseX(26.2),
        y: groundY - 88 * scale,
        radius: 14 * scale,
        value: 10,
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-finish-run',
        x: courseX(8.65),
        y: groundY - 118 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-final-stretch',
        x: courseX(19.4),
        y: groundY - 116 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'fifth-gap',
        x: fifthGapX,
        width: extraGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'fifth-gap-step',
        x: fifthGapX + extraGapWidth * 0.24,
        y: groundY - 40 * scale,
        width: extraGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-fifth-gap',
        x: fifthGapX + extraGapWidth + courseX(0.3),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-five', fifthSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-after-fifth-friend',
        x: courseX(33.6),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-before-sixth-gap',
        x: sixthGapX - courseX(0.42),
        y: groundY - 116 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'sixth-gap',
        x: sixthGapX,
        width: extraGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'sixth-gap-step',
        x: sixthGapX + extraGapWidth * 0.24,
        y: groundY - 40 * scale,
        width: extraGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-sixth-gap',
        x: sixthGapX + extraGapWidth + courseX(0.3),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-six', sixthSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-after-sixth-friend',
        x: courseX(39.8),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-before-seventh-gap',
        x: seventhGapX - courseX(0.42),
        y: groundY - 116 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'GAP',
        id: 'seventh-gap',
        x: seventhGapX,
        width: extraGapWidth,
      },
      {
        type: 'PLATFORM',
        id: 'seventh-gap-step',
        x: seventhGapX + extraGapWidth * 0.24,
        y: groundY - 40 * scale,
        width: extraGapWidth * 0.48,
        height: 14 * scale,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-after-seventh-gap',
        x: seventhGapX + extraGapWidth + courseX(0.3),
        y: groundY - 108 * scale,
        radius: 15 * scale,
        value: 10,
        collected: false,
      },
      createFriendlySpider('friendly-spider-seven', seventhSpiderX, groundY, scale),
      {
        type: 'COLLECTIBLE',
        id: 'star-trail-final',
        x: courseX(46.8),
        y: groundY - 90 * scale,
        radius: 14 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      {
        type: 'COLLECTIBLE',
        id: 'star-by-the-finish',
        x: courseX(34.6),
        y: groundY - 116 * scale,
        radius: 15 * scale,
        value: 10,
        kind: 'STAR',
        collected: false,
      },
      { type: 'FINISH', id: 'finish-flag', x: finishX },
  ];

  return {
    worldWidth: finishX + viewportWidth * 0.5,
    groundY,
    startX: 42 * scale,
    checkpoints,
    crouchGates,
    objects: objects.sort((first, second) => first.x - second.x),
  };
}

function createFriendlySpider(id: string, x: number, groundY: number, scale: number): EnemyObject {
  return {
    type: 'ENEMY',
    id,
    x,
    y: groundY - 39 * scale,
    width: 44 * scale,
    height: 39 * scale,
    defeated: false,
    state: 'MOVE',
    homeX: x,
    patrolRange: 16 * scale,
    patrolSpeed: 18 * scale,
    basePatrolSpeed: 18 * scale,
    patrolDirection: 1,
  };
}
