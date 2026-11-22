export const PERFORMANCE_TEST_DURATION_MS = 5 * 60 * 1_000;

export interface PerformanceTestMetadata {
  device: string;
  os: string;
  osVersion: string;
  ram: string;
  build: string;
  screenResolution: string;
  inputMode: string;
  cameraState: string;
}

export type PerformanceTestValues = {
  gameRafRateHz: number | null;
  simulationRateHz: number | null;
  renderLoopRateHz: number | null;
  reactCommitRateHz: number | null;
  reactRenderMs: number | null;
  captureRateHz: number | null;
  poseRateHz: number | null;
  motionRateHz: number | null;
  inputLatencyMs: number | null;
  memoryMb: number | null;
  skippedPoseFrames: number | null;
};

export interface PerformanceTestReport {
  metadata: PerformanceTestMetadata;
  startedAt: number;
  finishedAt: number;
  durationSeconds: number;
  sampleCount: number;
  thermalStates: string[];
  metrics: Record<keyof PerformanceTestValues, { average: number; minimum: number; maximum: number; samples: number } | null>;
}

/** Collects measured JS/runtime rates during a user-triggered five-minute run. */
export class PerformanceTestHarness {
  private metadata: PerformanceTestMetadata | null = null;
  private startedAt = 0;
  private readonly values: Record<keyof PerformanceTestValues, number[]> = {
    gameRafRateHz: [],
    simulationRateHz: [],
    renderLoopRateHz: [],
    reactCommitRateHz: [],
    reactRenderMs: [],
    captureRateHz: [],
    poseRateHz: [],
    motionRateHz: [],
    inputLatencyMs: [],
    memoryMb: [],
    skippedPoseFrames: [],
  };
  private readonly thermalStates = new Set<string>();

  start(metadata: PerformanceTestMetadata, startedAt: number): void {
    this.metadata = { ...metadata };
    this.startedAt = startedAt;
    for (const samples of Object.values(this.values)) samples.length = 0;
    this.thermalStates.clear();
  }

  record(values: PerformanceTestValues, thermalState: string | null = null): void {
    if (!this.metadata) return;
    for (const key of Object.keys(this.values) as (keyof PerformanceTestValues)[]) {
      const value = values[key];
      if (typeof value === 'number' && Number.isFinite(value)) this.values[key].push(value);
    }
    if (thermalState && thermalState !== 'N/A') this.thermalStates.add(thermalState);
  }

  finish(finishedAt: number): PerformanceTestReport | null {
    if (!this.metadata) return null;
    const metrics = {} as PerformanceTestReport['metrics'];
    for (const key of Object.keys(this.values) as (keyof PerformanceTestValues)[]) {
      const samples = this.values[key];
      metrics[key] = samples.length ? {
        average: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        minimum: Math.min(...samples),
        maximum: Math.max(...samples),
        samples: samples.length,
      } : null;
    }
    const report: PerformanceTestReport = {
      metadata: this.metadata,
      startedAt: this.startedAt,
      finishedAt,
      durationSeconds: Math.max(0, finishedAt - this.startedAt) / 1_000,
      sampleCount: Math.max(...Object.values(this.values).map((samples) => samples.length), 0),
      thermalStates: [...this.thermalStates],
      metrics,
    };
    this.metadata = null;
    return report;
  }

  get isRunning(): boolean {
    return this.metadata !== null;
  }

  elapsedMs(at = Date.now()): number {
    return this.metadata ? Math.max(0, at - this.startedAt) : 0;
  }
}
