const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-platformer-'));
let GameController;
let GameInputController;

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
  ], { cwd: projectRoot, stdio: 'inherit' });

  ({ GameController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameController.js')));
  ({ GameInputController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameInputController.js')));

  const tests = [
    ['run accelerates and RUN_STOP decelerates', testRun],
    ['frame delta is clamped after a stall', testDeltaClamp],
    ['pause freezes horizontal progress', testPause],
    ['jump lands and airborne jump is ignored', testJump],
    ['crouch adjusts and restores collision height', testCrouch],
    ['attack defeats enemy only during hit window', testAttackHitWindow],
    ['enemy contact without active attack ends game', testEnemyCollision],
    ['collectible is removed and awards ten points', testCollectible],
    ['gap causes a fall and game over', testGap],
    ['platform supports a falling player', testPlatform],
    ['finish completes level', testFinish],
    ['restart restores the initial game and entities', testRestart],
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
  assert.equal(game.getState().level.objects.find((object) => object.type === 'ENEMY').defeated, true);
  assert.equal(game.getState().score, 25);
  assert.equal(game.getState().player.attackHitActive, true);
}

function testEnemyCollision() {
  const { game, input } = createGame({
    objects: [
      { type: 'ENEMY', id: 'spider', x: 105, y: 261, width: 44, height: 39, defeated: false },
    ],
  });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 40 && game.currentStatus === 'PLAYING'; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'GAME_OVER');
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
  assert.equal(state.level.objects[0].collected, true);
}

function testGap() {
  const { game, input } = createGame({
    objects: [{ type: 'GAP', id: 'gap', x: 90, width: 170 }],
  });
  input.handleDeveloperInput('RUN_START');
  for (let index = 0; index < 100 && game.currentStatus === 'PLAYING'; index += 1) {
    game.update(0.05);
  }
  assert.equal(game.currentStatus, 'GAME_OVER');
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
  assert.equal(state.level.objects[0].collected, false);
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

function createGame({ objects = [] } = {}) {
  const level = {
    worldWidth: 1_200,
    groundY: 300,
    startX: 40,
    objects: objects.map((object) => ({ ...object })),
  };
  const game = new GameController({ viewportWidth: 400, stageHeight: 360, level });
  return { game, input: new GameInputController(game) };
}
