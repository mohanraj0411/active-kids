import type { GestureEventType, GestureType } from '../motion/types';

export type GameAction = GestureType;

export type GameStatus =
  | 'IDLE'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'SUCCESS'
  | 'MISSED'
  | 'PAUSED'
  | 'GAME_OVER';

export type TimedGameStatus = 'COUNTDOWN' | 'PLAYING' | 'SUCCESS' | 'MISSED';

export interface GameState {
  status: GameStatus;
  score: number;
  /** One-based while a round is active. Zero before the first target. */
  currentRound: number;
  totalRounds: number;
  currentTarget: GameAction | null;
  timeRemainingMs: number;
  countdownRemainingMs: number;
  feedbackRemainingMs: number;
  consecutiveSuccesses: number;
  consecutiveMisses: number;
  successfulRounds: number;
  missedRounds: number;
  completedRounds: number;
  bestCombo: number;
  accuracyPercent: number;
  pausedFrom: TimedGameStatus | null;
  lastGestureEvent: GestureEventType | null;
  lastAwardedPoints: number;
}

export interface GameConfig {
  totalRounds: number;
  targetDurationMs: number;
  successFeedbackMs: number;
  missFeedbackMs: number;
  countdownSeconds: number;
  countdownGoDurationMs: number;
}

export interface ScoringConfig {
  correctGesture: number;
  missedGesture: number;
  wrongGesture: number;
  comboBonusEvery: number;
  comboBonus: number;
}

export interface TargetMetadata {
  title: string;
  instruction: string;
  icon: string;
}

export interface GameEngineOptions {
  config?: Partial<GameConfig>;
  scoring?: Partial<ScoringConfig>;
  targetSequence?: readonly GameAction[];
}
