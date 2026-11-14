import type { MotionEvent } from '../../motion/controllerTypes';
import { PLATFORMER_CONFIG } from './config';
import { circleIntersectsRect, clamp, intersects } from './geometry';
import { createPlatformerLevel } from './level';
import { PlayerController } from './PlayerController';
import type {
  EnemyObject,
  GapObject,
  PlatformerLevel,
  PlatformerLevelObject,
  PlatformerSnapshot,
  PlatformerStatus,
  Rect,
} from './types';

export interface GameControllerOptions {
  viewportWidth: number;
  stageHeight: number;
  level?: PlatformerLevel;
}

/** Framework-free level, physics, collision, scoring, and status controller. */
export class GameController {
  private readonly viewportWidth: number;
  private readonly stageHeight: number;
  private readonly scale: number;
  private readonly customLevel?: PlatformerLevel;
  private level: PlatformerLevel;
  private player: PlayerController;
  private status: PlatformerStatus = 'READY';
  private score = 0;
  private collectibles = 0;
  private elapsedSeconds = 0;
  private latestMotionEvent: MotionEvent | null = null;

  constructor(options: GameControllerOptions) {
    this.viewportWidth = Math.max(240, options.viewportWidth);
    this.stageHeight = Math.max(220, options.stageHeight);
    this.scale = Math.max(0.65, this.viewportWidth / PLATFORMER_CONFIG.referenceWidth);
    this.customLevel = options.level;
    this.level = cloneLevel(options.level ?? createPlatformerLevel(this.viewportWidth, this.stageHeight));
    this.player = this.createPlayer();
  }

  get currentStatus(): PlatformerStatus {
    return this.status;
  }

  start(): void {
    if (this.status === 'READY') this.status = 'PLAYING';
  }

  pause(): void {
    if (this.status !== 'PLAYING') return;
    this.status = 'PAUSED';
    this.player.haltHorizontalMotion();
  }

  resume(): void {
    if (this.status === 'PAUSED') this.status = 'PLAYING';
  }

  noteMotionEvent(event: MotionEvent): void {
    this.latestMotionEvent = event;
  }

  setRunning(running: boolean): void {
    if (this.status === 'READY' && running) this.start();
    if (this.status === 'PLAYING') this.player.setRunning(running);
  }

  jump(): boolean {
    return this.status === 'PLAYING' && this.player.jump();
  }

  attack(): boolean {
    return this.status === 'PLAYING' && this.player.attack();
  }

  setCrouching(crouching: boolean): void {
    if (this.status === 'PLAYING') this.player.setCrouching(crouching);
  }

  update(rawDeltaSeconds: number): void {
    if (this.status !== 'PLAYING') return;
    const deltaSeconds = clamp(
      Number.isFinite(rawDeltaSeconds) ? rawDeltaSeconds : 0,
      0,
      PLATFORMER_CONFIG.maxDeltaSeconds,
    );
    if (deltaSeconds <= 0) return;

    this.elapsedSeconds += deltaSeconds;
    const previousBounds = this.player.getBounds();
    this.player.update(deltaSeconds);
    this.resolveGround(previousBounds);

    const playerBounds = this.player.getBounds();
    this.collectItems(playerBounds);
    this.resolveAttackAndEnemy(playerBounds);
    if (this.status !== 'PLAYING') return;
    this.checkFall(playerBounds);
    if (this.status !== 'PLAYING') return;
    this.checkFinish(playerBounds);
  }

  restart(): void {
    this.level = cloneLevel(
      this.customLevel ?? createPlatformerLevel(this.viewportWidth, this.stageHeight),
    );
    this.player = this.createPlayer();
    this.status = 'READY';
    this.score = 0;
    this.collectibles = 0;
    this.elapsedSeconds = 0;
    this.latestMotionEvent = null;
  }

  getState(): PlatformerSnapshot {
    const player = this.player.getState();
    return {
      status: this.status,
      score: this.score,
      collectibles: this.collectibles,
      elapsedSeconds: this.elapsedSeconds,
      distance: Math.max(0, player.x - this.level.startX),
      cameraOffset: Math.max(
        0,
        player.x - this.viewportWidth * PLATFORMER_CONFIG.cameraAnchorRatio,
      ),
      latestMotionEvent: this.latestMotionEvent,
      player,
      level: cloneLevel(this.level),
    };
  }

