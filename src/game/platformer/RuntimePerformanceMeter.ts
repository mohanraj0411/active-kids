export interface RuntimePerformanceSnapshot {
  gameRafRateHz: number;
  simulationRateHz: number;
  simulationAverageMs: number;
  simulationMaximumMs: number;
  renderLoopRateHz: number;
  reactCommitRateHz: number;
  reactRenderAverageMs: number;
  reactRenderMaximumMs: number;
}

const EMPTY: RuntimePerformanceSnapshot = {
  gameRafRateHz: 0,
  simulationRateHz: 0,
  simulationAverageMs: 0,
  simulationMaximumMs: 0,
  renderLoopRateHz: 0,
  reactCommitRateHz: 0,
  reactRenderAverageMs: 0,
  reactRenderMaximumMs: 0,
};

/** One-second rolling counters for JS loop and React commit diagnostics. */
export class RuntimePerformanceMeter {
  private windowStartedAt: number | null = null;
  private rafCount = 0;
  private simulationCount = 0;
  private renderLoopCount = 0;
  private reactCommitCount = 0;
  private simulationTotalMs = 0;
  private simulationMaxMs = 0;
  private reactRenderTotalMs = 0;
  private reactRenderMaxMs = 0;
  private latest: RuntimePerformanceSnapshot = EMPTY;

  recordRaf(at: number): void {
    this.ensureWindow(at);
    this.rafCount += 1;
  }

  recordSimulation(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.simulationCount += 1;
    this.simulationTotalMs += durationMs;
    this.simulationMaxMs = Math.max(this.simulationMaxMs, durationMs);
  }

  recordRenderLoop(): void {
    this.renderLoopCount += 1;
  }

  recordReactRender(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.reactCommitCount += 1;
    this.reactRenderTotalMs += durationMs;
    this.reactRenderMaxMs = Math.max(this.reactRenderMaxMs, durationMs);
  }

  snapshot(at: number): RuntimePerformanceSnapshot {
    this.ensureWindow(at);
    const elapsedMs = Math.max(1, at - (this.windowStartedAt ?? at));
    if (elapsedMs >= 1_000) {
      this.latest = {
        gameRafRateHz: this.rafCount * 1_000 / elapsedMs,
        simulationRateHz: this.simulationCount * 1_000 / elapsedMs,
        simulationAverageMs: this.simulationCount ? this.simulationTotalMs / this.simulationCount : 0,
        simulationMaximumMs: this.simulationMaxMs,
        renderLoopRateHz: this.renderLoopCount * 1_000 / elapsedMs,
        reactCommitRateHz: this.reactCommitCount * 1_000 / elapsedMs,
        reactRenderAverageMs: this.reactCommitCount ? this.reactRenderTotalMs / this.reactCommitCount : 0,
        reactRenderMaximumMs: this.reactRenderMaxMs,
      };
      this.windowStartedAt = at;
      this.rafCount = 0;
      this.simulationCount = 0;
      this.renderLoopCount = 0;
      this.reactCommitCount = 0;
      this.simulationTotalMs = 0;
      this.simulationMaxMs = 0;
      this.reactRenderTotalMs = 0;
      this.reactRenderMaxMs = 0;
    }
    return this.latest;
  }

  private ensureWindow(at: number): void {
    this.windowStartedAt ??= at;
  }
}
