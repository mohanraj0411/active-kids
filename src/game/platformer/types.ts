import type { MotionEvent, MotionEventType } from '../../motion/controllerTypes';
import type { GameplayChallenge } from '../adaptive/ChallengeManager';
import type { DifficultyLevel } from '../adaptive/DifficultyManager';
import type { Mission } from '../adaptive/MissionManager';
import type { PerformanceMetrics } from '../adaptive/PerformanceTracker';
import type {
  CompanionSnapshot,
  SurpriseEvent,
  WorldReaction,
} from '../adaptive/WorldReactionManager';

export type PlatformerStatus = 'READY' | 'PLAYING' | 'PAUSED' | 'COMPLETE' | 'GAME_OVER';

export type PlayerState =
  | 'IDLE'
  | 'RUNNING'
  | 'JUMPING'
  | 'FALLING'
  | 'CROUCHING'
  | 'ATTACKING'
  | 'HIT'
  | 'CELEBRATING';

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
  kind?: 'STAR' | 'FRUIT';
  collected: boolean;
  missed?: boolean;
  bonus?: boolean;
}

export type EnemyState = 'IDLE' | 'MOVE' | 'HIT' | 'DEFEATED';

export interface EnemyObject {
  type: 'ENEMY';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defeated: boolean;
  state?: EnemyState;
  homeX?: number;
  patrolRange?: number;
  patrolSpeed?: number;
  basePatrolSpeed?: number;
  patrolDirection?: -1 | 1;
  idleRemaining?: number;
  hitAt?: number;
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
  checkpoints?: number[];
  crouchGates?: { x: number; width: number }[];
  objects: PlatformerLevelObject[];
}

export type PlatformerFeedbackType =
  | 'COLLECTIBLE'
  | 'ENEMY_HIT'
  | 'LANDING'
  | 'FINISH'
  | 'RESPAWN'
  | 'COMBO'
  | 'GATE'
  | 'MISSION';

export interface PlatformerFeedback {
  id: number;
  type: PlatformerFeedbackType;
  x: number;
  y: number;
  label: string;
  time: number;
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
  attackProgress: number;
  animationTime: number;
}

export interface PlatformerSnapshot {
  status: PlatformerStatus;
  score: number;
  collectibles: number;
  stars: number;
  hearts: number;
  combo: number;
  bestCombo: number;
  enemiesDefeated: number;
  respawning: boolean;
  difficulty: DifficultyLevel;
  performance: PerformanceMetrics;
  mission: Mission | null;
  missionToast: { id: number; title: string; time: number } | null;
  missionBonusStars: number;
  missionBonusStarsAvailable: number;
  challenge: GameplayChallenge | null;
  worldReaction: WorldReaction | null;
  companion: CompanionSnapshot;
  surprise: SurpriseEvent | null;
  elapsedSeconds: number;
  distance: number;
  cameraOffset: number;
  latestMotionEvent: MotionEvent | null;
  feedback: PlatformerFeedback | null;
  player: PlayerSnapshot;
  /** Stable level definitions; never mutated during a run. */
  level: PlatformerLevel;
  /** Mutable gameplay entities, reused by reference between render snapshots. */
  objects: PlatformerLevelObject[];
}

export type DevMotionEventType = Extract<
  MotionEventType,
  'RUN_START' | 'RUN_STOP' | 'JUMP' | 'ARM_SWING' | 'CROUCH_START' | 'CROUCH_END'
>;
