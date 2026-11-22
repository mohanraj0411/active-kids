export interface MotionProcessingSnapshot {
  sampleCount: number;
  rateHz: number;
  averageMs: number;
  maximumMs: number;
}

/** Small dev telemetry accumulator whose input timestamps are easy to test. */
export class MotionProcessingMeter {
  private sampleCount = 0;
  private totalMs = 0;
  private maximumMs = 0;
  private readonly sampleTimes: number[] = [];

  record(startedAtMs: number, finishedAtMs: number): void {
    const duration = finishedAtMs - startedAtMs;
    if (!Number.isFinite(duration) || duration < 0) return;
    this.sampleCount += 1;
    this.totalMs += duration;
    this.maximumMs = Math.max(this.maximumMs, duration);
    this.sampleTimes.push(finishedAtMs);
    while (this.sampleTimes.length > 1 && finishedAtMs - this.sampleTimes[0] > 1_000) {
      this.sampleTimes.shift();
    }
  }

  snapshot(atMs = getHighResolutionNow()): MotionProcessingSnapshot {
    const now = atMs;
    const firstSampleAt = this.sampleTimes[0] ?? now;
    const windowDuration = Math.min(1_000, Math.max(1, now - firstSampleAt));
    return {
      sampleCount: this.sampleCount,
      rateHz: this.sampleTimes.length * 1_000 / windowDuration,
      averageMs: this.sampleCount ? this.totalMs / this.sampleCount : 0,
      maximumMs: this.maximumMs,
    };
  }

  reset(): void {
    this.sampleCount = 0;
    this.totalMs = 0;
    this.maximumMs = 0;
    this.sampleTimes.length = 0;
  }
}

function getHighResolutionNow(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === 'function' ? clock.now() : Date.now();
}
