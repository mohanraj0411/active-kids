const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-motion-'));
let MotionController;
let BodyLeanController;
let calculateBodyLean;
let MotionProcessingMeter;
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
    path.join(projectRoot, 'src', 'motion', 'MotionController.ts'),
    path.join(projectRoot, 'src', 'motion', 'BodyLeanController.ts'),
    path.join(projectRoot, 'src', 'motion', 'MotionProcessingMeter.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'GameController.ts'),
    path.join(projectRoot, 'src', 'game', 'platformer', 'GameInputController.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' });

  ({ MotionController } = require(path.join(outputDirectory, 'motion', 'MotionController.js')));
  ({ BodyLeanController, calculateBodyLean } = require(path.join(outputDirectory, 'motion', 'BodyLeanController.js')));
  ({ MotionProcessingMeter } = require(path.join(outputDirectory, 'motion', 'MotionProcessingMeter.js')));
  ({ GameController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameController.js')));
  ({ GameInputController } = require(path.join(outputDirectory, 'game', 'platformer', 'GameInputController.js')));
  const tests = [
    ['idle → run → continued run → stop', testRunLifecycle],
    ['jump is one shot until landing', testJumpLifecycle],
    ['fast arm motion emits once and waits for rearm', testArmSwingCooldown],
    ['standing → crouch → standing', testCrouchLifecycle],
    ['low-confidence pose cannot create action events', testLowConfidence],
    ['tracking loss releases active run and crouch inputs', testTrackingLossReleasesInputs],
    ['camera callback watchdog releases held run and crouch', testCameraWatchdogReleasesInputs],
    ['run can coexist with swing and jump events', testCombinedMotions],
    ['body-scale changes preserve run recognition', testBodyScale],
    ['torso-center lean calibration, dead zone, and proportional direction', testBodyLean],
    ['calibration frames do not trigger gameplay actions', testLeanCalibrationOnly],
    ['body-lean geometry is stable at different body scales', testBodyLeanScale],
    ['smoothing suppresses alternating small lean noise', testBodyLeanSmoothing],
    ['lean input safely releases when tracking is lost', testLeanTrackingLoss],
    ['motion-processing timing and rate use deterministic measurements', testMotionProcessingMeter],
    ['irregular frame times use measured deltas', testIrregularTiming],
    ['MotionController events drive all local platformer actions', testLocalGameplayIntegration],
  ];

  for (const [name, test] of tests) {
    test();
    process.stdout.write(`PASS ${name}\n`);
  }
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}

function testRunLifecycle() {
  const controller = new MotionController();
  let timestamp = 1_000;
  const emitted = [];
  for (let index = 0; index < 45; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp, { runTimeMs: index * 100 })));
  }
  assert.equal(controller.state, 'RUN');
  assert.equal(emitted.filter((event) => event.type === 'RUN_START').length, 1);
  assert.ok(controller.getDebugInfo().run.windowSamples <= 24);

  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  assert.equal(controller.state, 'IDLE');
  assert.equal(emitted.filter((event) => event.type === 'RUN_STOP').length, 1);
}

function testJumpLifecycle() {
  const controller = new MotionController();
  let timestamp = 2_000;
  const emitted = [];
  for (let index = 0; index < 9; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  for (const lift of [0.24, 0.31, 0.34, 0.34]) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp, { jumpLiftScale: lift })));
  }
  assert.equal(emitted.filter((event) => event.type === 'JUMP').length, 1);
  assert.equal(controller.getDebugInfo().jump.phase, 'AIRBORNE');

  for (let index = 0; index < 9; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  assert.equal(emitted.filter((event) => event.type === 'JUMP').length, 1);
  assert.equal(controller.getDebugInfo().jump.phase, 'GROUNDED');
}

function testArmSwingCooldown() {
  const controller = new MotionController();
  let timestamp = 3_000;
  const emitted = [];
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  timestamp += 100;
  emitted.push(...controller.update(makePose(timestamp, { leftArmSwingScale: 0.48 })));
  for (let index = 0; index < 10; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp, { leftArmSwingScale: 0.48 })));
  }
  assert.equal(emitted.filter((event) => event.type === 'ARM_SWING').length, 1);
}

