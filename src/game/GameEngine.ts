import { GAME_CONFIG, SCORE_CONFIG, TARGET_CONFIG } from './config';
import { calculateAccuracyPercent, calculateCorrectAward } from './scoring';
import { createTargetSequence } from './targetGenerator';
import type {
  GameAction,
  GameConfig,
  GameEngineOptions,
  GameState,
  ScoringConfig,
  TimedGameStatus,
} from './types';
import type { GestureEvent, GestureEventType } from '../motion/types';

/** Framework-free deterministic game rules. Time advances only through tick(). */
export class GameEngine {
  private readonly config: GameConfig;
  private readonly scoring: ScoringConfig;
  private readonly targets: readonly GameAction[];
  private state: GameState;

  constructor(options: GameEngineOptions = {}) {
    this.config = { ...GAME_CONFIG, ...options.config };
    this.scoring = { ...SCORE_CONFIG, ...options.scoring };
    this.targets = createTargetSequence(
      this.config.totalRounds,
      options.targetSequence ?? TARGET_CONFIG.sequence,
    );
    validateConfig(this.config, this.scoring);
    this.state = createInitialState(this.config.totalRounds);
  }

  start(): GameState {
    this.state = createInitialState(this.config.totalRounds);
    this.state.status = 'COUNTDOWN';
    this.state.countdownRemainingMs =
      this.config.countdownSeconds * 1_000 + this.config.countdownGoDurationMs;
    return this.getState();
  }

  pause(): GameState {
    if (!isTimedStatus(this.state.status)) return this.getState();
    this.state.pausedFrom = this.state.status;
    this.state.status = 'PAUSED';
    return this.getState();
  }

  resume(): GameState {
    if (this.state.status !== 'PAUSED' || this.state.pausedFrom === null) {
      return this.getState();
    }
    this.state.status = this.state.pausedFrom;
    this.state.pausedFrom = null;
    return this.getState();
  }

  stop(): GameState {
    this.state = createInitialState(this.config.totalRounds);
    return this.getState();
  }

  handleGesture(event: GestureEvent): GameState {
    if (this.state.status !== 'PLAYING' || this.state.currentTarget === null) {
      return this.getState();
    }

    this.state.lastGestureEvent = event.type;
    if (matchesTarget(event.type, this.state.currentTarget)) {
      this.completeSuccess();
    } else {
      this.state.lastAwardedPoints = this.scoring.wrongGesture;
      this.state.score += this.scoring.wrongGesture;
    }
    return this.getState();
  }

  tick(deltaMs: number): GameState {
    let remainingDelta = Number.isFinite(deltaMs) ? Math.max(deltaMs, 0) : 0;

    while (remainingDelta > 0) {
      switch (this.state.status) {
        case 'COUNTDOWN': {
          const consumed = Math.min(
            remainingDelta,
            this.state.countdownRemainingMs,
          );
          this.state.countdownRemainingMs = Math.max(
            0,
            this.state.countdownRemainingMs - consumed,
          );
          remainingDelta -= consumed;
          if (this.state.countdownRemainingMs === 0) {
            this.beginRound(1);
            continue;
          }
          return this.getState();
        }
        case 'PLAYING': {
          const consumed = Math.min(remainingDelta, this.state.timeRemainingMs);
          this.state.timeRemainingMs = Math.max(
            0,
            this.state.timeRemainingMs - consumed,
          );
          remainingDelta -= consumed;
          if (this.state.timeRemainingMs === 0) {
            this.completeMiss();
            continue;
          }
          return this.getState();
        }
        case 'SUCCESS':
        case 'MISSED': {
          const consumed = Math.min(
            remainingDelta,
            this.state.feedbackRemainingMs,
          );
          this.state.feedbackRemainingMs = Math.max(
            0,
            this.state.feedbackRemainingMs - consumed,
          );
          remainingDelta -= consumed;
          if (this.state.feedbackRemainingMs === 0) {
            this.advanceAfterFeedback();
            continue;
          }
          return this.getState();
        }
        case 'IDLE':
        case 'PAUSED':
        case 'GAME_OVER':
          return this.getState();
      }
    }

    return this.getState();
  }

  getState(): GameState {
    return { ...this.state };
  }

  private beginRound(round: number): void {
    this.state.status = 'PLAYING';
    this.state.currentRound = round;
    this.state.currentTarget = this.targets[round - 1] ?? null;
    this.state.timeRemainingMs = this.config.targetDurationMs;
    this.state.countdownRemainingMs = 0;
    this.state.feedbackRemainingMs = 0;
    this.state.lastAwardedPoints = 0;
  }

