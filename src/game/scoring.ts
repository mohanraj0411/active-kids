import { SCORE_CONFIG } from './config';
import type { ScoringConfig } from './types';

export interface ScoreAward {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
}

export function calculateCorrectAward(
  consecutiveSuccesses: number,
  config: ScoringConfig = SCORE_CONFIG,
): ScoreAward {
  const hasComboBonus =
    config.comboBonusEvery > 0 &&
    consecutiveSuccesses > 0 &&
    consecutiveSuccesses % config.comboBonusEvery === 0;
  const basePoints = config.correctGesture;
  const bonusPoints = hasComboBonus ? config.comboBonus : 0;

  return {
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
  };
}

export function calculateAccuracyPercent(
  successfulRounds: number,
  completedRounds: number,
): number {
  if (completedRounds <= 0) return 0;
  return Math.round((successfulRounds / completedRounds) * 100);
}
