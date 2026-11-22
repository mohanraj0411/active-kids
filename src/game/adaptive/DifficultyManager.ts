import type { PerformanceMetrics } from './PerformanceTracker';

export type DifficultyLevel = 'EASY' | 'NORMAL' | 'CHALLENGE';

export interface DifficultyModifiers {
  enemySpeedMultiplier: number;
  attackWindowMultiplier: number;
  promptLeadMultiplier: number;
}

const TARGET_MODIFIERS: Record<DifficultyLevel, DifficultyModifiers> = {
  EASY: { enemySpeedMultiplier: 0.82, attackWindowMultiplier: 1.2, promptLeadMultiplier: 1.25 },
  NORMAL: { enemySpeedMultiplier: 1, attackWindowMultiplier: 1, promptLeadMultiplier: 1 },
  CHALLENGE: { enemySpeedMultiplier: 1.12, attackWindowMultiplier: 0.94, promptLeadMultiplier: 0.92 },
};

/** Two-window hysteresis prevents a single success or mistake changing difficulty. */
export class DifficultyManager {
  private level: DifficultyLevel = 'NORMAL';
  private lowWindows = 0;
  private highWindows = 0;
  private recoveryWindows = 0;
  private modifiers: DifficultyModifiers = { ...TARGET_MODIFIERS.NORMAL };

  get current(): DifficultyLevel {
    return this.level;
  }

  evaluate(metrics: PerformanceMetrics): DifficultyLevel {
    const struggling = metrics.performanceScore < 40 || metrics.recentMistakes >= 3;
    const thriving = metrics.performanceScore > 72 && metrics.recentSuccesses >= 3;
    this.lowWindows = struggling ? this.lowWindows + 1 : 0;
    this.highWindows = thriving ? this.highWindows + 1 : 0;

    if (this.level === 'NORMAL') {
      if (this.lowWindows >= 2) this.level = 'EASY';
      else if (this.highWindows >= 2) this.level = 'CHALLENGE';
    } else if (this.level === 'EASY') {
      if (thriving && this.highWindows >= 2) {
        this.level = 'NORMAL';
        this.recoveryWindows = 0;
      } else if (!struggling && metrics.performanceScore >= 50) {
        this.recoveryWindows += 1;
        if (this.recoveryWindows >= 2) {
          this.level = 'NORMAL';
          this.recoveryWindows = 0;
        }
      } else {
        this.recoveryWindows = 0;
      }
    } else if (this.level === 'CHALLENGE') {
      if (struggling && this.lowWindows >= 2) {
        this.level = 'NORMAL';
        this.recoveryWindows = 0;
      } else if (metrics.performanceScore < 62) {
        this.recoveryWindows += 1;
        if (this.recoveryWindows >= 2) {
          this.level = 'NORMAL';
          this.recoveryWindows = 0;
        }
      } else {
        this.recoveryWindows = 0;
      }
    }

    this.advanceModifiers();
    return this.level;
  }

  getModifiers(): DifficultyModifiers {
    return { ...this.modifiers };
  }

  reset(): void {
    this.level = 'NORMAL';
    this.lowWindows = 0;
    this.highWindows = 0;
    this.recoveryWindows = 0;
    this.modifiers = { ...TARGET_MODIFIERS.NORMAL };
  }

  private advanceModifiers(): void {
    const target = TARGET_MODIFIERS[this.level];
    this.modifiers = {
      enemySpeedMultiplier: approach(this.modifiers.enemySpeedMultiplier, target.enemySpeedMultiplier, 0.06),
      attackWindowMultiplier: approach(this.modifiers.attackWindowMultiplier, target.attackWindowMultiplier, 0.06),
      promptLeadMultiplier: approach(this.modifiers.promptLeadMultiplier, target.promptLeadMultiplier, 0.06),
    };
  }
}

function approach(current: number, target: number, maximumStep: number): number {
  if (Math.abs(target - current) <= maximumStep) return target;
  return current + Math.sign(target - current) * maximumStep;
}