  private createPlayer(): PlayerController {
    const height = PLATFORMER_CONFIG.playerHeight * this.scale;
    return new PlayerController({
      x: this.level.startX,
      y: this.level.groundY - height,
      scale: this.scale,
    });
  }

  private resolveGround(previousBounds: Rect): void {
    const current = this.player.getBounds();
    const centerX = current.x + current.width / 2;
    const previousBottom = previousBounds.y + previousBounds.height;
    const currentBottom = current.y + current.height;

    if (this.player.getState().grounded) {
      if (!this.hasSupportAt(centerX, currentBottom)) this.player.leaveGround();
      return;
    }

    const surfaces: number[] = [];
    if (!isInGap(this.level.objects, centerX)) surfaces.push(this.level.groundY);
    for (const object of this.level.objects) {
      if (
        object.type === 'PLATFORM' &&
        current.x + current.width > object.x &&
        current.x < object.x + object.width
      ) surfaces.push(object.y);
    }
    surfaces.sort((first, second) => first - second);

    if (this.player.getState().velocityY < 0) return;
    for (const surfaceY of surfaces) {
      if (previousBottom <= surfaceY && currentBottom >= surfaceY) {
        this.player.landOnSurface(surfaceY);
        return;
      }
    }
  }

  private hasSupportAt(centerX: number, bottomY: number): boolean {
    for (const object of this.level.objects) {
      if (
        object.type === 'PLATFORM' &&
        centerX >= object.x &&
        centerX <= object.x + object.width &&
        Math.abs(bottomY - object.y) <= 2
      ) return true;
    }
    return (
      !isInGap(this.level.objects, centerX) &&
      Math.abs(bottomY - this.level.groundY) <= 2
    );
  }

  private collectItems(playerBounds: Rect): void {
    for (const object of this.level.objects) {
      if (object.type !== 'COLLECTIBLE' || object.collected) continue;
      if (circleIntersectsRect(object.x, object.y, object.radius, playerBounds)) {
        object.collected = true;
        this.collectibles += 1;
        this.score += object.value;
      }
    }
  }

  private resolveAttackAndEnemy(playerBounds: Rect): void {
    const hitbox = this.player.getAttackHitbox();
    for (const object of this.level.objects) {
      if (object.type !== 'ENEMY' || object.defeated) continue;
      const enemyBounds = toEnemyRect(object);
      if (hitbox && intersects(hitbox, enemyBounds)) {
        object.defeated = true;
        this.score += PLATFORMER_CONFIG.enemyScore;
        continue;
      }
      if (intersects(playerBounds, enemyBounds)) {
        this.finish('GAME_OVER');
        return;
      }
    }
  }

  private checkFall(playerBounds: Rect): void {
    if (playerBounds.y > this.stageHeight + PLATFORMER_CONFIG.fallResetMargin * this.scale) {
      this.finish('GAME_OVER');
    }
  }

  private checkFinish(playerBounds: Rect): void {
    const finish = this.level.objects.find((object) => object.type === 'FINISH');
    if (
      finish?.type === 'FINISH' &&
      playerBounds.x + playerBounds.width >= finish.x
    ) this.finish('COMPLETE');
  }

  private finish(status: 'COMPLETE' | 'GAME_OVER'): void {
    this.status = status;
    this.player.setRunning(false);
  }
}

function isInGap(objects: PlatformerLevelObject[], x: number): boolean {
  return objects.some(
    (object): object is GapObject =>
      object.type === 'GAP' && x >= object.x && x <= object.x + object.width,
  );
}

function toEnemyRect(enemy: EnemyObject): Rect {
  return { x: enemy.x, y: enemy.y, width: enemy.width, height: enemy.height };
}

function cloneLevel(level: PlatformerLevel): PlatformerLevel {
  return {
    ...level,
    objects: level.objects.map((object) => ({ ...object })),
  };
}