  private completeSuccess(): void {
    this.state.consecutiveSuccesses += 1;
    this.state.consecutiveMisses = 0;
    this.state.successfulRounds += 1;
    this.state.completedRounds += 1;
    this.state.bestCombo = Math.max(
      this.state.bestCombo,
      this.state.consecutiveSuccesses,
    );
    this.state.accuracyPercent = calculateAccuracyPercent(
      this.state.successfulRounds,
      this.state.completedRounds,
    );

    const award = calculateCorrectAward(
      this.state.consecutiveSuccesses,
      this.scoring,
    );
    this.state.score += award.totalPoints;
    this.state.lastAwardedPoints = award.totalPoints;
    this.state.status = 'SUCCESS';
    this.state.feedbackRemainingMs = this.config.successFeedbackMs;
    this.state.timeRemainingMs = 0;
  }

  private completeMiss(): void {
    this.state.consecutiveMisses += 1;
    this.state.consecutiveSuccesses = 0;
    this.state.missedRounds += 1;
    this.state.completedRounds += 1;
    this.state.accuracyPercent = calculateAccuracyPercent(
      this.state.successfulRounds,
      this.state.completedRounds,
    );
    this.state.score += this.scoring.missedGesture;
    this.state.lastAwardedPoints = this.scoring.missedGesture;
    this.state.status = 'MISSED';
    this.state.feedbackRemainingMs = this.config.missFeedbackMs;
  }

  private advanceAfterFeedback(): void {
    this.state.feedbackRemainingMs = 0;
    if (this.state.completedRounds >= this.config.totalRounds) {
      this.state.status = 'GAME_OVER';
      this.state.currentTarget = null;
      this.state.currentRound = this.config.totalRounds;
      this.state.timeRemainingMs = 0;
      return;
    }

    this.beginRound(this.state.completedRounds + 1);
  }
}

function matchesTarget(event: GestureEventType, target: GameAction): boolean {
  switch (target) {
    case 'LEFT_HAND_UP':
      return event === 'LEFT_HAND_RAISED';
    case 'RIGHT_HAND_UP':
      return event === 'RIGHT_HAND_RAISED';
    case 'BOTH_HANDS_UP':
      return event === 'BOTH_HANDS_RAISED';
    case 'SQUAT':
      return event === 'SQUAT_STARTED';
    case 'JUMP':
      return event === 'JUMP';
    case 'MOVE_LEFT':
      return event === 'MOVE_LEFT';
    case 'MOVE_RIGHT':
      return event === 'MOVE_RIGHT';
  }
}

function isTimedStatus(status: GameState['status']): status is TimedGameStatus {
  return (
    status === 'COUNTDOWN' ||
    status === 'PLAYING' ||
    status === 'SUCCESS' ||
    status === 'MISSED'
  );
}

function createInitialState(totalRounds: number): GameState {
  return {
    status: 'IDLE',
    score: 0,
    currentRound: 0,
    totalRounds,
    currentTarget: null,
    timeRemainingMs: 0,
    countdownRemainingMs: 0,
    feedbackRemainingMs: 0,
    consecutiveSuccesses: 0,
    consecutiveMisses: 0,
    successfulRounds: 0,
    missedRounds: 0,
    completedRounds: 0,
    bestCombo: 0,
    accuracyPercent: 0,
    pausedFrom: null,
    lastGestureEvent: null,
    lastAwardedPoints: 0,
  };
}

function validateConfig(config: GameConfig, scoring: ScoringConfig): void {
  if (!Number.isInteger(config.totalRounds) || config.totalRounds < 1) {
    throw new RangeError('totalRounds must be a positive integer.');
  }
  if (!Number.isFinite(config.targetDurationMs) || config.targetDurationMs <= 0) {
    throw new RangeError('targetDurationMs must be greater than zero.');
  }
  if (!Number.isFinite(config.successFeedbackMs) || config.successFeedbackMs < 0) {
    throw new RangeError('successFeedbackMs cannot be negative.');
  }
  if (!Number.isFinite(config.missFeedbackMs) || config.missFeedbackMs < 0) {
    throw new RangeError('missFeedbackMs cannot be negative.');
  }
  if (!Number.isInteger(config.countdownSeconds) || config.countdownSeconds < 0) {
    throw new RangeError('countdownSeconds must be a non-negative integer.');
  }
  if (
    !Number.isFinite(config.countdownGoDurationMs) ||
    config.countdownGoDurationMs < 0
  ) {
    throw new RangeError('countdownGoDurationMs cannot be negative.');
  }
  if (
    !Number.isFinite(scoring.correctGesture) ||
    !Number.isFinite(scoring.missedGesture) ||
    !Number.isFinite(scoring.wrongGesture) ||
    !Number.isInteger(scoring.comboBonusEvery) ||
    scoring.comboBonusEvery < 0 ||
    !Number.isFinite(scoring.comboBonus)
  ) {
    throw new RangeError('Scoring values must be finite and comboBonusEvery non-negative.');
  }
}
