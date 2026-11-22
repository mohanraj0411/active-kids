const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
let PerformanceTracker;
let DifficultyManager;
let MissionManager;
let ChallengeManager;
let WorldReactionManager;
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-adaptive-'));

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
    path.join(projectRoot, 'src', 'game', 'adaptive', 'PerformanceTracker.ts'),
    path.join(projectRoot, 'src', 'game', 'adaptive', 'DifficultyManager.ts'),
    path.join(projectRoot, 'src', 'game', 'adaptive', 'MissionManager.ts'),
    path.join(projectRoot, 'src', 'game', 'adaptive', 'ChallengeManager.ts'),
    path.join(projectRoot, 'src', 'game', 'adaptive', 'WorldReactionManager.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' });

  ({ PerformanceTracker } = require(path.join(outputDirectory, 'game', 'adaptive', 'PerformanceTracker.js')));
  ({ DifficultyManager } = require(path.join(outputDirectory, 'game', 'adaptive', 'DifficultyManager.js')));
  ({ MissionManager } = require(path.join(outputDirectory, 'game', 'adaptive', 'MissionManager.js')));
  ({ ChallengeManager } = require(path.join(outputDirectory, 'game', 'adaptive', 'ChallengeManager.js')));
  ({ WorldReactionManager } = require(path.join(outputDirectory, 'game', 'adaptive', 'WorldReactionManager.js')));

  const tests = [
    ['performance tracker records session events and bounds score', testPerformanceTracker],
    ['difficulty uses stable windows and eases struggling players', testDifficulty],
    ['missions progress, reward, advance, and reset', testMissions],
    ['challenge selection adapts tier and failure prompt', testChallenges],
    ['world reactions, companion, and surprises are deterministic', testWorldReactions],
  ];

  for (const [name, test] of tests) {
    test();
    process.stdout.write(`PASS ${name}\n`);
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

function testPerformanceTracker() {
  const tracker = new PerformanceTracker();
  tracker.reset(3);
  tracker.recordJumpAttempt();
  tracker.recordJumpSuccess();
  tracker.recordJumpAttempt();
  tracker.recordJumpFailure();
  tracker.recordAttackAttempt();
  tracker.recordAttackSuccess();
  tracker.recordEnemyCollision('checkpoint-1');
  tracker.recordCollectibleCollected();
  tracker.recordCollectibleMissed();
  tracker.recordCheckpointReached();
  tracker.recordCheckpointFailure('checkpoint-1');
  tracker.recordCombo(5, 5);
  tracker.recordChallengeAttempt();
  tracker.recordChallengeSuccess();
  tracker.recordMovementConfidence(0.9);
  tracker.recordReactionTime(500);

  const metrics = tracker.getMetrics();
  assert.equal(metrics.jumpsAttempted, 2);
  assert.equal(metrics.jumpsSuccessful, 1);
  assert.equal(metrics.jumpsFailed, 1);
  assert.equal(metrics.attacksAttempted, 1);
  assert.equal(metrics.attacksSuccessful, 1);
  assert.equal(metrics.enemyCollisions, 1);
  assert.equal(metrics.collectiblesAvailable, 3);
  assert.equal(metrics.collectiblesCollected, 1);
  assert.equal(metrics.collectiblesMissed, 1);
  assert.equal(metrics.checkpointReached, 1);
  assert.equal(metrics.checkpointDeaths, 2);
  assert.equal(metrics.comboCurrent, 5);
  assert.equal(metrics.comboBest, 5);
  assert.equal(metrics.challengeAttempts, 1);
  assert.equal(metrics.challengeSuccesses, 1);
  assert.equal(metrics.averageReactionTimeMs, 500);
  assert.equal(metrics.movementConfidence, 0.9);
  assert.equal(tracker.getFailuresAtCheckpoint('checkpoint-1'), 2);

  const strugglingTracker = new PerformanceTracker();
  for (let index = 0; index < 100; index += 1) {
    strugglingTracker.recordJumpAttempt();
    strugglingTracker.recordJumpFailure();
    strugglingTracker.evaluateScore();
  }
  const score = strugglingTracker.getMetrics().performanceScore;
  assert.ok(score >= 0 && score <= 100);
  assert.ok(score < 50, 'score should respond smoothly to a sustained run of mistakes');

  const thrivingTracker = new PerformanceTracker();
  thrivingTracker.recordJumpAttempt();
  thrivingTracker.recordJumpSuccess();
  thrivingTracker.recordAttackAttempt();
  thrivingTracker.recordAttackSuccess();
  thrivingTracker.recordCollectibleCollected();
  thrivingTracker.recordChallengeAttempt();
  thrivingTracker.recordChallengeSuccess();
  thrivingTracker.recordCombo(6, 6);
  thrivingTracker.recordMovementConfidence(1);
  for (let index = 0; index < 100; index += 1) {
    const thrivingScore = thrivingTracker.evaluateScore();
    assert.ok(thrivingScore >= 0 && thrivingScore <= 100);
  }
  assert.ok(thrivingTracker.getMetrics().performanceScore < 100, 'score should approach its ceiling without jumping there');
  tracker.reset(1);
  assert.equal(tracker.getMetrics().performanceScore, 50);
  assert.equal(tracker.getMetrics().collectiblesAvailable, 1);
  assert.equal(tracker.getFailuresAtCheckpoint('checkpoint-1'), 0);
}

function testDifficulty() {
  const manager = new DifficultyManager();
  const struggling = metrics({ performanceScore: 20, recentMistakes: 6, recentSuccesses: 0 });
  assert.equal(manager.current, 'NORMAL');
  assert.equal(manager.evaluate(struggling), 'NORMAL', 'one low window must not lower difficulty');
  assert.equal(manager.evaluate(struggling), 'EASY');
  assert.ok(manager.getModifiers().enemySpeedMultiplier < 1);
  assert.ok(manager.getModifiers().attackWindowMultiplier > 1);

  const recovering = metrics({ performanceScore: 55, recentMistakes: 0, recentSuccesses: 2 });
  manager.evaluate(recovering);
  assert.equal(manager.current, 'EASY', 'one recovery window must not immediately change difficulty');
  manager.evaluate(recovering);
  assert.equal(manager.current, 'NORMAL');

  const thriving = metrics({ performanceScore: 90, recentMistakes: 0, recentSuccesses: 8 });
  assert.equal(manager.evaluate(thriving), 'NORMAL', 'one high window must not raise difficulty');
  assert.equal(manager.evaluate(thriving), 'CHALLENGE');
  assert.ok(manager.getModifiers().enemySpeedMultiplier > 1);
  assert.ok(manager.getModifiers().attackWindowMultiplier >= 0.94);

  manager.reset();
  assert.equal(manager.current, 'NORMAL');
  assert.equal(manager.getModifiers().enemySpeedMultiplier, 1);
}

function testMissions() {
  const manager = new MissionManager();
  assert.equal(manager.current.id, 'collect-stars');
  assert.equal(manager.totalBonusStars, 4);
  for (let index = 0; index < 4; index += 1) assert.equal(manager.record('STAR_COLLECTED'), null);
  const completion = manager.record('STAR_COLLECTED');
  assert.equal(completion.mission.completed, true);
  assert.deepEqual(completion.mission.reward, { points: 25, bonusStars: 1 });
  assert.equal(completion.nextMission.id, 'help-friends');
  assert.equal(manager.current.progress, 0);
  manager.reset();
  assert.equal(manager.current.id, 'collect-stars');
  assert.equal(manager.current.progress, 0);
}

function testChallenges() {
  const manager = new ChallengeManager();
  const easy = manager.selectNext('JUMP', 200, metrics({ jumpsAttempted: 4, jumpsSuccessful: 1 }), 'NORMAL', 10);
  assert.equal(easy.tier, 'EASY');
  assert.match(easy.prompt, /take your time/i);

  const normal = manager.selectNext('COLLECTIBLE', 320, metrics(), 'NORMAL', 12);
  assert.equal(normal.tier, 'NORMAL');
  assert.equal(manager.recordAttempt('COLLECTIBLE'), true);
  assert.equal(manager.recordFailure('COLLECTIBLE').failures, 1);
  const softened = manager.recordFailure('COLLECTIBLE');
  assert.equal(softened.tier, 'EASY');
  assert.match(softened.prompt, /try that again/i);

  const advanced = manager.selectNext('ATTACK', 450, metrics({ attacksAttempted: 4, attacksSuccessful: 4 }), 'CHALLENGE', 20);
  assert.equal(advanced.tier, 'ADVANCED');
  assert.match(advanced.title, /^BONUS/);
  assert.equal(manager.recordSuccess('ATTACK'), true);
  assert.equal(manager.current, null);
  manager.reset();
  assert.equal(manager.current, null);
}

function testWorldReactions() {
  const manager = new WorldReactionManager();
  const reaction = manager.trigger('STAR', 100, 200, 3);
  assert.equal(manager.getReaction(3.5).id, reaction.id);
  assert.equal(manager.getReaction(4), null);
  assert.equal(manager.getCompanion(3.5, 50, 120).mood, 'CHEERING');
  assert.equal(manager.getCompanion(5, 50, 120).mood, 'WAITING');
  assert.equal(manager.getSurprise(13.9), null);
  assert.equal(manager.getSurprise(14).type, 'BIRD');
  assert.equal(manager.getSurprise(49).type, 'LEAVES');
  assert.equal(manager.getSurprise(87).type, 'BIRD');
  assert.equal(manager.getSurprise(90), null);
  manager.trigger('MISSION', 100, 200, 8);
  assert.equal(manager.getCompanion(8.1, 50, 120).mood, 'CELEBRATING');
  manager.trigger('FAIL', 100, 200, 9);
  assert.equal(manager.getCompanion(9.1, 50, 120).mood, 'ENCOURAGING');
  manager.reset();
  assert.equal(manager.getReaction(9.1), null);
  assert.equal(manager.getCompanion(9.1, 50, 120).mood, 'WAITING');
}

function metrics(overrides = {}) {
  return { ...new PerformanceTracker().getMetrics(), ...overrides };
}
