const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

const projectRoot = path.resolve(__dirname, '..');
const PROTOCOL_VERSION = 2;
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'active-kids-network-'));
let network;
let NetworkManager;
let PhoneController;
let TVController;
let GameController;
let GameInputController;
let NetworkInputAdapter;
let normalizeWebSocketUrl;
let getWebSocketUrlFromWebPage;
let protocol;
let pairing;
let parseReceiverService;
let checkReceiverReachability;

async function main() {
  compileSources();
  loadSources();
  const cases = [
    ['valid HELLO, WELCOME, and INPUT messages parse', testValidProtocolMessages],
    ['mDNS results filter receivers, old protocols, and multiple targets', testReceiverDiscoveryParsing],
    ['QR pairing accepts local endpoints and rejects invalid data', testQrPairing],
    ['manual pairing accepts LAN hosts and rejects internet hosts', testNetworkAddressValidation],
    ['malformed JSON, unknown types, and unsupported versions reject', testProtocolRejections],
    ['connection states, handshake, sequence, heartbeat, and reconnect backoff', testManagerLifecycle],
    ['rapid movement updates stay within the configured send interval', testPhoneMovementThrottle],
    ['receiver HTTP serves the web route and non-secret local metadata', testReceiverHttp],
    ['reachability probe reports the local health route independently of WebSocket pairing', testReachabilityProbe],
    ['TV rejects duplicate, stale, and wrong-session input', testTVInputProtection],
    ['normalized movement, jump, attack, crouch, pause, and resume reach the game input boundary', testControlActions],
    ['all six motion events forward to GameInputController', testAllMotionEventsForward],
    ['peer loss and missed heartbeat release controls and pause the receiver game', testTVSafetyRelease],
    ['phone input, game events, and phone/receiver reconnect traverse the real local relay', testLoopbackIntegration],
    ['pairing requires a current code and expires old codes', testRelayPairing],
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
    path.join(projectRoot, 'src', 'network', 'receiverTypes.ts'),
    path.join(projectRoot, 'src', 'network', 'address.ts'),
    path.join(projectRoot, 'src', 'network', 'pairing.ts'),
    path.join(projectRoot, 'src', 'network', 'receiverDiscovery.ts'),
    path.join(projectRoot, 'src', 'network', 'reachability.ts'),
    path.join(projectRoot, 'src', 'network', 'NetworkManager.ts'),
    path.join(projectRoot, 'src', 'network', 'PhoneController.ts'),
    path.join(projectRoot, 'src', 'network', 'TVController.ts'),
    path.join(projectRoot, 'src', 'network', 'NetworkInputAdapter.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' });
}

function loadSources() {
  const source = (name) => require(path.join(outputDirectory, name));
  protocol = source('network/protocol.js');
  pairing = source('network/pairing.js');
  ({ parseReceiverService } = source('network/receiverDiscovery.js'));
  ({ checkReceiverReachability } = source('network/reachability.js'));
  ({ NetworkManager } = source('network/NetworkManager.js'));
  ({ PhoneController } = source('network/PhoneController.js'));
  ({ TVController } = source('network/TVController.js'));
  ({ GameController } = source('game/platformer/GameController.js'));
  ({ GameInputController } = source('game/platformer/GameInputController.js'));
  ({ NetworkInputAdapter } = source('network/NetworkInputAdapter.js'));
  ({ normalizeWebSocketUrl, getWebSocketUrlFromWebPage } = source('network/address.js'));
  network = require(path.join(projectRoot, 'scripts', 'network-host.cjs'));
}

function testValidProtocolMessages() {
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(hello('TV_HOST'))).ok, true);
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(welcome('TV_HOST', 'session-a'))).ok, true);
  const input = makeInput('session-a', 1, 'RUN_START');
  assert.equal(protocol.parseNetworkMessage(JSON.stringify(input)).ok, true);
}