function testCrouchLifecycle() {
  const controller = new MotionController();
  let timestamp = 4_000;
  const emitted = [];
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp, { crouch: true })));
  }
  assert.equal(controller.state, 'CROUCH');
  assert.equal(emitted.filter((event) => event.type === 'CROUCH_START').length, 1);
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    emitted.push(...controller.update(makePose(timestamp)));
  }
  assert.equal(controller.state, 'IDLE');
  assert.equal(emitted.filter((event) => event.type === 'CROUCH_END').length, 1);
}

function testLowConfidence() {
  const controller = new MotionController();
  let timestamp = 5_000;
  for (let index = 0; index < 6; index += 1) {
    timestamp += 100;
    controller.update(makePose(timestamp));
  }
  const invalidEvents = controller.update(makePose(timestamp + 100, {
    confidence: 0.2,
    runTimeMs: 400,
    jumpLiftScale: 0.5,
    leftArmSwingScale: 0.6,
    crouch: true,
  }));
  assert.deepEqual(invalidEvents, []);
  assert.equal(controller.state, 'IDLE');

  const lowWrist = makePose(timestamp + 200, {
    leftArmSwingScale: 0.6,
    leftWristConfidence: 0.2,
  });
  assert.equal(controller.update(lowWrist).some((event) => event.type === 'ARM_SWING'), false);

  const lowLegs = makePose(timestamp + 300, {
    runTimeMs: 500,
    jumpLiftScale: 0.6,
  });
  for (const name of ['leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle']) {
    lowLegs.landmarks[name].confidence = 0.2;
  }
  const lowLegEvents = controller.update(lowLegs);
  assert.equal(lowLegEvents.some((event) => event.type === 'RUN_START' || event.type === 'JUMP'), false);
}

function testTrackingLossReleasesInputs() {
  const runningController = new MotionController();
  let timestamp = 5_400;
  for (let index = 0; index < 45; index += 1) {
    timestamp += 100;
    runningController.update(makePose(timestamp, { runTimeMs: index * 100 }));
  }
  assert.equal(runningController.state, 'RUN');

  const runLossEvents = [];
  for (let index = 0; index < 11; index += 1) {
    timestamp += 100;
    const lostPose = makePose(timestamp);
    lostPose.detected = false;
    lostPose.confidence = 0;
    runLossEvents.push(...runningController.update(lostPose));
  }
  assert.equal(runLossEvents.filter((event) => event.type === 'RUN_STOP').length, 1);
  assert.equal(runningController.state, 'IDLE');

  const crouchingController = new MotionController();
  timestamp += 100;
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    crouchingController.update(makePose(timestamp));
  }
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    crouchingController.update(makePose(timestamp, { crouch: true }));
  }
  assert.equal(crouchingController.state, 'CROUCH');

  const crouchLossEvents = [];
  for (let index = 0; index < 11; index += 1) {
    timestamp += 100;
    const lostPose = makePose(timestamp);
    lostPose.detected = false;
    lostPose.confidence = 0;
    crouchLossEvents.push(...crouchingController.update(lostPose));
  }
  assert.equal(crouchLossEvents.filter((event) => event.type === 'CROUCH_END').length, 1);
  assert.equal(crouchingController.state, 'IDLE');
}

function testCameraWatchdogReleasesInputs() {
  const runningController = new MotionController();
  let timestamp = 5_400;
  for (let index = 0; index < 45; index += 1) {
    timestamp += 100;
    runningController.update(makePose(timestamp, { runTimeMs: index * 100 }));
  }
  assert.equal(runningController.state, 'RUN');
  assert.ok(runningController.expireTracking(timestamp + 350).some((event) => event.type === 'RUN_STOP'));
  assert.equal(runningController.state, 'IDLE');
  assert.equal(runningController.bodyLeanState.direction, 0);

  const crouchingController = new MotionController();
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    crouchingController.update(makePose(timestamp));
  }
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    crouchingController.update(makePose(timestamp, { crouch: true }));
  }
  assert.equal(crouchingController.state, 'CROUCH');
  assert.ok(crouchingController.expireTracking(timestamp + 350).some((event) => event.type === 'CROUCH_END'));
  assert.equal(crouchingController.state, 'IDLE');
}

