const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-motion-'));
let MotionController;

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
  ], { cwd: projectRoot, stdio: 'inherit' });

  ({ MotionController } = require(path.join(outputDirectory, 'motion', 'MotionController.js')));
  const tests = [
    ['idle → run → continued run → stop', testRunLifecycle],
    ['jump is one shot until landing', testJumpLifecycle],
    ['fast arm motion emits once and waits for rearm', testArmSwingCooldown],
    ['standing → crouch → standing', testCrouchLifecycle],
    ['low-confidence pose cannot create action events', testLowConfidence],
    ['tracking loss releases active run and crouch inputs', testTrackingLossReleasesInputs],
    ['run can coexist with swing and jump events', testCombinedMotions],
    ['body-scale changes preserve run recognition', testBodyScale],
    ['irregular frame times use measured deltas', testIrregularTiming],
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
