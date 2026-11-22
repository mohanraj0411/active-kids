import type { HorizontalMovement, MotionEvent } from '../../motion/controllerTypes';
import { ChallengeManager, type ChallengeType } from '../adaptive/ChallengeManager';
import { DifficultyManager } from '../adaptive/DifficultyManager';
import { MissionManager, type MissionEvent } from '../adaptive/MissionManager';
import { PerformanceTracker } from '../adaptive/PerformanceTracker';
import { WorldReactionManager } from '../adaptive/WorldReactionManager';
import { PLATFORMER_CONFIG } from './config';
import { circleIntersectsRect, clamp, intersects } from './geometry';
import { createPlatformerLevel } from './level';
import { PlayerController } from './PlayerController';
import type {
  EnemyObject,
  GapObject,
  PlatformerLevel,
  PlatformerLevelObject,
  PlatformerFeedback,
  PlatformerFeedbackType,
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
  private readonly performanceTracker = new PerformanceTracker();
  private readonly difficultyManager = new DifficultyManager();
  private readonly missionManager = new MissionManager();
  private readonly challengeManager = new ChallengeManager();
  private readonly worldReactionManager = new WorldReactionManager();
  private horizontalMovement: HorizontalMovement = { direction: 0, intensity: 0 };
  private readonly level: PlatformerLevel;
  private objects: PlatformerLevelObject[];
  private player: PlayerController;
  private status: PlatformerStatus = 'READY';
  private score = 0;
  private collectibles = 0;
  private stars = 0;
  private hearts: number = PLATFORMER_CONFIG.maxHearts;
  private combo = 0;
  private bestCombo = 0;
  private comboLastActionAt = Number.NEGATIVE_INFINITY;
  private enemiesDefeated = 0;
  private elapsedSeconds = 0;
  private latestMotionEvent: MotionEvent | null = null;
  private checkpointX = 0;
  private feedback: PlatformerFeedback | null = null;
  private feedbackId = 0;
  private respawnSecondsRemaining = 0;
  private invulnerabilitySecondsRemaining = 0;
  private cameraOffset = 0;
  private blockedCrouchGateIndex: number | null = null;
  private difficultyEvaluationInterval = 25;
  private lastDifficultyEvaluationAt = 0;
  private pendingJumpAttemptAt: number | null = null;
  private pendingJumpChallenge = false;
  private pendingJumpChallengeX: number | null = null;
  private pendingAttackChallenge = false;
  private pendingAttackUntil = 0;
  private missionToast: { id: number; title: string; time: number } | null = null;
  private missionToastId = 0;
  private missionBonusStars = 0;
  private bonusStarId = 0;

  constructor(options: GameControllerOptions) {
    this.viewportWidth = Math.max(240, options.viewportWidth);
    this.stageHeight = Math.max(220, options.stageHeight);
    this.scale = Math.max(0.65, this.viewportWidth / PLATFORMER_CONFIG.referenceWidth);
    this.level = createImmutableLevel(options.level ?? createPlatformerLevel(this.viewportWidth, this.stageHeight));
    this.objects = cloneRuntimeObjects(this.level.objects);
    this.checkpointX = this.level.startX;
    this.player = this.createPlayer();
    this.resetAdaptiveSession();
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
    this.releaseInputs();
  }

  releaseInputs(): void {
    this.horizontalMovement = { direction: 0, intensity: 0 };
    this.player.haltHorizontalMotion();
    this.player.setCrouching(false);
  }

  resume(): void {
    if (this.status === 'PAUSED') this.status = 'PLAYING';
  }

  noteMotionEvent(event: MotionEvent): void {
    this.latestMotionEvent = event;
    this.performanceTracker.recordMovementConfidence(event.confidence);
  }

  setRunning(running: boolean): void {
    if (this.status === 'READY' && running) this.start();
    if (this.status !== 'PLAYING') return;
    this.horizontalMovement = { direction: running ? 1 : 0, intensity: running ? 1 : 0 };
    if (!this.isRespawning()) {
      this.player.setHorizontalMovement(this.horizontalMovement.direction, this.horizontalMovement.intensity);
    }
  }

  setHorizontalMovement(movement: HorizontalMovement): void {
    if (this.status !== 'PLAYING') return;
    this.horizontalMovement = { direction: movement.direction, intensity: movement.intensity };
    if (!this.isRespawning()) this.player.setHorizontalMovement(movement.direction, movement.intensity);
  }

  jump(): boolean {
    if (this.status !== 'PLAYING' || this.isRespawning() || !this.player.jump()) return false;
    this.performanceTracker.recordJumpAttempt();
    this.pendingJumpAttemptAt = this.elapsedSeconds;
    this.pendingJumpChallenge = this.beginChallengeAttempt('JUMP');
    this.pendingJumpChallengeX = null;
    if (this.pendingJumpChallenge) {
      this.recordChallengeReactionTime();
      const challenge = this.challengeManager.current;
      const gap = this.level.objects.find((object) =>
        object.type === 'GAP' && object.x === challenge?.targetX,
      );
      if (gap?.type === 'GAP') this.pendingJumpChallengeX = gap.x + gap.width * 0.24;
    }
    const comboBonus = this.recordComboAction();
    this.score += comboBonus;
    if (this.combo > 1) {
      const player = this.player.getState();
      this.setFeedback(
        'COMBO',
        player.x + player.width / 2,
        player.y,
        comboBonus > 0 ? `COMBO x${this.combo}  +${comboBonus}` : `COMBO x${this.combo}`,
      );
    }
    return true;
  }

  attack(): boolean {
    if (this.status !== 'PLAYING' || this.isRespawning() || !this.player.attack()) return false;
    this.performanceTracker.recordAttackAttempt();
    this.pendingAttackChallenge = this.beginChallengeAttempt('ATTACK');
    if (this.pendingAttackChallenge) this.recordChallengeReactionTime();
    this.pendingAttackUntil = this.elapsedSeconds +
      PLATFORMER_CONFIG.attackWindupSeconds +
      PLATFORMER_CONFIG.attackHitWindowSeconds * this.difficultyManager.getModifiers().attackWindowMultiplier +
      PLATFORMER_CONFIG.attackRecoverySeconds + 0.1;
    return true;
  }

  setCrouching(crouching: boolean): void {
    if (this.status !== 'PLAYING' || this.isRespawning()) return;
    this.player.setCrouching(crouching);
    if (crouching && this.beginChallengeAttempt('CROUCH')) this.recordChallengeReactionTime();
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
    this.invulnerabilitySecondsRemaining = Math.max(
      0,
      this.invulnerabilitySecondsRemaining - deltaSeconds,
    );
    if (this.combo > 0 && this.elapsedSeconds - this.comboLastActionAt > PLATFORMER_CONFIG.comboWindowSeconds) {
      this.combo = 0;
      this.performanceTracker.recordCombo(0, this.bestCombo);
    }
    this.updateEnemies(deltaSeconds);
    this.expirePendingAttack();
    this.evaluateDifficultyIfDue();
    if (this.isRespawning()) {
      this.player.update(deltaSeconds);
      this.respawnSecondsRemaining = Math.max(0, this.respawnSecondsRemaining - deltaSeconds);
      if (this.respawnSecondsRemaining === 0) this.respawnAtCheckpoint();
      return;
    }

    const previousBounds = this.player.getBounds();
    const wasGrounded = this.player.getState().grounded;
    this.player.update(deltaSeconds);
    this.resolveGround(previousBounds);
    this.resolveCrouchGates();

    const playerBounds = this.player.getBounds();
    this.markMissedCollectibles(playerBounds);
    this.completeCrouchChallengeIfPassed(playerBounds);
    this.updateCheckpoint(playerBounds.x);
    if (!wasGrounded && this.player.getState().grounded) {
      if (this.pendingJumpAttemptAt !== null) {
        this.performanceTracker.recordJumpSuccess();
        this.performanceTracker.recordReactionTime((this.elapsedSeconds - this.pendingJumpAttemptAt) * 1_000);
        this.recordMissionEvent('JUMP_SUCCESS');
        if (this.pendingJumpChallenge) {
          const clearedChallenge = this.pendingJumpChallengeX == null ||
            playerBounds.x + playerBounds.width >= this.pendingJumpChallengeX;
          this.completeChallenge('JUMP', clearedChallenge);
        }
        this.worldReactionManager.trigger('JUMP', playerBounds.x + playerBounds.width / 2, playerBounds.y, this.elapsedSeconds);
        this.pendingJumpAttemptAt = null;
        this.pendingJumpChallenge = false;
        this.pendingJumpChallengeX = null;
        this.setFeedback('LANDING', playerBounds.x + playerBounds.width / 2, playerBounds.y, 'NICE!');
      } else {
        this.setFeedback('LANDING', playerBounds.x + playerBounds.width / 2, playerBounds.y, 'NICE LANDING!');
      }
    }
    this.collectItems(playerBounds);
    this.resolveAttackAndEnemy(playerBounds);
    if (this.status !== 'PLAYING') return;
    if (this.isRespawning()) return;
    this.checkFall(playerBounds);
    if (this.status !== 'PLAYING') return;
    if (this.isRespawning()) return;
    this.checkFinish(playerBounds);
    this.updateCamera(deltaSeconds);
  }

  restart(): void {
    this.objects = cloneRuntimeObjects(this.level.objects);
    this.player = this.createPlayer();
    this.horizontalMovement = { direction: 0, intensity: 0 };
    this.status = 'READY';
    this.score = 0;
    this.collectibles = 0;
    this.stars = 0;
    this.hearts = PLATFORMER_CONFIG.maxHearts;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboLastActionAt = Number.NEGATIVE_INFINITY;
    this.enemiesDefeated = 0;
    this.elapsedSeconds = 0;
    this.latestMotionEvent = null;
    this.checkpointX = this.level.startX;
    this.feedback = null;
    this.respawnSecondsRemaining = 0;
    this.invulnerabilitySecondsRemaining = 0;
    this.cameraOffset = 0;
    this.blockedCrouchGateIndex = null;
    this.resetAdaptiveSession();
  }

  /** Restarts a fall from the latest safe marker and keeps earned progress. */
  retryFromCheckpoint(): void {
    if (this.status !== 'GAME_OVER') return;
    this.player = this.createPlayer(this.checkpointX);
    this.status = 'READY';
    this.latestMotionEvent = null;
    this.feedback = null;
  }

  getState(): PlatformerSnapshot {
    const player = this.player.getState();
    return {
      status: this.status,
      score: this.score,
      collectibles: this.collectibles,
      stars: this.stars,
      hearts: this.hearts,
      combo: this.combo,
      bestCombo: this.bestCombo,
      enemiesDefeated: this.enemiesDefeated,
      respawning: this.isRespawning(),
      difficulty: this.difficultyManager.current,
      performance: this.performanceTracker.getMetrics(),
      mission: this.missionManager.current,
      missionToast: this.missionToast ? { ...this.missionToast } : null,
      missionBonusStars: this.missionBonusStars,
      missionBonusStarsAvailable: this.missionManager.totalBonusStars,
      challenge: this.challengeManager.current,
      worldReaction: this.worldReactionManager.getReaction(this.elapsedSeconds),
      companion: this.worldReactionManager.getCompanion(
        this.elapsedSeconds,
        player.x - 34 * this.scale,
        this.level.groundY - 32 * this.scale,
      ),
      surprise: this.worldReactionManager.getSurprise(this.elapsedSeconds),
      elapsedSeconds: this.elapsedSeconds,
      distance: Math.max(0, player.x - this.level.startX),
      cameraOffset: this.cameraOffset,
      latestMotionEvent: this.latestMotionEvent,
      feedback: this.feedback,
      player,
      level: this.level,
      objects: this.objects,
    };
  }

  private createPlayer(x = this.level.startX): PlayerController {
    const height = PLATFORMER_CONFIG.playerHeight * this.scale;
    return new PlayerController({
      x,
      y: this.level.groundY - height,
      scale: this.scale,
      minimumX: 0,
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
    for (const object of this.objects) {
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

  private resolveCrouchGates(): void {
    const player = this.player.getState();
    const gates = this.level.crouchGates ?? [];
    if (player.crouching) {
      this.blockedCrouchGateIndex = null;
      return;
    }

    const bounds = this.player.getBounds();
    const gateIndex = gates.findIndex((gate) =>
      bounds.x <= gate.x + gate.width &&
      bounds.x + bounds.width >= gate.x &&
      bounds.y < this.level.groundY - 79 * this.scale &&
      bounds.y + bounds.height > this.level.groundY - 99 * this.scale,
    );
    if (gateIndex < 0) {
      this.blockedCrouchGateIndex = null;
      return;
    }

    const gate = gates[gateIndex];
    const boundaryX = player.velocityX < 0 ? gate.x + gate.width : gate.x - player.width;
    this.player.stopAtHorizontalPosition(boundaryX);
    if (this.blockedCrouchGateIndex !== gateIndex) {
      this.setFeedback('GATE', gate.x + gate.width / 2, this.level.groundY - 95 * this.scale, 'CROUCH TO PASS!');
    }
    this.blockedCrouchGateIndex = gateIndex;
  }

  private hasSupportAt(centerX: number, bottomY: number): boolean {
    for (const object of this.objects) {
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
    for (const object of this.objects) {
      if (object.type !== 'COLLECTIBLE' || object.collected) continue;
      if (circleIntersectsRect(object.x, object.y, object.radius, playerBounds)) {
        object.collected = true;
        this.collectibles += 1;
        if (object.kind !== 'FRUIT') this.stars += 1;
        this.performanceTracker.recordCollectibleCollected();
        if (object.kind !== 'FRUIT') this.recordMissionEvent('STAR_COLLECTED');
        this.completeChallenge('COLLECTIBLE', true);
        this.worldReactionManager.trigger('STAR', object.x, object.y, this.elapsedSeconds, this.combo);
        const comboBonus = this.recordComboAction();
        this.score += object.value + comboBonus;
        this.setFeedback(
          'COLLECTIBLE',
          object.x,
          object.y,
          object.bonus
            ? 'BONUS STAR!'
            : comboBonus > 0
              ? `COMBO x${this.combo}  +${object.value + comboBonus}`
              : `+${object.value}`,
        );
      }
    }
  }

  private resolveAttackAndEnemy(playerBounds: Rect): void {
    const hitbox = this.player.getAttackHitbox();
    for (const object of this.objects) {
      if (object.type !== 'ENEMY' || object.defeated) continue;
      const enemyBounds = toEnemyRect(object);
      if (hitbox && intersects(hitbox, enemyBounds)) {
        object.defeated = true;
        object.state = 'HIT';
        object.hitAt = this.elapsedSeconds;
        this.enemiesDefeated += 1;
        this.performanceTracker.recordAttackSuccess();
        this.recordMissionEvent('ENEMY_DEFEATED');
        this.completeChallenge('ATTACK', true);
        this.pendingAttackChallenge = false;
        this.pendingAttackUntil = 0;
        this.worldReactionManager.trigger('ATTACK', object.x + object.width / 2, object.y, this.elapsedSeconds, this.combo);
        const comboBonus = this.recordComboAction();
        this.score += PLATFORMER_CONFIG.enemyScore + comboBonus;
        this.setFeedback(
          'ENEMY_HIT',
          object.x + object.width / 2,
          object.y,
          comboBonus > 0 ? `COMBO x${this.combo}  +${PLATFORMER_CONFIG.enemyScore + comboBonus}` : 'NICE SWING!',
        );
        continue;
      }
      if (this.invulnerabilitySecondsRemaining <= 0 && intersects(playerBounds, enemyBounds)) {
        this.performanceTracker.recordEnemyCollision(String(Math.round(this.checkpointX)));
        this.startRespawn(object.x + object.width / 2, object.y, 'ENEMY');
        return;
      }
    }
  }

  private checkFall(playerBounds: Rect): void {
    if (playerBounds.y > this.stageHeight + PLATFORMER_CONFIG.fallResetMargin * this.scale) {
      this.startRespawn(playerBounds.x + playerBounds.width / 2, this.stageHeight * 0.7, 'FALL');
    }
  }

  private checkFinish(playerBounds: Rect): void {
    const finish = this.level.objects.find((object) => object.type === 'FINISH');
    if (
      finish?.type === 'FINISH' &&
      playerBounds.x + playerBounds.width >= finish.x
    ) {
      this.setFeedback('FINISH', finish.x, this.level.groundY - 96, 'GREAT JOB!');
      this.finish('COMPLETE');
    }
  }

  private updateCheckpoint(playerX: number): void {
    for (const checkpointX of this.level.checkpoints ?? []) {
      if (checkpointX <= playerX && checkpointX > this.checkpointX) {
        this.checkpointX = checkpointX;
        this.performanceTracker.recordCheckpointReached();
        this.worldReactionManager.trigger('CHECKPOINT', checkpointX, this.level.groundY - 70 * this.scale, this.elapsedSeconds);
      }
    }
  }

  private setFeedback(
    type: PlatformerFeedbackType,
    x: number,
    y: number,
    label: string,
  ): void {
    this.feedback = {
      id: ++this.feedbackId,
      type,
      x,
      y,
      label,
      time: this.elapsedSeconds,
    };
  }

  private finish(status: 'COMPLETE' | 'GAME_OVER'): void {
    this.status = status;
    if (status === 'COMPLETE') this.player.setCelebrating();
    else this.player.setRunning(false);
  }

  private startRespawn(x: number, y: number, reason: 'FALL' | 'ENEMY'): void {
    if (this.isRespawning()) return;
    this.hearts = Math.max(0, this.hearts - 1);
    this.combo = 0;
    this.performanceTracker.recordCombo(0, this.bestCombo);
    if (reason === 'FALL') {
      this.performanceTracker.recordCheckpointFailure(String(Math.round(this.checkpointX)));
      if (this.pendingJumpAttemptAt !== null) this.performanceTracker.recordJumpFailure();
      if (this.pendingJumpChallenge || this.isChallengeNear('JUMP', x)) {
        this.completeChallenge('JUMP', false);
      }
    }
    if (
      reason === 'ENEMY' &&
      (this.pendingAttackChallenge || this.challengeManager.current?.type === 'ATTACK')
    ) this.completeChallenge('ATTACK', false);
    this.pendingJumpAttemptAt = null;
    this.pendingJumpChallenge = false;
    this.pendingJumpChallengeX = null;
    this.pendingAttackChallenge = false;
    this.pendingAttackUntil = 0;
    this.worldReactionManager.trigger('FAIL', x, y, this.elapsedSeconds);
    this.player.setHit();
    this.respawnSecondsRemaining = PLATFORMER_CONFIG.respawnDelaySeconds;
    const repeatedFailures = this.performanceTracker.getFailuresAtCheckpoint(String(Math.round(this.checkpointX)));
    this.setFeedback(
      'RESPAWN',
      x,
      y,
      repeatedFailures >= 3 ? "LET'S TRY THAT AGAIN!" : 'OOPS! TRY AGAIN!',
    );
  }

  private respawnAtCheckpoint(): void {
    this.player = this.createPlayer(this.checkpointX);
    this.player.setAttackHitWindowScale(this.difficultyManager.getModifiers().attackWindowMultiplier);
    this.player.setHorizontalMovement(this.horizontalMovement.direction, this.horizontalMovement.intensity);
    if (this.hearts <= 0) this.hearts = PLATFORMER_CONFIG.maxHearts;
    this.invulnerabilitySecondsRemaining = PLATFORMER_CONFIG.invulnerabilitySeconds;
    this.cameraOffset = clamp(
      this.checkpointX - this.viewportWidth * PLATFORMER_CONFIG.cameraAnchorRatio,
      0,
      Math.max(0, this.level.worldWidth - this.viewportWidth),
    );
    this.setFeedback('RESPAWN', this.checkpointX, this.level.groundY - 96 * this.scale, 'BACK TO THE CHECKPOINT!');
  }

  private recordComboAction(): number {
    this.combo = this.elapsedSeconds - this.comboLastActionAt <= PLATFORMER_CONFIG.comboWindowSeconds
      ? this.combo + 1
      : 1;
    this.comboLastActionAt = this.elapsedSeconds;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.performanceTracker.recordCombo(this.combo, this.bestCombo);
    if (this.combo >= 3) {
      this.recordMissionEvent('COMBO', this.combo);
      this.worldReactionManager.trigger(
        'COMBO',
        this.player.getState().x + this.player.getState().width / 2,
        this.player.getState().y,
        this.elapsedSeconds,
        this.combo,
      );
      if (this.challengeManager.current?.type === 'COMBO') {
        this.completeChallenge('COMBO', this.combo >= 3);
      }
      if (this.combo % 5 === 0) this.spawnBonusStar();
    }
    return this.combo > 1 && this.combo % PLATFORMER_CONFIG.comboRewardEvery === 0
      ? PLATFORMER_CONFIG.comboRewardPoints
      : 0;
  }

  private updateCamera(deltaSeconds: number): void {
    const player = this.player.getState();
    const speedRatio = clamp(player.velocityX / (PLATFORMER_CONFIG.maxRunSpeed * this.scale), 0, 1);
    const target = clamp(
      player.x - this.viewportWidth * PLATFORMER_CONFIG.cameraAnchorRatio +
        this.viewportWidth * PLATFORMER_CONFIG.cameraLookAheadRatio * speedRatio,
      0,
      Math.max(0, this.level.worldWidth - this.viewportWidth),
    );
    const blend = 1 - Math.exp(-PLATFORMER_CONFIG.cameraFollowSpeed * deltaSeconds);
    this.cameraOffset += (target - this.cameraOffset) * blend;
  }

  private updateEnemies(deltaSeconds: number): void {
    for (const object of this.objects) {
      if (object.type !== 'ENEMY') continue;
      if (object.defeated) {
        if (object.hitAt != null && this.elapsedSeconds - object.hitAt >= 0.48) {
          object.state = 'DEFEATED';
        }
        continue;
      }

      const homeX = object.homeX ?? object.x;
      const patrolRange = object.patrolRange ?? 0;
      const patrolSpeed = object.patrolSpeed ?? 0;
      if (patrolRange <= 0 || patrolSpeed <= 0) {
        object.state ??= 'IDLE';
        continue;
      }
      if ((object.idleRemaining ?? 0) > 0) {
        object.idleRemaining = Math.max(0, (object.idleRemaining ?? 0) - deltaSeconds);
        object.state = 'IDLE';
        continue;
      }

      const direction = object.patrolDirection ?? 1;
      const nextX = object.x + direction * patrolSpeed * deltaSeconds;
      const leftLimit = homeX - patrolRange;
      const rightLimit = homeX + patrolRange;
      if (nextX <= leftLimit || nextX >= rightLimit) {
        object.x = clamp(nextX, leftLimit, rightLimit);
        object.patrolDirection = direction === 1 ? -1 : 1;
        object.idleRemaining = 0.18;
        object.state = 'IDLE';
      } else {
        object.x = nextX;
        object.state = 'MOVE';
      }
    }
  }

  private resetAdaptiveSession(): void {
    this.performanceTracker.reset(countCollectibles(this.level));
    this.difficultyManager.reset();
    this.missionManager.reset();
    this.challengeManager.reset();
    this.worldReactionManager.reset();
    this.difficultyEvaluationInterval = 25;
    this.lastDifficultyEvaluationAt = 0;
    this.pendingJumpAttemptAt = null;
    this.pendingJumpChallenge = false;
    this.pendingJumpChallengeX = null;
    this.pendingAttackChallenge = false;
    this.pendingAttackUntil = 0;
    this.missionToast = null;
    this.missionToastId = 0;
    this.missionBonusStars = 0;
    this.bonusStarId = 0;
    this.refreshUpcomingChallenge();
    this.applyDifficultyModifiers();
  }

  private refreshUpcomingChallenge(): void {
    if (this.challengeManager.current) return;
    const playerX = this.player.getState().x;
    const candidates: { type: ChallengeType; x: number }[] = [];
    for (const object of this.objects) {
      if (object.type === 'COLLECTIBLE' && !object.collected && !object.missed) {
        candidates.push({ type: 'COLLECTIBLE', x: object.x });
      } else if (object.type === 'GAP' && object.x + object.width > playerX) {
        candidates.push({ type: 'JUMP', x: object.x });
      } else if (object.type === 'ENEMY' && !object.defeated && object.x + object.width > playerX) {
        candidates.push({ type: 'ATTACK', x: object.x });
      }
    }
    for (const gate of this.level.crouchGates ?? []) {
      if (gate.x + gate.width > playerX) candidates.push({ type: 'CROUCH', x: gate.x + gate.width });
    }
    candidates.sort((first, second) => first.x - second.x);
    const next = candidates[0] ?? { type: 'COMBO' as const, x: playerX + this.viewportWidth };
    this.challengeManager.selectNext(
      next.type,
      next.x,
      this.performanceTracker.getMetrics(),
      this.difficultyManager.current,
      this.elapsedSeconds,
    );
  }

  private beginChallengeAttempt(type: ChallengeType): boolean {
    const challenge = this.challengeManager.current;
    if (
      !challenge ||
      challenge.type !== type ||
      Math.abs(challenge.targetX - this.player.getState().x) > this.viewportWidth * 1.4
    ) return false;
    if (!this.challengeManager.recordAttempt(type)) return false;
    this.performanceTracker.recordChallengeAttempt();
    return true;
  }

  private recordChallengeReactionTime(): void {
    const challenge = this.challengeManager.current;
    if (challenge) {
      this.performanceTracker.recordReactionTime((this.elapsedSeconds - challenge.startedAt) * 1_000);
    }
  }

  private completeChallenge(type: ChallengeType, success: boolean): void {
    const challenge = this.challengeManager.current;
    if (!challenge || challenge.type !== type) return;
    if (challenge.attempts === 0) {
      this.challengeManager.recordAttempt(type);
      this.performanceTracker.recordChallengeAttempt();
      this.recordChallengeReactionTime();
    }
    if (success) {
      if (!this.challengeManager.recordSuccess(type)) return;
      this.performanceTracker.recordChallengeSuccess();
      this.refreshUpcomingChallenge();
    } else {
      this.challengeManager.recordFailure(type);
      this.performanceTracker.recordChallengeFailure();
    }
  }

  private isChallengeNear(type: ChallengeType, x: number): boolean {
    const challenge = this.challengeManager.current;
    return Boolean(
      challenge &&
      challenge.type === type &&
      Math.abs(challenge.targetX - x) <= this.viewportWidth * 1.4,
    );
  }

  private completeCrouchChallengeIfPassed(playerBounds: Rect): void {
    const challenge = this.challengeManager.current;
    if (
      challenge?.type === 'CROUCH' &&
      this.player.getState().crouching &&
      playerBounds.x >= challenge.targetX
    ) {
      this.completeChallenge('CROUCH', true);
    }
  }

  private markMissedCollectibles(playerBounds: Rect): void {
    for (const object of this.objects) {
      if (
        object.type !== 'COLLECTIBLE' ||
        object.collected ||
        object.missed ||
        object.x + object.radius >= playerBounds.x
      ) continue;
      object.missed = true;
      this.performanceTracker.recordCollectibleMissed();
      if (
        this.challengeManager.current?.type === 'COLLECTIBLE' &&
        this.challengeManager.current.targetX <= object.x
      ) {
        this.completeChallenge('COLLECTIBLE', false);
        this.challengeManager.dismissCurrent();
        this.refreshUpcomingChallenge();
      }
    }
  }

  private recordMissionEvent(event: MissionEvent, value = 1): void {
    const completion = this.missionManager.record(event, value);
    if (!completion) return;
    this.score += completion.mission.reward.points;
    this.stars += completion.mission.reward.bonusStars;
    this.missionBonusStars += completion.mission.reward.bonusStars;
    this.missionToast = {
      id: ++this.missionToastId,
      title: completion.mission.title,
      time: this.elapsedSeconds,
    };
    const player = this.player.getState();
    this.worldReactionManager.trigger('MISSION', player.x + player.width / 2, player.y, this.elapsedSeconds);
    this.setFeedback('MISSION', player.x + player.width / 2, player.y, 'MISSION COMPLETE! +1 STAR');
  }

  private spawnBonusStar(): void {
    const player = this.player.getState();
    const star: PlatformerLevelObject = {
      type: 'COLLECTIBLE',
      id: `combo-bonus-star-${++this.bonusStarId}`,
      x: player.x + this.viewportWidth * 0.72,
      y: this.level.groundY - 92 * this.scale,
      radius: 14 * this.scale,
      value: 20,
      kind: 'STAR',
      collected: false,
      bonus: true,
    };
    this.objects.push(star);
    this.objects.sort((first, second) => first.x - second.x);
    this.performanceTracker.recordCollectibleSpawned();
    this.worldReactionManager.trigger('COMBO', star.x, star.y, this.elapsedSeconds, this.combo);
  }

  private expirePendingAttack(): void {
    if (this.pendingAttackUntil <= 0 || this.elapsedSeconds <= this.pendingAttackUntil) return;
    if (this.pendingAttackChallenge) this.completeChallenge('ATTACK', false);
    this.pendingAttackUntil = 0;
    this.pendingAttackChallenge = false;
  }

  private evaluateDifficultyIfDue(): void {
    if (this.elapsedSeconds - this.lastDifficultyEvaluationAt < this.difficultyEvaluationInterval) return;
    this.lastDifficultyEvaluationAt = this.elapsedSeconds;
    this.performanceTracker.evaluateScore();
    this.difficultyManager.evaluate(this.performanceTracker.getMetrics());
    this.applyDifficultyModifiers();
  }

  private applyDifficultyModifiers(): void {
    const modifiers = this.difficultyManager.getModifiers();
    this.player.setAttackHitWindowScale(modifiers.attackWindowMultiplier);
    const playerX = this.player.getState().x;
    for (const object of this.objects) {
      if (object.type !== 'ENEMY' || object.defeated) continue;
      if (object.x <= playerX + this.viewportWidth * 0.75) continue;
      const baseSpeed = object.basePatrolSpeed ?? object.patrolSpeed;
      if (baseSpeed != null) object.patrolSpeed = baseSpeed * modifiers.enemySpeedMultiplier;
    }
  }

  private isRespawning(): boolean {
    return this.respawnSecondsRemaining > 0;
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

function countCollectibles(level: PlatformerLevel): number {
  return level.objects.filter((object) => object.type === 'COLLECTIBLE').length;
}

function createImmutableLevel(level: PlatformerLevel): PlatformerLevel {
  const objects = level.objects.map((object) => Object.freeze({ ...object })) as PlatformerLevelObject[];
  const checkpoints = level.checkpoints ? Object.freeze([...level.checkpoints]) as unknown as number[] : undefined;
  const crouchGates = level.crouchGates
    ? Object.freeze(level.crouchGates.map((gate) => Object.freeze({ ...gate }))) as unknown as { x: number; width: number }[]
    : undefined;
  return Object.freeze({
    ...level,
    objects: Object.freeze(objects) as unknown as PlatformerLevelObject[],
    checkpoints,
    crouchGates,
  });
}

function cloneRuntimeObjects(objects: PlatformerLevelObject[]): PlatformerLevelObject[] {
  return objects.map((object) => ({ ...object }));
}