function testCombinedMotions() {
  const controller = new MotionController();
  let timestamp = 5_500;
  const events = [];
  for (let index = 0; index < 45; index += 1) {
    timestamp += 100;
    events.push(...controller.update(makePose(timestamp, { runTimeMs: index * 100 })));
  }
  assert.equal(controller.state, 'RUN');

  timestamp += 100;
  const swingEvents = controller.update(makePose(timestamp, {
    runTimeMs: 4_500,
    leftArmSwingScale: 0.48,
  }));
  assert.ok(swingEvents.some((event) => event.type === 'ARM_SWING'));
  assert.equal(controller.state, 'RUN');

  timestamp += 100;
  const jumpEvents = controller.update(makePose(timestamp, { jumpLiftScale: 0.24 }));
  assert.ok(jumpEvents.some((event) => event.type === 'JUMP'));
  for (let index = 0; index < 5; index += 1) {
    timestamp += 100;
    controller.update(makePose(timestamp, { jumpLiftScale: 0.32 }));
  }
  assert.equal(controller.state, 'RUN');
}

function testBodyScale() {
  for (const bodyScale of [0.55, 1, 1.8]) {
    const controller = new MotionController();
    let timestamp = 6_000;
    let runStarted = false;
    for (let index = 0; index < 45; index += 1) {
      timestamp += 100;
      const events = controller.update(makePose(timestamp, {
        bodyScale,
        runTimeMs: index * 100,
      }));
      runStarted ||= events.some((event) => event.type === 'RUN_START');
    }
    assert.equal(runStarted, true, `run should be recognized at body scale ${bodyScale}`);
  }
}

function testBodyLean() {
  const controller = calibratedLeanController(5);
  let timestamp = 2_000;
  for (let index = 0; index < 5; index += 1) {
    timestamp += 100;
    const neutral = controller.update(makeLeanPose(timestamp, 5));
    assert.equal(neutral.direction, 0);
    assert.equal(neutral.intensity, 0);
  }

  let left;
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    left = controller.update(makeLeanPose(timestamp, -18));
  }
  assert.equal(left.direction, -1);
  assert.ok(left.intensity > 0.35 && left.intensity < 1);

  let right;
  for (let index = 0; index < 9; index += 1) {
    timestamp += 100;
    right = controller.update(makeLeanPose(timestamp, 34));
  }
  assert.equal(right.direction, 1);
  assert.equal(right.intensity, 1);
  assert.equal(right.calibrated, true);
}

function testBodyLeanScale() {
  const regular = calculateBodyLean(makeLeanPose(1_000, 17, 1));
  const small = calculateBodyLean(makeLeanPose(1_000, 17, 0.58));
  const large = calculateBodyLean(makeLeanPose(1_000, 17, 1.45));
  assert.ok(regular && small && large);
  assert.ok(Math.abs(regular.angleDegrees - small.angleDegrees) < 0.1);
  assert.ok(Math.abs(regular.angleDegrees - large.angleDegrees) < 0.1);
}

function testLeanCalibrationOnly() {
  const controller = new MotionController();
  controller.beginNeutralCalibration();
  for (let index = 0; index < 12; index += 1) {
    controller.updateCalibrationPose(makePose(8_000 + index * 100, {
      runTimeMs: index * 100,
      jumpLiftScale: 0.5,
      leftArmSwingScale: 0.7,
      crouch: true,
    }));
  }
  assert.equal(controller.state, 'IDLE');
  assert.equal(controller.bodyLeanState.calibrating, true);
  assert.equal(controller.bodyLeanState.direction, 0);
  assert.equal(controller.completeNeutralCalibration().calibrating, false);
}

