import type { MotionEvent, MotionEventType } from '../../motion/controllerTypes';

export type PlatformerStatus = 'READY' | 'PLAYING' | 'PAUSED' | 'COMPLETE' | 'GAME_OVER';

export type PlayerState =
  | 'IDLE'
  | 'RUNNING'
  | 'JUMPING'
  | 'FALLING'
  | 'CROUCHING'
  | 'ATTACKING';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlatformObject {
  type: 'PLATFORM';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GapObject {
  type: 'GAP';
  id: string;
  x: number;
  width: number;
}

export interface CollectibleObject {
  type: 'COLLECTIBLE';
  id: string;
  x: number;
  y: number;
  radius: number;
  value: number;
  collected: boolean;
}

export interface EnemyObject {
  type: 'ENEMY';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defeated: boolean;
}

export interface FinishObject {
  type: 'FINISH';
  id: string;
  x: number;
}

export type PlatformerLevelObject =
  | PlatformObject
  | GapObject
  | CollectibleObject
  | EnemyObject
  | FinishObject;

export interface PlatformerLevel {
  worldWidth: number;
  groundY: number;
  startX: number;
  objects: PlatformerLevelObject[];
}

export interface PlayerSnapshot {
  state: PlayerState;
  x: number;
  y: number;
  width: number;
  height: number;
  velocityX: number;
  velocityY: number;
  grounded: boolean;
  running: boolean;
  crouching: boolean;
  attacking: boolean;
  attackHitActive: boolean;
  animationTime: number;
}

export interface PlatformerSnapshot {
  status: PlatformerStatus;
  score: number;
  collectibles: number;
  elapsedSeconds: number;
  distance: number;
  cameraOffset: number;
  latestMotionEvent: MotionEvent | null;
  player: PlayerSnapshot;
  level: PlatformerLevel;
}

export type DevMotionEventType = Extract<
  MotionEventType,
  'RUN_START' | 'RUN_STOP' | 'JUMP' | 'ARM_SWING' | 'CROUCH_START' | 'CROUCH_END'
>;
