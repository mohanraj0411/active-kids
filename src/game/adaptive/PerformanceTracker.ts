import { clamp } from '../platformer/geometry';

export interface PerformanceMetrics {
  jumpsAttempted: number;
  jumpsSuccessful: number;
  jumpsFailed: number;
  attacksAttempted: number;
  attacksSuccessful: number;
  enemyCollisions: number;
  collectiblesAvailable: number;
  collectiblesCollected: number;
  collectiblesMissed: number;
  checkpointReached: number;
  checkpointDeaths: number;
  comboBest: number;
  comboCurrent: number;
  challengeAttempts: number;
  challengeSuccesses: number;
  averageReactionTimeMs: number;
  movementConfidence: number;
  recentMistakes: number;
  recentSuccesses: number;
  performanceScore: number;
}

type RecentEvent = 'MISTAKE' | 'SUCCESS';

const RECENT_EVENT_LIMIT = 20;

/** Session-only, bounded counters. No identity or camera data is retained. */
export class PerformanceTracker {
  private metrics: PerformanceMetrics = createEmptyMetrics();
  private recentEvents: RecentEvent[] = [];
  private checkpointFailureCounts = new Map<string, number>();
  private movementConfidenceTotal = 0;
  private movementConfidenceSamples = 0;
  private reactionTimeTotalMs = 0;
  private reactionTimeSamples = 0;

  recordJumpAttempt(): void {
    this.metrics.jumpsAttempted += 1;
  }

  recordJumpSuccess(): void {
    this.metrics.jumpsSuccessful += 1;
    this.recordRecent('SUCCESS');
  }

  recordJumpFailure(): void {
    this.metrics.jumpsFailed += 1;
    this.recordRecent('MISTAKE');
  }

  recordAttackAttempt(): void {
    this.metrics.attacksAttempted += 1;
  }

  recordAttackSuccess(): void {
    this.metrics.attacksSuccessful += 1;
    this.recordRecent('SUCCESS');
  }

  recordEnemyCollision(checkpointId: string): void {
    this.metrics.enemyCollisions += 1;
    this.recordCheckpointFailure(checkpointId);
  }

  recordCheckpointFailure(checkpointId: string): void {
    this.metrics.checkpointDeaths += 1;
    this.checkpointFailureCounts.set(
      checkpointId,
      (this.checkpointFailureCounts.get(checkpointId) ?? 0) + 1,
    );
    this.recordRecent('MISTAKE');
  }

  getFailuresAtCheckpoint(checkpointId: string): number {
    return this.checkpointFailureCounts.get(checkpointId) ?? 0;
  }

  recordCheckpointReached(): void {
    this.metrics.checkpointReached += 1;
    this.recordRecent('SUCCESS');
  }

  setCollectiblesAvailable(count: number): void {
    this.metrics.collectiblesAvailable = Math.max(0, Math.floor(count));
  }

  recordCollectibleSpawned(): void {
    this.metrics.collectiblesAvailable += 1;
  }

  recordCollectibleCollected(): void {
    this.metrics.collectiblesCollected += 1;
    this.recordRecent('SUCCESS');
  }

  recordCollectibleMissed(): void {
    this.metrics.collectiblesMissed += 1;
    this.recordRecent('MISTAKE');
  }

  recordCombo(current: number, best: number): void {
    const previousBest = this.metrics.comboBest;
    this.metrics.comboCurrent = Math.max(0, Math.floor(current));
    this.metrics.comboBest = Math.max(previousBest, Math.floor(best));
    if (this.metrics.comboBest > previousBest) this.recordRecent('SUCCESS');
  }

  recordChallengeAttempt(): void {
    this.metrics.challengeAttempts += 1;
  }

  recordChallengeSuccess(): void {
    this.metrics.challengeSuccesses += 1;
    this.recordRecent('SUCCESS');
  }

