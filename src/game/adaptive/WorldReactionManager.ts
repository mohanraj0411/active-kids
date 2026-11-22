export type WorldReactionType = 'STAR' | 'ATTACK' | 'JUMP' | 'COMBO' | 'FAIL' | 'CHECKPOINT' | 'MISSION';
export type CompanionMood = 'WAITING' | 'CHEERING' | 'ENCOURAGING' | 'CELEBRATING';
export type SurpriseType = 'BIRD' | 'LEAVES';

export interface WorldReaction {
  id: number;
  type: WorldReactionType;
  x: number;
  y: number;
  startedAt: number;
  duration: number;
  intensity: number;
}

export interface CompanionSnapshot {
  mood: CompanionMood;
  x: number;
  y: number;
}

export interface SurpriseEvent {
  id: number;
  type: SurpriseType;
  startedAt: number;
  duration: number;
  progress: number;
}

const SURPRISE_SCHEDULE: { at: number; type: SurpriseType; duration: number }[] = [
  { at: 14, type: 'BIRD', duration: 3.2 },
  { at: 48, type: 'LEAVES', duration: 2.8 },
  { at: 86, type: 'BIRD', duration: 3.2 },
];

/** Deterministic visual reactions and surprise timing; it owns no React state. */
export class WorldReactionManager {
  private nextId = 1;
  private activeReaction: WorldReaction | null = null;
  private companionMood: CompanionMood = 'WAITING';
  private companionUntil = 0;

  trigger(type: WorldReactionType, x: number, y: number, nowSeconds: number, combo = 0): WorldReaction {
    const duration = type === 'COMBO' || type === 'MISSION' || type === 'CHECKPOINT' ? 1.5 : 0.85;
    const intensity = type === 'COMBO' ? Math.min(1, Math.max(0.25, combo / 8)) : 0.5;
    this.activeReaction = {
      id: this.nextId++,
      type,
      x,
      y,
      startedAt: nowSeconds,
      duration,
      intensity,
    };
    this.companionMood = type === 'FAIL'
      ? 'ENCOURAGING'
      : type === 'MISSION' || type === 'CHECKPOINT' || combo >= 5
        ? 'CELEBRATING'
        : type === 'STAR' || type === 'ATTACK' || type === 'JUMP' || type === 'COMBO'
          ? 'CHEERING'
          : 'WAITING';
    this.companionUntil = nowSeconds + (this.companionMood === 'WAITING' ? 0 : 1.8);
    return { ...this.activeReaction };
  }

  getReaction(nowSeconds: number): WorldReaction | null {
    if (!this.activeReaction || nowSeconds - this.activeReaction.startedAt > this.activeReaction.duration) return null;
    return { ...this.activeReaction };
  }

  getCompanion(nowSeconds: number, x: number, y: number): CompanionSnapshot {
    return {
      mood: nowSeconds <= this.companionUntil ? this.companionMood : 'WAITING',
      x,
      y,
    };
  }

  getSurprise(nowSeconds: number): SurpriseEvent | null {
    for (let index = SURPRISE_SCHEDULE.length - 1; index >= 0; index -= 1) {
      const event = SURPRISE_SCHEDULE[index];
      const age = nowSeconds - event.at;
      if (age >= 0 && age <= event.duration) {
        return {
          id: index + 1,
          type: event.type,
          startedAt: event.at,
          duration: event.duration,
          progress: age / event.duration,
        };
      }
    }
    return null;
  }

  reset(): void {
    this.nextId = 1;
    this.activeReaction = null;
    this.companionMood = 'WAITING';
    this.companionUntil = 0;
  }
}
