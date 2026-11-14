const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-network-'));
let network;
let NetworkManager;
let PhoneController;
let TVController;
let GameController;
let GameInputController;
let normalizeWebSocketUrl;
let getWebSocketUrlFromWebPage;
let protocol;

async function main() {
  compileSources();
  loadSources();
  const cases = [
    ['valid HELLO, WELCOME, and INPUT messages parse', testValidProtocolMessages],
    ['manual pairing accepts LAN hosts and rejects internet hosts', testNetworkAddressValidation],
    ['malformed JSON, unknown types, and unsupported versions reject', testProtocolRejections],
    ['connection states, handshake, sequence, heartbeat, and reconnect backoff', testManagerLifecycle],
    ['TV rejects duplicate, stale, and wrong-session input', testTVInputProtection],
    ['all six motion events forward to GameInputController', testAllMotionEventsForward],
    ['peer loss and missed heartbeat release RUN and CROUCH', testTVSafetyRelease],
    ['phone input traverses the real local WebSocket relay into the platformer', testLoopbackIntegration],
  ];

  for (const [name, test] of cases) {
    await test();
    process.stdout.write(`PASS ${name}\n`);
  }
}

function compileSources() {
  const compiler = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [
    compiler,
    '--ignoreConfig',
    '--outDir', outputDirectory,
    '--rootDir', path.join(projectRoot, 'src'),
    '--module', 'Node16',
    '--target', 'ES2020',
    '--moduleResolution', 'Node16',
    '--lib', 'ES2020,DOM',
    '--strict',
    '--skipLibCheck',
    path.join(projectRoot, 'src', 'network', 'protocol.ts'),
    path.join(projectRoot, 'src', 'network', 'address.ts'),
    path.join(projectRoot, 'src', 'network', 'NetworkManager.ts'),
    path.join(projectRoot, 'src', 'network', 'PhoneController.ts'),
    path.join(projectRoot, 'src', 'network', 'TVController.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' });
}

function loadSources() {
  const source = (name) => require(path.join(outputDirectory, name));
  protocol = source('network/protocol.js');
  ({ NetworkManager } = source('network/NetworkManager.js'));
  ({ PhoneController } = source('network/PhoneController.js'));
  ({ TVController } = source('network/TVController.js'));
  ({ GameController } = source('game/platformer/GameController.js'));
  ({ GameInputController } = source('game/platformer/GameInputController.js'));
  ({ normalizeWebSocketUrl, getWebSocketUrlFromWebPage } = source('network/address.js'));
  network = require(path.join(projectRoot, 'scripts', 'network-host.cjs'));
}

function testValidProtocolMessages() {
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(hello('TV_HOST'))).ok, true);
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(welcome('TV_HOST', 'session-a'))).ok, true);
  const input = makeInput('session-a', 1, 'RUN_START');
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(input)).ok, true);
}

function testNetworkAddressValidation() {
  assert.equal(normalizeWebSocketUrl('192.168.1.42'), 'ws://192.168.1.42:8765/ws');
  assert.equal(normalizeWebSocketUrl('http://10.0.0.12:9000'), 'ws://10.0.0.12:9000/ws');
  assert.equal(normalizeWebSocketUrl('tv.local'), 'ws://tv.local:8765/ws');
  assert.equal(normalizeWebSocketUrl('ws://8.8.8.8:8765/ws'), null);
  assert.equal(normalizeWebSocketUrl('wss://public.example.com/ws'), null);

  const previousWindow = globalThis.window;
  globalThis.window = { location: { hostname: '192.168.1.42', host: '192.168.1.42:8081', port: '8081', protocol: 'http:' } };
  assert.equal(getWebSocketUrlFromWebPage(), null);
  globalThis.window.location = { hostname: '192.168.1.42', host: '192.168.1.42:8765', port: '8765', protocol: 'http:' };
  assert.equal(getWebSocketUrlFromWebPage(), 'ws://192.168.1.42:8765/ws');
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}