function testBodyLeanSmoothing() {
  const controller = calibratedLeanController(0);
  let timestamp = 2_000;
  controller.update(makeLeanPose(timestamp, 0));
  for (const angle of [12, -12, 12, -12, 12, -12, 12, -12]) {
    timestamp += 100;
    const state = controller.update(makeLeanPose(timestamp, angle));
    assert.equal(state.direction, 0);
  }
}

function testLeanTrackingLoss() {
  const controller = calibratedLeanController(0);
  let timestamp = 2_000;
  let state;
  for (let index = 0; index < 10; index += 1) {
    timestamp += 100;
    state = controller.update(makeLeanPose(timestamp, 34));
  }
  assert.equal(state.direction, 1);
  state = controller.update(makeLostPose(timestamp + 100));
  assert.equal(state.direction, 1);
  state = controller.update(makeLostPose(timestamp + 351));
  assert.equal(state.direction, 0);
  assert.equal(state.intensity, 0);
}

function testMotionProcessingMeter() {
  const meter = new MotionProcessingMeter();
  meter.record(100, 102);
  meter.record(200, 205);
  meter.record(300, 304);
  assert.deepEqual(meter.snapshot(400), {
    sampleCount: 3,
    rateHz: 3_000 / 298,
    averageMs: 11 / 3,
    maximumMs: 5,
  });
  meter.record(400, 399);
  assert.equal(meter.snapshot(450).sampleCount, 3);
}

function calibratedLeanController(neutralAngle) {
  const controller = new BodyLeanController();
  controller.beginCalibration();
  for (let index = 0; index < 8; index += 1) {
    controller.update(makeLeanPose(1_000 + index * 100, neutralAngle));
  }
  assert.equal(controller.completeCalibration().calibrated, true);
  return controller;
}

function makeLeanPose(timestamp, angleDegrees, bodyScale = 1) {
  const imageSize = { width: 1_280, height: 720 };
  const torsoPixels = 180 * bodyScale;
  const radians = angleDegrees * Math.PI / 180;
  const hipCenterX = 0.5;
  const hipCenterY = 0.68;
  const shoulderCenterX = hipCenterX + Math.sin(radians) * torsoPixels / imageSize.width;
  const shoulderCenterY = hipCenterY - Math.cos(radians) * torsoPixels / imageSize.height;
  const score = 0.98;
  return {
    timestamp,
    confidence: score,
    detected: true,
    imageSize,
    landmarks: {
      leftShoulder: { x: shoulderCenterX - 0.06 * bodyScale, y: shoulderCenterY, confidence: score },
      rightShoulder: { x: shoulderCenterX + 0.06 * bodyScale, y: shoulderCenterY, confidence: score },
      leftHip: { x: hipCenterX - 0.045 * bodyScale, y: hipCenterY, confidence: score },
      rightHip: { x: hipCenterX + 0.045 * bodyScale, y: hipCenterY, confidence: score },
    },
  };
}

function makeLostPose(timestamp) {
  return { timestamp, confidence: 0, detected: false, landmarks: {} };
}

function testIrregularTiming() {
  const controller = new MotionController();
  let timestamp = 7_000;
  const intervals = [33, 67, 50, 100];
  let runStarted = false;
  for (let index = 0; index < 90; index += 1) {
    const delta = intervals[index % intervals.length];
    timestamp += delta;
    const events = controller.update(makePose(timestamp, {
      runTimeMs: timestamp - 7_000,
    }));
    runStarted ||= events.some((event) => event.type === 'RUN_START');
  }
  assert.equal(runStarted, true);
  assert.equal(controller.state, 'RUN');
}