function testReceiverDiscoveryParsing() {
  const service = (id, name) => ({
    name,
    host: `${id}.local.`,
    ipv4: [],
    port: 8765,
    txt: { id, deviceType: 'receiver', deviceName: name, protocolVersion: String(PROTOCOL_VERSION) },
  });
  const livingRoom = parseReceiverService(service('tv-1', 'Living Room TV'));
  const bedroom = parseReceiverService(service('tv-2', 'Bedroom TV'));
  assert.equal(livingRoom.endpoint, 'ws://tv-1.local:8765/ws');
  assert.equal(bedroom.name, 'Bedroom TV');
  assert.equal(parseReceiverService({ ...service('other', 'Printer'), txt: { deviceType: 'printer' } }), null);
  assert.equal(parseReceiverService({ ...service('old', 'Old receiver'), txt: { ...service('old', 'Old receiver').txt, protocolVersion: '1' } }), null);
  assert.equal(parseReceiverService({ ...service('invalid', 'Invalid'), host: '8.8.8.8' }), null);
  assert.deepEqual(new Map([livingRoom, bedroom].map((receiver) => [receiver.id, receiver])).size, 2);
}

function testQrPairing() {
  const receiver = {
    id: 'receiver-1', name: 'Living Room TV', host: '192.168.1.40', port: 8765,
    endpoint: 'ws://192.168.1.40:8765/ws', discoveryMethod: 'mDNS', protocolVersion: PROTOCOL_VERSION,
  };
  const qr = pairing.buildReceiverQrData(receiver, '482731');
  assert.deepEqual(pairing.parseReceiverQrData(qr), JSON.parse(qr));
  assert.equal(pairing.parseReceiverQrData('{'), null);
  assert.equal(pairing.parseReceiverQrData(JSON.stringify({ ...JSON.parse(qr), endpoint: 'ws://8.8.8.8:8765/ws' })), null);
  assert.equal(pairing.parseReceiverQrData(JSON.stringify({ ...JSON.parse(qr), pairingCode: '123' })), null);
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
  assert.deepEqual(protocol.parseNetworkMessage(JSON.stringify({ type: 'ALIEN', protocolVersion: PROTOCOL_VERSION })), {
    ok: false,
    reason: 'INVALID_SHAPE',
  });
  assert.deepEqual(protocol.parseNetworkMessage(JSON.stringify({ type: 'HELLO', protocolVersion: 77 })), {
    ok: false,
    reason: 'UNSUPPORTED_PROTOCOL',
  });
  assert.equal(protocol.parseNetworkMessage(JSON.stringify({ ...makeInput('session-a', 0, 'JUMP') })).ok, false);
  assert.equal(protocol.parseNetworkMessage(JSON.stringify({ ...makeInput('session-a', 1, 'JUMP'), motion: 'RUN' })).ok, false);
  assert.equal(protocol.parseNetworkMessage(JSON.stringify({ ...hello('PHONE_CONTROLLER'), pairingCode: undefined })).ok, false);
}