function testProtocolRejections() {
  assert.deepEqual(protocol.parseNetworkMessage('{'), { ok: false, reason: 'INVALID_JSON' });
  assert.deepEqual(protocol.parseNetworkMessage(JSON.stringify({ type: 'ALIEN', protocolVersion: 1 })), {
    ok: false,
    reason: 'INVALID_SHAPE',
  });
  assert.deepEqual(protocol.parseNetworkMessage(JSON.stringify({ type: 'HELLO', protocolVersion: 77 })), {
    ok: false,
    reason: 'UNSUPPORTED_PROTOCOL',
  });
  assert.equal(protocol.parseNetworkMessage(JSON.stringify({ ...makeInput('session-a', 0, 'JUMP') })).ok, false);
  assert.equal(protocol.parseNetworkMessage(JSON.stringify({ ...makeInput('session-a', 1, 'JUMP'), motion: 'RUN' })).ok, false);
}

function testManagerLifecycle() {
  const scheduler = new FakeScheduler();
  const sockets = [];
  const manager = new NetworkManager('ws://tv.local:8765/ws', 'PHONE_CONTROLLER', {
    scheduler,
    clientId: 'phone-test',
    socketFactory: (url) => {
      assert.equal(url, 'ws://tv.local:8765/ws');
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const states = [];
  manager.subscribe((snapshot) => states.push(snapshot.state));

  manager.connect();
  assert.equal(manager.getSnapshot().state, 'CONNECTING');
  sockets[0].open();
  assert.equal(sockets[0].sent[0].type, 'HELLO');
  sockets[0].receive(welcome('PHONE_CONTROLLER', 'session-a'));
  assert.equal(manager.getSnapshot().state, 'CONNECTED');
  assert.equal(manager.sendInput(createMotionEvent('RUN_START', scheduler.now(), 0.9)), 1);
  assert.equal(sockets[0].sent.at(-1).sequence, 1);

  scheduler.advance(1_000);
  const heartbeat = sockets[0].sent.at(-1);
  assert.equal(heartbeat.type, 'HEARTBEAT');
  sockets[0].receive({
    type: 'HEARTBEAT_ACK',
    protocolVersion: 1,
    sessionId: 'session-a',
    timestamp: heartbeat.timestamp,
    serverTimestamp: scheduler.now(),
    role: 'PHONE_CONTROLLER',
  });
  assert.equal(manager.getSnapshot().latencyMs, 0);

  sockets[0].close(1006, 'test disconnect');
  assert.equal(manager.getSnapshot().state, 'RECONNECTING');
  scheduler.advance(499);
  assert.equal(sockets.length, 1);
  scheduler.advance(1);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].receive(welcome('PHONE_CONTROLLER', 'session-b'));
  assert.equal(manager.getSnapshot().state, 'CONNECTED');
  assert.equal(manager.getSnapshot().nextSequence, 1);

  scheduler.advance(4_000);
  assert.equal(sockets[1].readyState, 3);
  assert.equal(manager.getSnapshot().state, 'RECONNECTING');
  assert.ok(states.includes('RECONNECTING'));
  manager.disconnect('test complete');
  assert.equal(manager.getSnapshot().state, 'DISCONNECTED');
}

function testTVInputProtection() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const received = [];
  const gameInput = {
    handleMotionEvent: (event) => received.push(event),
    handleDeveloperInput: (type) => received.push(createMotionEvent(type, scheduler.now(), 1)),
  };
  const controller = new TVController(manager, gameInput, {
    scheduler,
    onChange: () => undefined,
  });
  connectTV(socket);

  socket.receive(makeInput('session-a', 1, 'RUN_START'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  socket.receive(makeInput('session-a', 1, 'RUN_STOP'));
  socket.receive(makeInput('session-a', 0, 'JUMP'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  socket.receive(makeInput('old-session', 2, 'JUMP'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  controller.dispose();
  manager.disconnect();
}

function testAllMotionEventsForward() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const received = [];
  const gameInput = {
    handleMotionEvent: (event) => received.push(event),
    handleDeveloperInput: (type) => received.push(createMotionEvent(type, scheduler.now(), 1)),
  };
  const controller = new TVController(manager, gameInput, { scheduler });
  connectTV(socket);
  const eventTypes = ['RUN_START', 'RUN_STOP', 'JUMP', 'ARM_SWING', 'CROUCH_START', 'CROUCH_END'];
  eventTypes.forEach((type, index) => socket.receive(makeInput('session-a', index + 1, type)));
  assert.deepEqual(received.map((event) => event.type), eventTypes);
  assert.deepEqual(received.map((event) => event.motion), ['RUN', 'RUN', 'JUMP', 'ARM_SWING', 'CROUCH', 'CROUCH']);
  assert.equal(controller.getSnapshot().lastSequence, 6);
  controller.dispose();
  manager.disconnect();
}

function testTVSafetyRelease() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const received = [];
  const gameInput = {
    handleMotionEvent: (event) => received.push(event),
    handleDeveloperInput: (type) => received.push(createMotionEvent(type, scheduler.now(), 1)),
  };
  const controller = new TVController(manager, gameInput, {
    scheduler,
    heartbeatTimeoutMs: 2_000,
  });
  connectTV(socket);

  socket.receive(makeInput('session-a', 1, 'RUN_START'));
  socket.receive(makeInput('session-a', 2, 'CROUCH_START'));
  socket.receive({ type: 'PEER_STATUS', protocolVersion: 1, sessionId: 'session-a', tvConnected: true, phoneConnected: false });
  assert.deepEqual(received.map((event) => event.type), ['RUN_START', 'CROUCH_START', 'RUN_STOP', 'CROUCH_END']);

  socket.receive({ type: 'PEER_STATUS', protocolVersion: 1, sessionId: 'session-a', tvConnected: true, phoneConnected: true });
  socket.receive(makeInput('session-a', 3, 'RUN_START'));
  assert.equal(received.at(-1).type, 'RUN_START');
  scheduler.advance(2_001);
  assert.equal(controller.checkHeartbeatTimeout(), true);
  assert.equal(received.at(-1).type, 'RUN_STOP');
  assert.equal(controller.getSnapshot().phoneConnected, false);
  controller.dispose();
  manager.disconnect();
}

async function testLoopbackIntegration() {
  const host = network.createNetworkHost({
    port: 0,
    host: '127.0.0.1',
    staticDirectory: null,
    onLog: () => undefined,
  });
  const address = await host.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const socketFactory = (socketUrl) => new WsBrowserAdapter(socketUrl);
  const tvManager = new NetworkManager(url, 'TV_HOST', { socketFactory, clientId: 'tv-test' });
  const phoneSockets = [];
  const phoneManager = new NetworkManager(url, 'PHONE_CONTROLLER', {
    socketFactory: (socketUrl) => {
      const socket = new WsBrowserAdapter(socketUrl);
      phoneSockets.push(socket);
      return socket;
    },
    clientId: 'phone-test',
  });
  const game = new GameController({ viewportWidth: 400, stageHeight: 300 });
  game.start();
  const input = new GameInputController(game);
  const tvController = new TVController(tvManager, input);
  const phoneController = new PhoneController(phoneManager);

  try {
    tvManager.connect();
    await waitFor(() => tvManager.getSnapshot().state === 'CONNECTED');
    phoneManager.connect();
    await waitFor(() => phoneManager.getSnapshot().state === 'CONNECTED' && tvManager.getSnapshot().phoneConnected);

    assert.equal(phoneController.sendDeveloperInput('RUN_START'), 1);
    await waitFor(() => tvController.getSnapshot().lastSequence === 1);
    assert.equal(game.getState().player.running, true);
    assert.equal(tvController.getSnapshot().lastEvent, 'RUN_START');

    phoneController.sendDeveloperInput('RUN_STOP');
    await waitFor(() => tvController.getSnapshot().lastSequence === 2);
    assert.equal(tvController.getSnapshot().lastEvent, 'RUN_STOP');

    phoneSockets[0].raw.send(JSON.stringify(makeInput(phoneManager.getSnapshot().sessionId, 2, 'JUMP')));
    await waitFor(() => phoneManager.getSnapshot().lastError === 'Input sequence must increase.');
    phoneSockets[0].raw.send(JSON.stringify(makeInput('stale-session', 3, 'JUMP')));
    await waitFor(() => phoneManager.getSnapshot().lastError === 'The input belongs to an old session.');

    const invalidJson = await sendUnregisteredMessage(url, '{');
    assert.equal(invalidJson.code, 'INVALID_MESSAGE');
    const unsupportedVersion = await sendUnregisteredMessage(url, JSON.stringify({
      type: 'HELLO', protocolVersion: 9, clientId: 'future-client', role: 'PHONE_CONTROLLER',
    }));
    assert.equal(unsupportedVersion.code, 'UNSUPPORTED_PROTOCOL');
  } finally {
    phoneController.disconnect();
    tvController.dispose();
    tvManager.disconnect();
    await host.close();
  }
}

async function sendUnregisteredMessage(url, message) {
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for server ERROR.')), 1_500);
      socket.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString('utf8')));
      });
    });
    socket.send(message);
    return await received;
  } finally {
    socket.close();
  }
}

