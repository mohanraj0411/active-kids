import { PLATFORMER_CONFIG } from './config';
import { clamp } from './geometry';
import type { PlayerSnapshot, PlayerState, Rect } from './types';
import type { HorizontalMovement } from '../../motion/controllerTypes';

interface PlayerControllerOptions {
  x: number;
  y: number;
  scale: number;
  minimumX?: number;
}

/** Deterministic runner physics and animation state, independent of React. */
export class PlayerController {
  private readonly scale: number;
  private readonly width: number;
  private readonly standingHeight: number;
  private readonly crouchedHeight: number;
  private x: number;
  private minimumX: number;
  private y: number;
  private height: number;
  private velocityX = 0;
  private velocityY = 0;
  private grounded = true;
  private running = false;
  private horizontalDirection: -1 | 0 | 1 = 0;
  private horizontalIntensity = 0;
  private crouching = false;
  private attackElapsed: number | null = null;
  private attackCooldown = 0;
  private attackHitWindowScale = 1;
  private animationTime = 0;
  private previousY: number;
  private hit = false;
  private celebrating = false;

  constructor(options: PlayerControllerOptions) {
    this.scale = options.scale;
    this.width = PLATFORMER_CONFIG.playerWidth * this.scale;
    this.standingHeight = PLATFORMER_CONFIG.playerHeight * this.scale;
    this.crouchedHeight = PLATFORMER_CONFIG.crouchHeight * this.scale;
    this.x = options.x;
    this.minimumX = options.minimumX ?? 0;
    this.y = options.y;
    this.height = this.standingHeight;
    this.previousY = this.y;
  }

  setRunning(running: boolean): void {
    this.setHorizontalMovement(running ? 1 : 0, running ? 1 : 0);
  }

  setHorizontalMovement(direction: HorizontalMovement['direction'], intensity: number): void {
    const safeIntensity = Number.isFinite(intensity) ? clamp(intensity, 0, 1) : 0;
    this.horizontalIntensity = direction === 0 ? 0 : safeIntensity;
    this.horizontalDirection = this.horizontalIntensity > 0.01 ? direction : 0;
    this.running = this.horizontalDirection !== 0;
  }

  haltHorizontalMotion(): void {
    this.running = false;
    this.horizontalDirection = 0;
    this.horizontalIntensity = 0;
    this.velocityX = 0;
  }

  stopAtHorizontalPosition(x: number): void {
    this.x = Math.max(this.minimumX, x);
    this.velocityX = 0;
  }

  setCrouching(crouching: boolean): void {
    if (crouching && !this.grounded) return;
    if (this.crouching === crouching) return;

    const bottom = this.y + this.height;
    this.crouching = crouching;
    this.height = crouching ? this.crouchedHeight : this.standingHeight;
    this.y = bottom - this.height;
  }

  jump(): boolean {
    if (!this.grounded) return false;
    if (this.crouching) this.setCrouching(false);
    this.grounded = false;
    this.velocityY = PLATFORMER_CONFIG.jumpVelocity * this.scale;
    return true;
  }

  attack(): boolean {
    if (this.hit || this.celebrating) return false;
    if (this.attackElapsed !== null || this.attackCooldown > 0) return false;
    this.attackElapsed = 0;
    this.attackCooldown = PLATFORMER_CONFIG.attackCooldownSeconds;
    return true;
  }

  setAttackHitWindowScale(scale: number): void {
    this.attackHitWindowScale = clamp(Number.isFinite(scale) ? scale : 1, 0.75, 1.35);
  }

  update(deltaSeconds: number): void {
    const dt = clamp(deltaSeconds, 0, PLATFORMER_CONFIG.maxDeltaSeconds);
    this.previousY = this.y;
    this.animationTime += dt;
    if (this.hit || this.celebrating) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.attackElapsed !== null) {
      this.attackElapsed += dt;
      if (this.attackElapsed >= this.getAttackDuration()) this.attackElapsed = null;
    }

