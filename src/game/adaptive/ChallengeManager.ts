import type { DifficultyLevel } from './DifficultyManager';
import type { PerformanceMetrics } from './PerformanceTracker';

export type ChallengeType = 'JUMP' | 'ATTACK' | 'COLLECTIBLE' | 'CROUCH' | 'COMBO';
export type ChallengeTier = 'EASY' | 'NORMAL' | 'ADVANCED';

export interface GameplayChallenge {
  id: number;
  type: ChallengeType;
  tier: ChallengeTier;
  title: string;
  prompt: string;
  targetX: number;
  attempts: number;
  failures: number;
  startedAt: number;
}

/** Chooses one clear next action from current skill data and difficulty. */
export class ChallengeManager {
  private currentChallenge: GameplayChallenge | null = null;
  private nextId = 1;

  get current(): GameplayChallenge | null {
    return this.currentChallenge ? { ...this.currentChallenge } : null;
  }

  selectNext(
    type: ChallengeType,
    targetX: number,
    metrics: PerformanceMetrics,
    difficulty: DifficultyLevel,
    nowSeconds: number,
  ): GameplayChallenge {
    const skill = getSkillResult(type, metrics);
    const tier: ChallengeTier = skill.attempts >= 2 && skill.successRate < 0.55
      ? 'EASY'
      : difficulty === 'CHALLENGE' && skill.attempts >= 2 && skill.successRate >= 0.75
        ? 'ADVANCED'
        : difficulty === 'EASY'
          ? 'EASY'
          : 'NORMAL';
    this.currentChallenge = {
      id: this.nextId++,
      type,
      tier,
      title: getTitle(type, tier),
      prompt: getPrompt(type, tier),
      targetX,
      attempts: 0,
      failures: 0,
      startedAt: Math.max(0, nowSeconds),
    };
    return { ...this.currentChallenge };
  }

  recordAttempt(type: ChallengeType): boolean {
    if (!this.currentChallenge || this.currentChallenge.type !== type) return false;
    this.currentChallenge.attempts += 1;
    return true;
  }

  recordSuccess(type: ChallengeType): boolean {
    if (!this.currentChallenge || this.currentChallenge.type !== type) return false;
    this.currentChallenge = null;
    return true;
  }

  dismissCurrent(): void {
    this.currentChallenge = null;
  }

  recordFailure(type: ChallengeType): GameplayChallenge | null {
    if (!this.currentChallenge || this.currentChallenge.type !== type) return null;
    this.currentChallenge.failures += 1;
    if (this.currentChallenge.failures >= 2) {
      this.currentChallenge.tier = 'EASY';
      this.currentChallenge.title = getTitle(type, 'EASY');
      this.currentChallenge.prompt = `${getPrompt(type, 'EASY')} Let's try that again!`;
    } else {
      this.currentChallenge.prompt = `Nice try! ${getPrompt(type, this.currentChallenge.tier)}`;
    }
    return { ...this.currentChallenge };
  }

  reset(): void {
    this.currentChallenge = null;
    this.nextId = 1;
  }
}

function getSkillResult(type: ChallengeType, metrics: PerformanceMetrics): { attempts: number; successRate: number } {
  if (type === 'JUMP') return { attempts: metrics.jumpsAttempted, successRate: rate(metrics.jumpsSuccessful, metrics.jumpsAttempted) };
  if (type === 'ATTACK') return { attempts: metrics.attacksAttempted, successRate: rate(metrics.attacksSuccessful, metrics.attacksAttempted) };
  if (type === 'COLLECTIBLE') {
    const attempts = metrics.collectiblesCollected + metrics.collectiblesMissed;
    return { attempts, successRate: rate(metrics.collectiblesCollected, attempts) };
  }
  if (type === 'COMBO') return { attempts: metrics.challengeAttempts, successRate: rate(metrics.challengeSuccesses, metrics.challengeAttempts) };
  return { attempts: metrics.checkpointReached, successRate: 0.75 };
}

function rate(successes: number, attempts: number): number {
  return attempts === 0 ? 0.5 : successes / attempts;
}

function getTitle(type: ChallengeType, tier: ChallengeTier): string {
  const titles: Record<ChallengeType, string> = {
    JUMP: 'JUMP CHALLENGE',
    ATTACK: 'FRIENDLY SWING',
    COLLECTIBLE: 'STAR TRAIL',
    CROUCH: 'LEAFY ARCH',
    COMBO: 'COMBO CHALLENGE',
  };
  return tier === 'ADVANCED' ? `BONUS ${titles[type]}` : titles[type];
}

function getPrompt(type: ChallengeType, tier: ChallengeTier): string {
  if (tier === 'EASY') {
    if (type === 'JUMP') return 'Take your time and jump over the gap.';
    if (type === 'ATTACK') return 'Swing a little early to help your friend.';
    if (type === 'COLLECTIBLE') return 'Follow the easy star trail.';
    if (type === 'CROUCH') return 'Duck under the leafy arch.';
    return 'Try a jump, a star, and a friendly swing.';
  }
  if (tier === 'ADVANCED') {
    if (type === 'JUMP') return 'Try a smooth jump and keep your combo going.';
    if (type === 'ATTACK') return 'Time your swing as your friend comes close.';
    if (type === 'COLLECTIBLE') return 'Follow the bonus star trail.';
    if (type === 'CROUCH') return 'Duck through without breaking your stride.';
    return 'Chain your next move into a bigger combo.';
  }
  if (type === 'JUMP') return 'Jump when you reach the gap.';
  if (type === 'ATTACK') return 'Swing to help the friendly spider.';
  if (type === 'COLLECTIBLE') return 'Run through the star.';
  if (type === 'CROUCH') return 'Crouch to pass under the arch.';
  return 'Link a jump, star, and swing.';
}