function makeTVManager(scheduler) {
  const socket = new FakeSocket();
  const manager = new NetworkManager('ws://test.local/ws', 'TV_HOST', {
    scheduler,
    clientId: 'tv-test',
    socketFactory: () => socket,
  });
  manager.connect();
  socket.open();
  return { manager, socket };
}

function connectTV(socket) {
  socket.receive(welcome('TV_HOST', 'session-a'));
  socket.receive({
    type: 'PEER_STATUS',
    protocolVersion: 1,
    sessionId: 'session-a',
    tvConnected: true,
    phoneConnected: true,
  });
}

function hello(role) {
  return { type: 'HELLO', protocolVersion: 1, clientId: 'test-client', role };
}

function welcome(clientRole, sessionId) {
  return {
    type: 'WELCOME',
    protocolVersion: 1,
    sessionId,
    serverRole: 'TV_HOST',
    clientRole,
    serverTimestamp: 1_000,
  };
}

function makeInput(sessionId, sequence, event) {
  const motion = event === 'RUN_START' || event === 'RUN_STOP'
    ? 'RUN'
    : event === 'CROUCH_START' || event === 'CROUCH_END'
      ? 'CROUCH'
      : event;
  return {
    type: 'INPUT',
    protocolVersion: 1,
    sessionId,
    sequence,
    timestamp: 1_000 + sequence,
    event,
    confidence: 0.95,
    motion,
  };
}