function testManagerLifecycle() {
  const scheduler = new FakeScheduler();
  const sockets = [];
  const manager = new NetworkManager('ws://tv.local:8765/ws', 'PHONE_CONTROLLER', {
    scheduler,
    clientId: 'phone-test',
    pairingCode: '482731',
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
  assert.equal(manager.getSnapshot().webSocketOpen, false);
  sockets[0].open();
  assert.equal(manager.getSnapshot().webSocketOpen, true);
  assert.equal(manager.getSnapshot().state, 'CONNECTING');
  assert.equal(sockets[0].sent[0].type, 'HELLO');
  assert.equal(sockets[0].sent[0].pairingCode, '482731');
  sockets[0].receive(welcome('PHONE_CONTROLLER', 'session-a'));
  assert.equal(manager.getSnapshot().state, 'CONNECTED');
  assert.equal(manager.sendInput(createMotionEvent('RUN_START', scheduler.now(), 0.9)), 1);
  assert.equal(sockets[0].sent.at(-1).sequence, 1);

  scheduler.advance(1_000);
  const heartbeat = sockets[0].sent.at(-1);
  assert.equal(heartbeat.type, 'HEARTBEAT');
  sockets[0].receive({
    type: 'HEARTBEAT_ACK',
    protocolVersion: PROTOCOL_VERSION,
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
  assert.equal(sockets[1].sent[0].reconnectToken, 'a'.repeat(48));
  assert.equal(sockets[1].sent[0].pairingCode, undefined);
  sockets[1].receive(welcome('PHONE_CONTROLLER', 'session-b'));
  assert.equal(manager.getSnapshot().state, 'CONNECTED');
  assert.equal(manager.getSnapshot().nextSequence, 1);

  scheduler.advance(4_000);
  assert.equal(sockets[1].readyState, 3);
  assert.equal(manager.getSnapshot().state, 'RECONNECTING');
  assert.ok(states.includes('RECONNECTING'));
  manager.disconnect('test complete');
  assert.equal(manager.getSnapshot().state, 'DISCONNECTED');
  assert.equal(manager.getSnapshot().webSocketOpen, false);
}

function testPhoneMovementThrottle() {
  const scheduler = new FakeScheduler();
  const sockets = [];
  const manager = new NetworkManager('ws://tv.local:8765/ws', 'PHONE_CONTROLLER', {
    scheduler,
    clientId: 'phone-rate-test',
    pairingCode: '482731',
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const controller = new PhoneController(manager);
  manager.connect();
  sockets[0].open();
  sockets[0].receive(welcome('PHONE_CONTROLLER', 'session-rate'));
  for (let index = 0; index < 100; index += 1) {
    controller.handleMovement({ direction: 1, intensity: (index + 1) / 100 }, 1_000 + index * 10);
  }
  const movements = sockets[0].sent.filter((message) => message.type === 'INPUT' && message.action === 'MOVE');
  assert.equal(movements.length, 20);
  assert.equal(movements.every((message, index) => index === 0 || message.sequence > movements[index - 1].sequence), true);
  manager.disconnect();
}

function testTVInputProtection() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const received = [];
  const movements = [];
  const controls = [];
  const gameInput = {
    selectSource: () => undefined,
    handleMotionEvent: (event) => received.push(event),
    handleHorizontalMovement: (movement) => movements.push(movement),
    handleDeveloperInput: (type) => received.push(createMotionEvent(type, scheduler.now(), 1)),
  };
  const controller = new TVController(manager, gameInput, {
    scheduler,
    onChange: () => undefined,
    onControl: (action) => controls.push(action),
  });
  connectTV(socket);

  socket.receive(makeInput('session-a', 1, 'RUN_START'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  socket.receive(makeInput('session-a', 1, 'RUN_STOP'));
  socket.receive(makeInput('session-a', 0, 'JUMP'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  socket.receive(makeInput('old-session', 2, 'JUMP'));
  assert.deepEqual(received.map((event) => event.type), ['RUN_START']);
  socket.receive(makeControlInput('session-a', 2, 'MOVE', { value: -0.65 }));
  assert.deepEqual(movements.at(-1), { direction: -1, intensity: 0.65 });
  socket.receive(makeControlInput('session-a', 3, 'ATTACK'));
  assert.deepEqual(controls, ['ATTACK']);
  assert.equal(controller.getSnapshot().lastInputTimestamp, 1_003);
  assert.equal(controller.getSnapshot().inputRatePerSecond, 3);
  scheduler.advance(1_001);
  controller.checkHeartbeatTimeout();
  assert.equal(controller.getSnapshot().inputRatePerSecond, 0);
  controller.dispose();
  manager.disconnect();
}

function testControlActions() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const game = new GameController({ viewportWidth: 400, stageHeight: 300 });
  const input = new GameInputController(game);
  const networkInput = new NetworkInputAdapter(input);
  const controller = new TVController(manager, input, {
    scheduler,
    onControl: (action) => networkInput.control(action),
  });
  connectTV(socket);
  const actions = [
    ['START_GAME'],
    ['MOVE', { value: 0.72 }],
    ['CROUCH_START'],
    ['CROUCH_END'],
    ['JUMP'],
    ['ATTACK'],
    ['PAUSE'],
    ['RESUME'],
    ['MOVE', { value: 0.72 }],
  ];
  actions.forEach(([action, fields], index) => socket.receive(makeControlInput('session-a', index + 1, action, fields ?? {})));
  const state = game.getState();
  assert.equal(state.status, 'PLAYING');
  assert.equal(state.player.running, true);
  assert.equal(state.player.grounded, false);
  assert.equal(state.player.attacking, true);
  assert.equal(state.player.crouching, false);
  assert.equal(controller.getSnapshot().lastSequence, actions.length);
  controller.dispose();
  manager.disconnect();
}

async function testReceiverHttp() {
  const staticDirectory = path.join(outputDirectory, 'receiver-site');
  fs.mkdirSync(path.join(staticDirectory, 'tv'), { recursive: true });
  fs.writeFileSync(path.join(staticDirectory, 'index.html'), '<main>Active Kids</main>');
  fs.writeFileSync(path.join(staticDirectory, 'tv', 'index.html'), '<main>TV Receiver</main>');
  const host = network.createNetworkHost({
    port: 0,
    host: '127.0.0.1',
    staticDirectory,
    pairingCode: '482731',
    onLog: () => undefined,
  });
  const address = await host.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const tvPage = await fetch(`${origin}/tv`);
    assert.equal(tvPage.status, 200);
    assert.match(await tvPage.text(), /TV Receiver/);
    const health = await (await fetch(`${origin}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.discoveryStatus, 'STARTING');
    const receiverInfo = await (await fetch(`${origin}/api/receiver`)).json();
    assert.equal(receiverInfo.deviceType, 'receiver');
    assert.equal(receiverInfo.protocolVersion, PROTOCOL_VERSION);
    assert.equal(receiverInfo.discoveryStatus, 'STARTING');
    assert.equal(Object.hasOwn(receiverInfo, 'pairingCode'), false);
    host.setDiscoveryStatus('ADVERTISING');
    const advertised = await (await fetch(`${origin}/api/receiver`)).json();
    assert.equal(advertised.discoveryStatus, 'ADVERTISING');
  } finally {
    await host.close();
  }
}

async function testReachabilityProbe() {
  const host = network.createNetworkHost({
    port: 0,
    host: '127.0.0.1',
    staticDirectory: null,
    onLog: () => undefined,
  });
  const address = await host.listen();
  try {
    const reachable = await checkReceiverReachability(`ws://127.0.0.1:${address.port}/ws`);
    assert.equal(reachable.status, 'PASS');
    const unavailable = await checkReceiverReachability('ws://127.0.0.1:1/ws', 100);
    assert.equal(unavailable.status, 'FAIL');
  } finally {
    await host.close();
  }
}

function testAllMotionEventsForward() {
  const scheduler = new FakeScheduler();
  const { manager, socket } = makeTVManager(scheduler);
  const received = [];
  const gameInput = {
    selectSource: () => undefined,
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
  const movements = [];
  const controls = [];
  const gameInput = {
    selectSource: () => undefined,
    handleMotionEvent: (event) => received.push(event),
    handleHorizontalMovement: (movement) => movements.push(movement),
    handleDeveloperInput: (type) => received.push(createMotionEvent(type, scheduler.now(), 1)),
  };
  const controller = new TVController(manager, gameInput, {
    scheduler,
    heartbeatTimeoutMs: 2_000,
    onControl: (action) => controls.push(action),
  });
  connectTV(socket);

  socket.receive(makeControlInput('session-a', 1, 'MOVE', { value: 0.45 }));
  scheduler.advance(351);
  assert.equal(controller.checkHeartbeatTimeout(), true);
  assert.deepEqual(movements.at(-1), { direction: 0, intensity: 0 });

  socket.receive(makeInput('session-a', 2, 'RUN_START'));
  socket.receive(makeInput('session-a', 3, 'CROUCH_START'));
  socket.receive({ type: 'PEER_STATUS', protocolVersion: PROTOCOL_VERSION, sessionId: 'session-a', tvConnected: true, phoneConnected: false });
  assert.deepEqual(received.map((event) => event.type), ['RUN_START', 'CROUCH_START', 'RUN_STOP', 'CROUCH_END']);
  assert.deepEqual(controls, ['PAUSE']);

  socket.receive({ type: 'PEER_STATUS', protocolVersion: PROTOCOL_VERSION, sessionId: 'session-a', tvConnected: true, phoneConnected: true });
  socket.receive(makeInput('session-a', 4, 'RUN_START'));
  assert.equal(received.at(-1).type, 'RUN_START');
  scheduler.advance(2_001);
  assert.equal(received.at(-1).type, 'RUN_STOP');
  assert.equal(controller.getSnapshot().phoneConnected, false);
  assert.deepEqual(controls, ['PAUSE', 'PAUSE']);
  controller.dispose();
  manager.disconnect();
}

async function testLoopbackIntegration() {
  const initialPairingCode = '481592';
  const host = network.createNetworkHost({
    port: 0,
    host: '127.0.0.1',
    staticDirectory: null,
    pairingCode: initialPairingCode,
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
    pairingCode: initialPairingCode,
  });
  const game = new GameController({ viewportWidth: 400, stageHeight: 300 });
  game.start();
  const input = new GameInputController(game);
  const networkInput = new NetworkInputAdapter(input);
  const tvController = new TVController(tvManager, input, {
    onControl: (action) => networkInput.control(action),
  });
  const phoneController = new PhoneController(phoneManager);

  try {
    tvManager.connect();
    await waitFor(() => tvManager.getSnapshot().state === 'CONNECTED');
    phoneManager.connect();
    await waitFor(() => phoneManager.getSnapshot().state === 'CONNECTED' && tvManager.getSnapshot().phoneConnected);

    assert.equal(phoneController.sendDeveloperInput('RUN_START'), 1);
    await waitFor(() => tvController.getSnapshot().lastSequence === 1);
    assert.equal(game.getState().player.running, true);
    assert.equal(tvController.getSnapshot().lastAction, 'MOVE');

    phoneController.sendDeveloperInput('RUN_STOP');
    await waitFor(() => tvController.getSnapshot().lastSequence === 2);
    assert.equal(game.getState().player.running, false);

    assert.equal(phoneController.sendControl('START_GAME'), 3);
    await waitFor(() => game.getState().status === 'PLAYING');
    assert.equal(phoneController.sendControl('JUMP'), 4);
    await waitFor(() => tvController.getSnapshot().lastSequence === 4);
    assert.equal(game.getState().player.grounded, false);
    assert.equal(phoneController.sendControl('ATTACK'), 5);
    await waitFor(() => tvController.getSnapshot().lastSequence === 5);
    assert.equal(game.getState().player.attacking, true);
    assert.equal(phoneController.sendControl('PAUSE'), 6);
    await waitFor(() => game.getState().status === 'PAUSED');
    assert.equal(phoneController.sendControl('RESUME'), 7);
    await waitFor(() => game.getState().status === 'PLAYING');

    const gameEvents = [];
    const unsubscribeGameEvents = phoneController.subscribeGameEvents((event) => gameEvents.push(event));
    assert.equal(tvManager.sendGameEvent('GAME_STARTED'), 1);
    await waitFor(() => gameEvents.includes('GAME_STARTED'));
    unsubscribeGameEvents();

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
    const missingCode = await sendUnregisteredMessage(url, JSON.stringify({
      type: 'HELLO', protocolVersion: PROTOCOL_VERSION, clientId: 'phone-no-code', role: 'PHONE_CONTROLLER',
    }));
    assert.equal(missingCode.code, 'PAIRING_REQUIRED');
    const wrongCode = await sendUnregisteredMessage(url, JSON.stringify({
      type: 'HELLO', protocolVersion: PROTOCOL_VERSION, clientId: 'phone-wrong-code', role: 'PHONE_CONTROLLER', pairingCode: '000000',
    }));
    assert.equal(wrongCode.code, 'PAIRING_REJECTED');
    const secondPhone = await sendUnregisteredMessage(url, JSON.stringify({
      type: 'HELLO', protocolVersion: PROTOCOL_VERSION, clientId: 'second-phone', role: 'PHONE_CONTROLLER', pairingCode: host.getReceiverInfo().pairingCode,
    }));
    assert.equal(secondPhone.code, 'ROLE_BUSY');

    phoneController.handleMovement({ direction: 1, intensity: 1 });
    await waitFor(() => game.getState().player.running);
    phoneSockets[0].raw.close();
    await waitFor(() => !game.getState().player.running && game.getState().status === 'PAUSED');
    await waitFor(() => phoneManager.getSnapshot().state === 'CONNECTED' && tvManager.getSnapshot().phoneConnected);
    assert.equal(phoneSockets.length, 2);
    phoneController.handleMovement({ direction: -1, intensity: 0.7 });
    await waitFor(() => tvController.getSnapshot().movement === -0.7);

    tvManager.disconnect('simulate receiver page reload');
    await waitFor(() => !game.getState().player.running);
    tvManager.connect();
    await waitFor(() => tvManager.getSnapshot().state === 'CONNECTED' && phoneManager.getSnapshot().state === 'CONNECTED' && tvManager.getSnapshot().phoneConnected);
    assert.equal(phoneSockets.length, 3);
  } finally {
    phoneController.disconnect();
    tvController.dispose();
    tvManager.disconnect();
    await host.close();
  }
}

async function testRelayPairing() {
  const initialPairingCode = '581204';
  const host = network.createNetworkHost({
    port: 0,
    host: '127.0.0.1',
    staticDirectory: null,
    pairingCode: initialPairingCode,
    pairingCodeLifetimeMs: 40,
    pairingCodeSweepIntervalMs: 5,
    onLog: () => undefined,
  });
  const address = await host.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const tvManager = new NetworkManager(url, 'TV_HOST', { socketFactory: (socketUrl) => new WsBrowserAdapter(socketUrl) });
  try {
    tvManager.connect();
    await waitFor(() => tvManager.getSnapshot().state === 'CONNECTED');
    await waitFor(() => host.getReceiverInfo().pairingCode !== initialPairingCode);
    const expired = await sendUnregisteredMessage(url, JSON.stringify({
      type: 'HELLO', protocolVersion: PROTOCOL_VERSION, clientId: 'expired-phone', role: 'PHONE_CONTROLLER', pairingCode: initialPairingCode,
    }));
    assert.equal(expired.code, 'PAIRING_REJECTED');
  } finally {
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
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'session-a',
    tvConnected: true,
    phoneConnected: true,
  });
}

function hello(role) {
  return { type: 'HELLO', protocolVersion: PROTOCOL_VERSION, clientId: 'test-client', role, ...(role === 'PHONE_CONTROLLER' ? { pairingCode: '482731' } : {}) };
}

function welcome(clientRole, sessionId) {
  return {
    type: 'WELCOME',
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    serverRole: 'TV_HOST',
    clientRole,
    serverTimestamp: 1_000,
    ...(clientRole === 'PHONE_CONTROLLER' ? { reconnectToken: 'a'.repeat(48) } : {}),
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
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    sequence,
    timestamp: 1_000 + sequence,
    action: 'MOTION_EVENT',
    event,
    confidence: 0.95,
    motion,
  };
}

function makeControlInput(sessionId, sequence, action, fields = {}) {
  return {
    type: 'INPUT',
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    sequence,
    timestamp: 1_000 + sequence,
    action,
    ...fields,
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