  recordChallengeFailure(): void {
    this.recordRecent('MISTAKE');
  }

  recordMovementConfidence(confidence: number): void {
    if (!Number.isFinite(confidence)) return;
    this.movementConfidenceTotal += clamp(confidence, 0, 1);
    this.movementConfidenceSamples += 1;
    this.metrics.movementConfidence = this.movementConfidenceTotal / this.movementConfidenceSamples;
  }

  recordReactionTime(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.reactionTimeTotalMs += Math.min(milliseconds, 60_000);
    this.reactionTimeSamples += 1;
    this.metrics.averageReactionTimeMs = this.reactionTimeTotalMs / this.reactionTimeSamples;
  }

  /** Call only at the difficulty evaluation cadence, never in the render loop. */
  evaluateScore(): number {
    const jumpRate = ratio(this.metrics.jumpsSuccessful, this.metrics.jumpsAttempted, 0.5);
    const attackRate = ratio(this.metrics.attacksSuccessful, this.metrics.attacksAttempted, 0.5);
    const collectibleRate = ratio(
      this.metrics.collectiblesCollected,
      this.metrics.collectiblesCollected + this.metrics.collectiblesMissed,
      0.5,
    );
    const challengeRate = ratio(this.metrics.challengeSuccesses, this.metrics.challengeAttempts, 0.5);
    const collisionRate = 1 - Math.min(
      this.metrics.enemyCollisions / Math.max(3, this.metrics.enemyCollisions + this.metrics.attacksSuccessful),
      1,
    );
    const comboRate = this.metrics.comboBest === 0 ? 0.5 : clamp(this.metrics.comboBest / 6, 0, 1);
    const confidence = this.movementConfidenceSamples === 0 ? 0.5 : this.metrics.movementConfidence;
    const rawScore = 100 * (
      jumpRate * 0.27 +
      attackRate * 0.18 +
      collectibleRate * 0.17 +
      collisionRate * 0.12 +
      comboRate * 0.1 +
      challengeRate * 0.1 +
      confidence * 0.06
    );
    this.metrics.performanceScore = clamp(
      this.metrics.performanceScore * 0.7 + rawScore * 0.3,
      0,
      100,
    );
    return this.metrics.performanceScore;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  reset(collectiblesAvailable = 0): void {
    this.metrics = createEmptyMetrics();
    this.metrics.collectiblesAvailable = Math.max(0, Math.floor(collectiblesAvailable));
    this.recentEvents = [];
    this.checkpointFailureCounts.clear();
    this.movementConfidenceTotal = 0;
    this.movementConfidenceSamples = 0;
    this.reactionTimeTotalMs = 0;
    this.reactionTimeSamples = 0;
  }

  private recordRecent(event: RecentEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > RECENT_EVENT_LIMIT) this.recentEvents.shift();
    this.metrics.recentMistakes = this.recentEvents.filter((item) => item === 'MISTAKE').length;
    this.metrics.recentSuccesses = this.recentEvents.length - this.metrics.recentMistakes;
  }
}

function createEmptyMetrics(): PerformanceMetrics {
  return {
    jumpsAttempted: 0,
    jumpsSuccessful: 0,
    jumpsFailed: 0,
    attacksAttempted: 0,
    attacksSuccessful: 0,
    enemyCollisions: 0,
    collectiblesAvailable: 0,
    collectiblesCollected: 0,
    collectiblesMissed: 0,
    checkpointReached: 0,
    checkpointDeaths: 0,
    comboBest: 0,
    comboCurrent: 0,
    challengeAttempts: 0,
    challengeSuccesses: 0,
    averageReactionTimeMs: 0,
    movementConfidence: 0.5,
    recentMistakes: 0,
    recentSuccesses: 0,
    performanceScore: 50,
  };
}

function ratio(successes: number, attempts: number, fallback: number): number {
  return attempts <= 0 ? fallback : clamp(successes / attempts, 0, 1);
}