function createMotionEvent(type, timestamp, confidence = 1) {
  const motion = type === 'RUN_START' || type === 'RUN_STOP'
    ? 'RUN'
    : type === 'CROUCH_START' || type === 'CROUCH_END'
      ? 'CROUCH'
      : type;
  return { type, timestamp, confidence, motion };
}

function waitFor(predicate, timeoutMs = 1_500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for network state.'));
      setTimeout(check, 5);
    };
    check();
  });
}

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sent = [];
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(value) {
    this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) });
  }

  send(serialized) {
    this.sent.push(JSON.parse(serialized));
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

class FakeScheduler {
  constructor() {
    this.time = 1_000;
    this.nextId = 1;
    this.tasks = new Map();
  }

  now() { return this.time; }

  setTimeout(callback, delayMs) {
    const id = this.nextId++;
    this.tasks.set(id, { callback, dueAt: this.time + delayMs });
    return id;
  }

  clearTimeout(id) { this.tasks.delete(id); }

  advance(deltaMs) {
    const end = this.time + deltaMs;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= end)
        .sort((first, second) => first[1].dueAt - second[1].dueAt)[0];
      if (!due) break;
      const [id, task] = due;
      this.time = task.dueAt;
      this.tasks.delete(id);
      task.callback();
    }
    this.time = end;
  }
}

class WsBrowserAdapter {
  constructor(url) {
    this.raw = new WebSocket(url);
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.raw.on('open', () => this.onopen?.({}));
    this.raw.on('message', (data) => this.onmessage?.({ data: data.toString('utf8') }));
    this.raw.on('error', (error) => this.onerror?.(error));
    this.raw.on('close', (code, reason) => this.onclose?.({ code, reason: reason.toString('utf8') }));
  }

  get readyState() { return this.raw.readyState; }
  send(data) { this.raw.send(data); }
  close(code, reason) { this.raw.close(code, reason); }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
});
