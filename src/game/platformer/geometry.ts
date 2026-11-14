import type { Rect } from './types';

export function intersects(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export function circleIntersectsRect(
  centerX: number,
  centerY: number,
  radius: number,
  rect: Rect,
): boolean {
  const closestX = clamp(centerX, rect.x, rect.x + rect.width);
  const closestY = clamp(centerY, rect.y, rect.y + rect.height);
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