function testLocalGameplayIntegration() {
  const motion = new MotionController();
  const game = new GameController({ viewportWidth: 800, stageHeight: 450 });
  const input = new GameInputController(game);
  const seenEvents = new Set();
  let timestamp = 8_000;
  const feedPose = (pose) => {
    for (const event of motion.update(pose)) {
      seenEvents.add(event.type);
      input.handleMotionEvent(event);
    }
  };

  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  for (let index = 0; index < 45; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp, { runTimeMs: index * 100 }));
  }
  assert.equal(game.currentStatus, 'PLAYING');
  assert.equal(game.getState().player.running, true);

  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  assert.equal(game.getState().player.running, false);

  motion.reset();
  for (let index = 0; index < 9; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  for (const lift of [0.24, 0.31, 0.34, 0.34]) {
    timestamp += 100;
    feedPose(makePose(timestamp, { jumpLiftScale: lift }));
  }
  assert.equal(game.getState().player.grounded, false);
  assert.equal(game.getState().player.state, 'JUMPING');

  motion.reset();
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  timestamp += 100;
  feedPose(makePose(timestamp, { leftArmSwingScale: 0.48 }));
  for (let index = 0; index < 10; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp, { leftArmSwingScale: 0.48 }));
  }
  assert.equal(game.getState().player.attacking, true);

  for (let index = 0; index < 35; index += 1) game.update(0.05);
  motion.reset();
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp, { crouch: true }));
  }
  assert.equal(game.getState().player.crouching, true);
  for (let index = 0; index < 8; index += 1) {
    timestamp += 100;
    feedPose(makePose(timestamp));
  }
  assert.equal(game.getState().player.crouching, false);

  for (const event of ['RUN_START', 'RUN_STOP', 'JUMP', 'ARM_SWING', 'CROUCH_START', 'CROUCH_END']) {
    assert.equal(seenEvents.has(event), true, `${event} should travel through the local pipeline`);
  }
}

function makePose(timestamp, options = {}) {
  const {
    bodyScale = 1,
    runTimeMs = null,
    jumpLiftScale = 0,
    leftArmSwingScale = 0,
    crouch = false,
    confidence = 0.95,
    leftWristConfidence = confidence,
  } = options;
  const point = (x, y) => ({ x: 0.5 + (x - 0.5) * bodyScale, y: 0.5 + (y - 0.5) * bodyScale, confidence });
  const landmarks = {
    nose: point(0.5, 0.16),
    leftShoulder: point(0.39, 0.25),
    rightShoulder: point(0.61, 0.25),
    leftElbow: point(0.34, 0.38),
    rightElbow: point(0.66, 0.38),
    leftWrist: point(0.37 + leftArmSwingScale * 0.22, 0.47),
    rightWrist: point(0.63, 0.47),
    leftHip: point(0.44, 0.53 - jumpLiftScale * 0.22),
    rightHip: point(0.56, 0.53 - jumpLiftScale * 0.22),
    leftKnee: point(0.43, 0.72 - jumpLiftScale * 0.22),
    rightKnee: point(0.57, 0.72 - jumpLiftScale * 0.22),
    leftAnkle: point(0.42, 0.91 - jumpLiftScale * 0.22),
    rightAnkle: point(0.58, 0.91 - jumpLiftScale * 0.22),
  };

  if (runTimeMs !== null) {
    const cycle = (runTimeMs / 500) * Math.PI * 2;
    const leftLift = Math.sin(cycle) * 0.23;
    const rightLift = -leftLift;
    landmarks.leftKnee = point(0.43, 0.72 - leftLift * 0.22);
    landmarks.rightKnee = point(0.57, 0.72 - rightLift * 0.22);
    landmarks.leftAnkle = point(0.42, 0.91 - leftLift * 0.22 * 0.65);
    landmarks.rightAnkle = point(0.58, 0.91 - rightLift * 0.22 * 0.65);
  }

  if (crouch) {
    landmarks.leftShoulder = point(0.39, 0.28);
    landmarks.rightShoulder = point(0.61, 0.28);
    landmarks.leftHip = point(0.44, 0.58);
    landmarks.rightHip = point(0.56, 0.58);
    landmarks.leftKnee = point(0.39, 0.68);
    landmarks.rightKnee = point(0.61, 0.68);
    landmarks.leftAnkle = point(0.42, 0.91);
    landmarks.rightAnkle = point(0.58, 0.91);
  }

  landmarks.leftWrist.confidence = leftWristConfidence;

  return { timestamp, landmarks, confidence, detected: true };
}
