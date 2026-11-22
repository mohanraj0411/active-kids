const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-platformer-'));
let GameController;
let GameInputController;
let RuntimePerformanceMeter;
let canStartGame;
let amplifyAssistMovement;
let PerformanceTestHarness;
let PERFORMANCE_TEST_DURATION_MS;

try {
  const compiler = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [
    compiler,
    '--ignoreConfig',
    '--outDir', outputDirectory,
    '--rootDir', path.join(projectRoot, 'src'),
    '--module', 'Node16',
    '--target', 'ES2020',
    '--moduleResolution', 'Node16',
    '--strict',
    '--skipLibCheck',
    path.join(projectRoot, 'src', 'game', 'platformer', 'GameController.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'GameInputController.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'RuntimePerformanceMeter.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'inputModes.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'PerformanceTestHarness.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' });

  ({ GameController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameController.js')));
  ({ GameInputController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameInputController.js')));
  ({ RuntimePerformanceMeter } = require(path.join(outputDirectory, 'game', 'platformer', 'RuntimePerformanceMeter.js')));
  ({ canStartGame, amplifyAssistMovement } = require(path.join(outputDirectory, 'game', 'platformer', 'inputModes.js')));
  ({ PerformanceTestHarness, PERFORMANCE_TEST_DURATION_MS } = require(path.join(outputDirectory, 'game', 'platformer', 'PerformanceTestHarness.js')));

  const tests = [
    ['run accelerates and RUN_STOP decelerates', testRun],
    ['lean movement is analog, bidirectional, and decelerates to neutral', testAnalogLeanMovement],
    ['frame delta is clamped after a stall', testDeltaClamp],
    ['pause freezes horizontal progress', testPause],
    ['jump lands and airborne jump is ignored', testJump],
    ['crouch adjusts and restores collision height', testCrouch],
    ['crouch gate waits for the player to duck before passing', testCrouchGate],
    ['attack defeats enemy only during hit window', testAttackHitWindow],
    ['friendly enemy patrols and enters its defeated state after a hit', testEnemyPatrol],
    ['enemy contact triggers a quick safe respawn', testEnemyCollision],
    ['collectible is removed and awards ten points', testCollectible],
    ['collectibles build a combo and award a milestone bonus', testCollectibleCombo],
    ['a successful jump continues the collectible combo chain', testJumpCombo],
    ['fruit scores without increasing the star count', testFruitCollection],
    ['gap fall triggers a quick respawn without ending the level', testGap],
    ['fall respawn keeps score and uses the latest safe checkpoint', testCheckpointRetry],
    ['platform supports a falling player', testPlatform],
    ['finish completes level', testFinish],
    ['default level targets a two-minute run with 24 collectibles', testDefaultLevelContent],
    ['camera eases toward the player instead of snapping', testCameraSmoothing],
    ['default course can be completed with run, jump, and swing actions', testDefaultCourse],
    ['adaptive mission reward and progress integrate with collectible gameplay', testAdaptiveMissionIntegration],
    ['adaptive challenge completes from gameplay and reports session metrics', testAdaptiveChallengeIntegration],
    ['restart restores the initial game and entities', testRestart],
    ['render snapshots reuse immutable level and runtime object references', testStableRenderSnapshot],
    ['input source switches release controls and reject stale sources', testInputSourceSwitching],
    ['Touch and Assist start without camera state; Body keeps its camera gate', testModeStartRequirements],
    ['Body Assist increases response to small leans', testAssistMovement],
    ['performance metrics distinguish rates without calling RAF render FPS', testMetricNaming],
    ['five-minute performance harness reports measured fields and unavailable values', testPerformanceHarness],
    ['Phase C motion events map to player actions', testMotionIntegration],
  ];

  for (const [name, test] of tests) {
    test();
    process.stdout.write(`PASS ${name}\n`);
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

function testRun() {
  const { game, input } = createGame();
  input.handleDeveloperInput('RUN_START');
  assert.equal(game.currentStatus, 'PLAYING');
  for (let index = 0; index < 20; index += 1) game.update(0.05);
  const running = game.getState();
  assert.ok(running.player.velocityX > 0);
  assert.ok(running.player.x > 40);
  assert.equal(running.player.state, 'RUNNING');

  input.handleDeveloperInput('RUN_STOP');
  for (let index = 0; index < 24; index += 1) game.update(0.05);
  assert.ok(game.getState().player.velocityX < 1);
  assert.ok(game.getState().player.x > running.player.x);
}

function testAnalogLeanMovement() {
  const { game, input } = createGame({ level: {
    worldWidth: 1_200,
    groundY: 300,
    startX: 200,
    objects: [],
  } });
  game.start();
  input.handleHorizontalMovement({ direction: 1, intensity: 0.4 });
  for (let index = 0; index < 16; index += 1) game.update(0.05);
  const right = game.getState().player;
  assert.ok(right.x > 200);
  assert.ok(right.velocityX > 0 && right.velocityX < 235);

  input.handleHorizontalMovement({ direction: -1, intensity: 0.6 });
  for (let index = 0; index < 28; index += 1) game.update(0.05);
  const left = game.getState().player;
  assert.ok(left.x < right.x);
  assert.ok(left.velocityX < 0);

  input.handleHorizontalMovement({ direction: 0, intensity: 0 });
  for (let index = 0; index < 20; index += 1) game.update(0.05);
  assert.ok(Math.abs(game.getState().player.velocityX) < 1);
}

function testDeltaClamp() {
  const { game, input } = createGame();
  input.handleDeveloperInput('RUN_START');
  game.update(10);
  assert.ok(game.getState().player.x < 43);
  assert.ok(game.getState().player.velocityX < 40);
}

function testPause() {
  const { game, input } = createGame();
  input.handleDeveloperInput('RUN_START');
  game.update(0.05);
  game.pause();
  const pausedX = game.getState().player.x;
  game.update(1);
  assert.equal(game.currentStatus, 'PAUSED');
  assert.equal(game.getState().player.x, pausedX);
  game.resume();
  assert.equal(game.currentStatus, 'PLAYING');
  assert.equal(game.getState().player.velocityX, 0);
}

function testJump() {
  const { game, input } = createGame();
  game.start();
  input.handleDeveloperInput('JUMP');
  const takeoff = game.getState().player;
  assert.equal(takeoff.grounded, false);
  assert.equal(takeoff.state, 'JUMPING');
  assert.ok(takeoff.velocityY < 0);
  input.handleDeveloperInput('JUMP');
  assert.equal(game.getState().player.velocityY, takeoff.velocityY);

  for (let index = 0; index < 40; index += 1) game.update(0.05);
  assert.equal(game.getState().player.grounded, true);
  assert.equal(game.getState().player.y + game.getState().player.height, 300);
}

function testCrouch() {
  const { game, input } = createGame();
  game.start();
  input.handleDeveloperInput('CROUCH_START');
  const crouched = game.getState().player;
  assert.equal(crouched.state, 'CROUCHING');
  assert.ok(crouched.height < 100);
  assert.equal(crouched.y + crouched.height, 300);
  input.handleDeveloperInput('CROUCH_END');
  const standing = game.getState().player;
  assert.equal(standing.crouching, false);
  assert.equal(standing.height, 100);
  assert.equal(standing.y + standing.height, 300);
}

function testCrouchGate() {
  const { game } = createGame({
    level: {
      worldWidth: 800,
      groundY: 300,
      startX: 40,
      crouchGates: [{ x: 120, width: 50 }],
      objects: [],
    },
  });
  game.setRunning(true);
  for (let index = 0; index < 40; index += 1) game.update(0.05);
  const blocked = game.getState();
  assert.equal(blocked.feedback.type, 'GATE');
  assert.ok(blocked.player.x + blocked.player.width <= 120);
  assert.equal(blocked.hearts, 3);

  game.setCrouching(true);
  for (let index = 0; index < 25; index += 1) game.update(0.05);
  game.setCrouching(false);
  assert.ok(game.getState().player.x > 170);
}

function testAttackHitWindow() {
  const { game, input } = createGame({
    objects: [
      { type: 'ENEMY', id: 'spider', x: 130, y: 261, width: 44, height: 39, defeated: false },
    ],
  });
  game.start();
  input.handleDeveloperInput('ARM_SWING');
  assert.equal(game.getState().player.attackHitActive, false);
  game.update(0.05);
  game.update(0.05);
  game.update(0.05);
  assert.equal(game.getState().objects.find((object) => object.type === 'ENEMY').defeated, true);
  assert.equal(game.getState().score, 25);
  assert.equal(game.getState().player.attackHitActive, true);
  assert.equal(game.getState().feedback.type, 'ENEMY_HIT');
  assert.equal(game.getState().objects[0].state, 'HIT');
  for (let index = 0; index < 10; index += 1) game.update(0.05);
  assert.equal(game.getState().objects[0].state, 'DEFEATED');
}

function testEnemyPatrol() {
  const game = new GameController({ viewportWidth: 400, stageHeight: 360 });
  const before = game.getState().objects.find((object) => object.type === 'ENEMY');
  const beforeX = before.x;
  assert.equal(before.state, 'MOVE');
  game.start();
  game.update(0.05);
  const after = game.getState().objects.find((object) => object.type === 'ENEMY');
  assert.ok(after.x > beforeX);
  assert.equal(after.state, 'MOVE');
}

function testEnemyCollision() {
  const { game, input } = createGame({
    objects: [
      { type: 'ENEMY', id: 'spider', x: 105, y: 261, width: 44, height: 39, defeated: false },
    ],
  });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 80 && !game.getState().respawning; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'PLAYING');
  assert.equal(game.getState().respawning, true);
  assert.equal(game.getState().player.state, 'HIT');
  assert.equal(game.getState().hearts, 2);
  for (let index = 0; index < 20 && game.getState().respawning; index += 1) game.update(0.05);
  assert.equal(game.getState().respawning, false);
  assert.equal(game.getState().player.x, 40);
  assert.equal(game.getState().hearts, 2);
}

function testCollectible() {
  const { game } = createGame({
    objects: [
      { type: 'COLLECTIBLE', id: 'star', x: 64, y: 250, radius: 15, value: 10, collected: false },
    ],
  });
  game.start();
  game.update(0.05);
  const state = game.getState();
  assert.equal(state.score, 10);
  assert.equal(state.collectibles, 1);
  assert.equal(state.stars, 1);
  assert.equal(state.objects[0].collected, true);
  assert.equal(state.feedback.label, '+10');
}

function testFruitCollection() {
  const { game } = createGame({
    objects: [
      { type: 'COLLECTIBLE', kind: 'FRUIT', id: 'fruit', x: 64, y: 250, radius: 15, value: 10, collected: false },
    ],
  });
  game.start();
  game.update(0.05);
  const state = game.getState();
  assert.equal(state.collectibles, 1);
  assert.equal(state.stars, 0);
  assert.equal(state.score, 10);
}

function testCollectibleCombo() {
  const { game } = createGame({
    objects: [
      { type: 'COLLECTIBLE', id: 'star-one', x: 64, y: 250, radius: 15, value: 10, collected: false },
      { type: 'COLLECTIBLE', id: 'star-two', x: 64, y: 250, radius: 15, value: 10, collected: false },
      { type: 'COLLECTIBLE', id: 'star-three', x: 64, y: 250, radius: 15, value: 10, collected: false },
    ],
  });
  game.start();
  game.update(0.05);
  const state = game.getState();
  assert.equal(state.collectibles, 3);
  assert.equal(state.combo, 3);
  assert.equal(state.bestCombo, 3);
  assert.equal(state.score, 35);
  assert.match(state.feedback.label, /COMBO x3/);
}

function testJumpCombo() {
  const { game } = createGame({
    objects: [
      { type: 'COLLECTIBLE', id: 'jump-star', x: 64, y: 265, radius: 15, value: 10, collected: false },
    ],
  });
  game.start();
  assert.equal(game.jump(), true);
  game.update(0.05);
  assert.equal(game.getState().collectibles, 1);
  assert.equal(game.getState().combo, 2);
  assert.equal(game.getState().bestCombo, 2);
}

function testGap() {
  const { game, input } = createGame({
    objects: [{ type: 'GAP', id: 'gap', x: 90, width: 170 }],
  });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 160 && !game.getState().respawning; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'PLAYING');
  assert.equal(game.getState().respawning, true);
  assert.equal(game.getState().hearts, 2);
  for (let index = 0; index < 20 && game.getState().respawning; index += 1) game.update(0.05);
  assert.equal(game.getState().respawning, false);
  assert.equal(game.getState().player.x, 40);
}

function testCheckpointRetry() {
  const level = {
    worldWidth: 800,
    groundY: 300,
    startX: 40,
    checkpoints: [80],
    objects: [
      { type: 'COLLECTIBLE', id: 'star', x: 64, y: 250, radius: 15, value: 10, collected: false },
      { type: 'GAP', id: 'gap', x: 120, width: 150 },
    ],
  };
  const { game, input } = createGame({ level });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 160 && !game.getState().respawning; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'PLAYING');
  assert.equal(game.getState().respawning, true);
  assert.equal(game.getState().score, 10);
  for (let index = 0; index < 20 && game.getState().respawning; index += 1) game.update(0.05);
  const retried = game.getState();
  assert.equal(retried.status, 'PLAYING');
  assert.equal(retried.player.x, 80);
  assert.equal(retried.score, 10);
  assert.equal(retried.collectibles, 1);
  assert.equal(retried.stars, 1);
  assert.equal(retried.objects[0].collected, true);
}

function testDefaultLevelContent() {
  const game = new GameController({ viewportWidth: 400, stageHeight: 360 });
  const state = game.getState();
  const collectibles = state.objects.filter((object) => object.type === 'COLLECTIBLE');
  const stars = collectibles.filter((object) => object.kind !== 'FRUIT');
  const enemies = state.objects.filter((object) => object.type === 'ENEMY');
  const ids = state.objects.map((object) => object.id);
  assert.equal(collectibles.length, 24);
  assert.equal(stars.length, 24);
  assert.equal(enemies.length, 7);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(state.level.worldWidth / 170 >= 118.5);
}

function testCameraSmoothing() {
  const { game, input } = createGame({
    level: { worldWidth: 1_200, groundY: 300, startX: 40, objects: [] },
  });
  game.start();
  input.handleHorizontalMovement({ direction: 1, intensity: 1 });
  for (let index = 0; index < 25; index += 1) game.update(0.05);
  const state = game.getState();
  const expectedCameraTarget = state.player.x - 400 * 0.3 + 400 * 0.08;
  assert.ok(state.cameraOffset > 0);
  assert.ok(state.cameraOffset < expectedCameraTarget);
}

function testPlatform() {
  const { game, input } = createGame({
    objects: [{ type: 'PLATFORM', id: 'step', x: 32, y: 240, width: 140, height: 14 }],
  });
  game.start();
  input.handleDeveloperInput('JUMP');
  for (let index = 0; index < 40; index += 1) game.update(0.05);
  const player = game.getState().player;
  assert.equal(player.grounded, true);
  assert.equal(player.y + player.height, 240);
}

function testFinish() {
  const { game, input } = createGame({
    objects: [{ type: 'FINISH', id: 'finish', x: 120 }],
  });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 30 && game.currentStatus === 'PLAYING'; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'COMPLETE');
}

function testDefaultCourse() {
  const game = new GameController({ viewportWidth: 400, stageHeight: 360 });
  const input = new GameInputController(game);
  const attackedEnemies = new Set();
  input.handleDeveloperInput('RUN_START');

  for (let index = 0; index < 8_000 && game.currentStatus === 'PLAYING'; index += 1) {
    const state = game.getState();
    const player = state.player;
    const upcomingGap = state.objects.find((object) =>
      object.type === 'GAP' && object.x + object.width > player.x + player.width / 2,
    );
    const upcomingCrouchGate = state.level.crouchGates?.find((gate) => gate.x + gate.width > player.x);
    if (
      upcomingCrouchGate &&
      upcomingCrouchGate.x - (player.x + player.width) < 140 &&
      player.grounded &&
      !player.crouching
    ) {
      input.handleDeveloperInput('CROUCH_START');
    }
    if (upcomingCrouchGate && player.crouching && player.x > upcomingCrouchGate.x + upcomingCrouchGate.width) {
      input.handleDeveloperInput('CROUCH_END');
    }
    if (
      upcomingGap?.type === 'GAP' &&
      player.grounded &&
      upcomingGap.x - player.x < 100 &&
      upcomingGap.x + upcomingGap.width > player.x
    ) {
      input.handleDeveloperInput('JUMP');
    }

    const enemy = state.objects.find((object) =>
      object.type === 'ENEMY' && !object.defeated && !attackedEnemies.has(object.id),
    );
    if (
      enemy?.type === 'ENEMY' &&
      enemy.x - (player.x + player.width) < 100 &&
      enemy.x - (player.x + player.width) > 15
    ) {
      attackedEnemies.add(enemy.id);
      input.handleDeveloperInput('ARM_SWING');
    }
    game.update(1 / 60);
  }

  assert.equal(game.currentStatus, 'COMPLETE');
  assert.equal(attackedEnemies.size, 7);
  assert.ok(game.getState().stars >= 1);
}

function testRestart() {
  const { game, input } = createGame({
    objects: [
      { type: 'COLLECTIBLE', id: 'star', x: 64, y: 250, radius: 15, value: 10, collected: false },
    ],
  });
  game.start();
  game.update(0.05);
  input.handleDeveloperInput('RUN_START');
  game.restart();
  const state = game.getState();
  assert.equal(state.status, 'READY');
  assert.equal(state.score, 0);
  assert.equal(state.collectibles, 0);
  assert.equal(state.player.x, 40);
  assert.equal(state.cameraOffset, 0);
  assert.equal(state.objects[0].collected, false);
  assert.equal(state.difficulty, 'NORMAL');
  assert.equal(state.performance.collectiblesCollected, 0);
  assert.equal(state.mission.id, 'collect-stars');
  assert.equal(state.mission.progress, 0);
  assert.equal(state.missionBonusStars, 0);
  assert.equal(state.worldReaction, null);
}

function testAdaptiveMissionIntegration() {
  const objects = Array.from({ length: 5 }, (_, index) => ({
    type: 'COLLECTIBLE',
    id: `mission-star-${index}`,
    x: 64,
    y: 250,
    radius: 15,
    value: 10,
    collected: false,
  }));
  const { game } = createGame({ objects });
  game.start();
  game.update(0.05);
  const state = game.getState();
  assert.equal(state.performance.collectiblesAvailable, 6, 'combo x5 adds one optional bonus star');
  assert.equal(state.performance.collectiblesCollected, 5);
  assert.equal(state.mission.id, 'help-friends');
  assert.equal(state.missionToast.title, 'STAR SEEKER');
  assert.equal(state.missionBonusStars, 1);
  assert.equal(state.stars, 6);
  assert.ok(state.score >= 75, 'five stars and the mission reward should be scored');
}

function testAdaptiveChallengeIntegration() {
  const { game } = createGame({
    objects: [
      { type: 'COLLECTIBLE', id: 'challenge-star', x: 64, y: 250, radius: 15, value: 10, collected: false },
    ],
  });
  assert.equal(game.getState().challenge.type, 'COLLECTIBLE');
  game.start();
  game.update(0.05);
  const state = game.getState();
  assert.equal(state.performance.challengeAttempts, 1);
  assert.equal(state.performance.challengeSuccesses, 1);
  assert.equal(state.challenge.type, 'COMBO');
  assert.equal(state.worldReaction.type, 'STAR');
  assert.equal(state.companion.mood, 'CHEERING');
}

function testMotionIntegration() {
  const { game, input } = createGame();
  input.handleDeveloperInput('RUN_START');
  assert.equal(game.getState().player.running, true);
  input.handleDeveloperInput('RUN_STOP');
  assert.equal(game.getState().player.running, false);
  input.handleDeveloperInput('JUMP');
  assert.equal(game.getState().player.grounded, false);
  input.handleDeveloperInput('ARM_SWING');
  assert.equal(game.getState().player.attacking, true);
  for (let index = 0; index < 40; index += 1) game.update(0.05);
  input.handleDeveloperInput('CROUCH_START');
  assert.equal(game.getState().player.crouching, true);
  input.handleDeveloperInput('CROUCH_END');
  assert.equal(game.getState().player.crouching, false);
  assert.equal(game.getState().latestMotionEvent.type, 'CROUCH_END');
}

function testStableRenderSnapshot() {
  const level = {
    worldWidth: 1_200,
    groundY: 300,
    startX: 40,
    objects: [
      { type: 'COLLECTIBLE', id: 'star', x: 64, y: 250, radius: 15, value: 10, collected: false },
      { type: 'ENEMY', id: 'spider', x: 500, y: 261, width: 44, height: 39, defeated: false },
    ],
  };
  const game = new GameController({ viewportWidth: 400, stageHeight: 360, level });
  const initial = game.getState();
  const stableLevel = initial.level;
  const stableObjects = initial.objects;
  assert.notEqual(stableObjects[0], stableLevel.objects[0], 'runtime entities are distinct from definitions');
  assert.equal(Object.isFrozen(stableLevel), true);
  assert.equal(Object.isFrozen(stableLevel.objects), true);

  game.start();
  game.update(0.05);
  const after = game.getState();
  assert.equal(after.level, stableLevel, 'geometry reference must be reused');
  assert.equal(after.objects, stableObjects, 'runtime entity list must be reused');
  assert.equal(stableLevel.objects[0].collected, false, 'collection must not mutate level definitions');
  assert.equal(after.objects[0].collected, true, 'collection state belongs to runtime entities');
}

function testInputSourceSwitching() {
  const game = new GameController({
    viewportWidth: 400,
    stageHeight: 300,
    level: { worldWidth: 1_200, groundY: 300, startX: 40, objects: [] },
  });
  const input = new GameInputController(game);
  game.start();
  assert.equal(input.handleHorizontalMovement({ direction: 1, intensity: 1 }, 'BODY'), true);
  assert.equal(game.getState().player.running, true);

  input.selectSource('TOUCH');
  assert.equal(game.getState().player.running, false, 'source change releases stale movement');
  assert.equal(input.handleHorizontalMovement({ direction: 1, intensity: 1 }, 'BODY'), false);
  assert.equal(input.handleHorizontalMovement({ direction: -1, intensity: 0.5 }, 'TOUCH'), true);
  assert.equal(game.getState().player.velocityX, 0, 'new input is accepted but moves on the next simulation step');
  game.update(0.05);
  assert.ok(game.getState().player.velocityX < 0);

  input.selectSource('BODY');
  assert.equal(game.getState().player.running, false, 'touch ownership switch releases held movement');
  assert.equal(input.handleHorizontalMovement({ direction: -1, intensity: 1 }, 'TOUCH'), false);
  assert.equal(input.handleHorizontalMovement({ direction: 1, intensity: 0.5 }, 'BODY'), true);
  game.pause();
  assert.equal(input.handleDeveloperInput('JUMP', 'BODY'), false, 'input is rejected after gameplay pauses');
  assert.equal(game.getState().status, 'PAUSED');
}

function testModeStartRequirements() {
  assert.equal(canStartGame('TOUCH', false, false), true, 'Touch does not inspect camera permission or body framing');
  assert.equal(canStartGame('ASSIST', false, false), true, 'Assist has a playable fallback without camera');
  assert.equal(canStartGame('BODY', false, true), false);
  assert.equal(canStartGame('BODY', true, false), false);
  assert.equal(canStartGame('BODY', true, true), true);
}

function testAssistMovement() {
  assert.deepEqual(amplifyAssistMovement({ direction: 0, intensity: 0 }), { direction: 0, intensity: 0 });
  assert.equal(amplifyAssistMovement({ direction: 1, intensity: 0.25 }).intensity, 0.35);
  assert.equal(amplifyAssistMovement({ direction: -1, intensity: 0.9 }).intensity, 1);
}

function testMetricNaming() {
  const meter = new RuntimePerformanceMeter();
  meter.recordRaf(0);
  meter.recordRaf(16);
  meter.recordSimulation(0.4);
  meter.recordRenderLoop();
  meter.recordReactRender(2);
  const metrics = meter.snapshot(1_000);
  assert.ok('gameRafRateHz' in metrics);
  assert.ok('simulationRateHz' in metrics);
  assert.ok('renderLoopRateHz' in metrics);
  assert.ok('reactCommitRateHz' in metrics);
  assert.equal(Object.keys(metrics).some((key) => key.toLowerCase().includes('fps')), false);
}

function testPerformanceHarness() {
  const harness = new PerformanceTestHarness();
  harness.start({
    device: 'test device',
    os: 'test os',
    osVersion: 'test version',
    ram: 'test ram',
    build: 'development',
    screenResolution: '800x480',
    inputMode: 'TOUCH',
    cameraState: 'OFF',
  }, 1_000);
  const sample = {
    gameRafRateHz: 58,
    simulationRateHz: 60,
    renderLoopRateHz: 58,
    reactCommitRateHz: 58,
    reactRenderMs: 2.5,
    captureRateHz: null,
    poseRateHz: null,
    motionRateHz: null,
    inputLatencyMs: null,
    memoryMb: null,
    skippedPoseFrames: null,
  };
  harness.record(sample, 'N/A');
  harness.record({ ...sample, gameRafRateHz: 55 }, 'warm');
  assert.equal(harness.elapsedMs(2_000), 1_000);
  const report = harness.finish(1_000 + PERFORMANCE_TEST_DURATION_MS);
  assert.equal(report.durationSeconds, 300);
  assert.equal(report.sampleCount, 2);
  assert.equal(report.metrics.gameRafRateHz.average, 56.5);
  assert.equal(report.metrics.poseRateHz, null);
  assert.deepEqual(report.thermalStates, ['warm']);
  assert.equal(harness.finish(301_000), null);
}

function createGame({ objects = [], level: suppliedLevel } = {}) {
  const level = suppliedLevel ?? {
    worldWidth: 1_200,
    groundY: 300,
    startX: 40,
    objects: objects.map((object) => ({ ...object })),
  };
  const game = new GameController({ viewportWidth: 400, stageHeight: 360, level });
  return { game, input: new GameInputController(game) };
}
