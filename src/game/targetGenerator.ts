import { TARGET_CONFIG } from './config';
import type { GameAction } from './types';

/** Returns a deterministic sequence, cycling the configured pattern if needed. */
export function createTargetSequence(
  totalRounds: number,
  pattern: readonly GameAction[] = TARGET_CONFIG.sequence,
): GameAction[] {
  if (!Number.isInteger(totalRounds) || totalRounds < 1) {
    throw new RangeError('totalRounds must be a positive integer.');
  }
  if (pattern.length === 0) {
    throw new RangeError('The target pattern must contain at least one action.');
  }

  return Array.from({ length: totalRounds }, (_, index) =>
    pattern[index % pattern.length],
  );
}