    const targetVelocity = this.horizontalDirection * this.horizontalIntensity *
      PLATFORMER_CONFIG.maxRunSpeed * this.scale;
    const acceleratingInSameDirection = targetVelocity !== 0 &&
      this.velocityX * targetVelocity >= 0 &&
      Math.abs(targetVelocity) > Math.abs(this.velocityX);
    const acceleration = (acceleratingInSameDirection
      ? PLATFORMER_CONFIG.runAcceleration
      : PLATFORMER_CONFIG.runDeceleration) * this.scale;
    const velocityDifference = targetVelocity - this.velocityX;
    this.velocityX += clamp(velocityDifference, -acceleration * dt, acceleration * dt);
    const nextX = this.x + this.velocityX * dt;
    if (nextX < this.minimumX) {
      this.x = this.minimumX;
      if (this.velocityX < 0) this.velocityX = 0;
    } else {
      this.x = nextX;
    }

    if (!this.grounded) {
      this.velocityY = Math.min(
        this.velocityY + PLATFORMER_CONFIG.gravity * this.scale * dt,
        PLATFORMER_CONFIG.maxFallSpeed * this.scale,
      );
      this.y += this.velocityY * dt;
    }
  }

  leaveGround(): void {
    if (!this.grounded) return;
    this.grounded = false;
    this.velocityY = 0;
  }

  landOnSurface(surfaceY: number): void {
    this.y = surfaceY - this.height;
    this.velocityY = 0;
    this.grounded = true;
  }

  getPreviousBounds(): Rect {
    return { x: this.x, y: this.previousY, width: this.width, height: this.height };
  }

  getBounds(): Rect {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  getAttackHitbox(): Rect | null {
    if (!this.isAttackHitActive()) return null;
    return {
      x: this.x + this.width - 4 * this.scale,
      y: this.y + this.height * 0.35,
      width: PLATFORMER_CONFIG.attackReach * this.scale,
      height: PLATFORMER_CONFIG.attackHitboxHeight * this.scale,
    };
  }

  isAttackHitActive(): boolean {
    return (
      this.attackElapsed !== null &&
      this.attackElapsed >= PLATFORMER_CONFIG.attackWindupSeconds &&
      this.attackElapsed <=
        PLATFORMER_CONFIG.attackWindupSeconds +
        PLATFORMER_CONFIG.attackHitWindowSeconds * this.attackHitWindowScale
    );
  }

  getState(): PlayerSnapshot {
    return {
      state: this.getPlayerState(),
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      grounded: this.grounded,
      running: this.running,
      crouching: this.crouching,
      attacking: this.attackElapsed !== null,
      attackHitActive: this.isAttackHitActive(),
      attackProgress: this.attackElapsed === null
        ? 0
        : clamp(this.attackElapsed / this.getAttackDuration(), 0, 1),
      animationTime: this.animationTime,
    };
  }

  reset(options: PlayerControllerOptions): void {
    this.x = options.x;
    this.minimumX = options.minimumX ?? 0;
    this.y = options.y;
    this.previousY = this.y;
    this.height = this.standingHeight;
    this.velocityX = 0;
    this.velocityY = 0;
    this.grounded = true;
    this.running = false;
    this.horizontalDirection = 0;
    this.horizontalIntensity = 0;
    this.crouching = false;
    this.attackElapsed = null;
    this.attackCooldown = 0;
    this.attackHitWindowScale = 1;
    this.animationTime = 0;
    this.hit = false;
    this.celebrating = false;
  }

  setHit(): void {
    const bottom = this.y + this.height;
    this.hit = true;
    this.celebrating = false;
    this.haltHorizontalMotion();
    this.attackElapsed = null;
    this.crouching = false;
    this.height = this.standingHeight;
    this.y = bottom - this.height;
  }

  setCelebrating(): void {
    this.celebrating = true;
    this.hit = false;
    this.haltHorizontalMotion();
  }

  private getPlayerState(): PlayerState {
    if (this.hit) return 'HIT';
    if (this.celebrating) return 'CELEBRATING';
    if (!this.grounded) return this.velocityY < 0 ? 'JUMPING' : 'FALLING';
    if (this.crouching) return 'CROUCHING';
    if (this.attackElapsed !== null) return 'ATTACKING';
    if (Math.abs(this.velocityX) > 8 * this.scale) return 'RUNNING';
    return 'IDLE';
  }

  private getAttackDuration(): number {
    return (
      PLATFORMER_CONFIG.attackWindupSeconds +
      PLATFORMER_CONFIG.attackHitWindowSeconds * this.attackHitWindowScale +
      PLATFORMER_CONFIG.attackRecoverySeconds
    );
  }
}
