export interface StableBooleanUpdate {
  value: boolean;
  changed: boolean;
}

/** Requires consecutive candidate frames while treating missing data as a pause. */
export class StableBoolean {
  private current = false;
  private candidate: boolean | null = null;
  private candidateFrames = 0;

  constructor(private readonly requiredFrames: number) {}

  get value(): boolean {
    return this.current;
  }

  reset(): void {
    this.current = false;
    this.candidate = null;
    this.candidateFrames = 0;
  }

  update(next: boolean | null): StableBooleanUpdate {
    if (next === null) {
      this.candidate = null;
      this.candidateFrames = 0;
      return { value: this.current, changed: false };
    }

    if (next === this.current) {
      this.candidate = null;
      this.candidateFrames = 0;
      return { value: this.current, changed: false };
    }

    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }

    if (this.candidateFrames < this.requiredFrames) {
      return { value: this.current, changed: false };
    }

    this.current = next;
    this.candidate = null;
    this.candidateFrames = 0;
    return { value: this.current, changed: true };
  }
}
