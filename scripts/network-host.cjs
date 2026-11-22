const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Bonjour } = require('bonjour-service');

const PROTOCOL_VERSION = 2;
const DEFAULT_PORT = 8765;
const HEARTBEAT_TIMEOUT_MS = 4_000;
const PAIRING_CODE_LIFETIME_MS = 5 * 60_000;
const RECONNECT_TOKEN_LIFETIME_MS = 60_000;
const MAX_MESSAGE_BYTES = 8_192;
const RECEIVER_SERVICE_TYPE = 'activekids';
const MOTION_BY_EVENT = Object.freeze({
  RUN_START: 'RUN',
  RUN_STOP: 'RUN',
  JUMP: 'JUMP',
  ARM_SWING: 'ARM_SWING',
  CROUCH_START: 'CROUCH',
  CROUCH_END: 'CROUCH',
});

function createNetworkHost(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';
  const pairingCodeLifetimeMs = options.pairingCodeLifetimeMs ?? PAIRING_CODE_LIFETIME_MS;
  const pairingCodeSweepIntervalMs = options.pairingCodeSweepIntervalMs ?? 10_000;
  const staticDirectory = options.staticDirectory === undefined
    ? path.resolve(__dirname, '..', 'dist')
    : options.staticDirectory;
  const log = options.onLog ?? ((message) => process.stdout.write(`${message}\n`));
  const receiverId = options.receiverId ?? crypto.randomUUID();
  const receiverName = options.receiverName ?? 'Active Kids TV';
  let discoveryStatus = options.discoveryStatus ?? 'STARTING';
  let pairingCode = options.pairingCode ?? createPairingCode();
  let pairingCodeIssuedAt = Date.now();
  const httpServer = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify({
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
        receiverId,
        receiverName,
        discoveryStatus,
        port: getPort(httpServer, port),
        addresses: getLanAddresses(),
      }));
      return;
    }
    if (request.url === '/api/receiver') {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify({
        receiverId,
        receiverName,
        deviceType: 'receiver',
        protocolVersion: PROTOCOL_VERSION,
        discoveryStatus,
        port: getPort(httpServer, port),
        addresses: getLanAddresses(),
      }));
      return;
    }
    serveStatic(request, response, staticDirectory);
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });

  let tvHost = null;
  let phoneController = null;
  let sessionId = crypto.randomUUID();
  let pairedPhoneClientId = null;
  let activeReconnectToken = null;
  let reconnectTokenExpiresAt = 0;
  let lastSequence = 0;
  let lastGameEventSequence = 0;
  const pairingFailures = new Map();
  let closed = false;

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket, request) => {
    socket.on('error', (error) => log(`[NETWORK] Socket error: ${error.message}`));
    const client = {
      socket,
      role: null,
      clientId: null,
      remoteAddress: request.socket.remoteAddress ?? '',
      lastHeartbeatAt: Date.now(),
      hasWelcomed: false,
    };
    if (!isLocalRemoteAddress(request.socket.remoteAddress)) {
      sendError(socket, 'INVALID_MESSAGE', 'Only local-network clients are accepted.');
      socket.close(1008, 'Local network only');
      return;
    }
    const helloTimer = setTimeout(() => {
      if (!client.role) rejectClient(client, 'INVALID_MESSAGE', 'HELLO required after connection.');
    }, 5_000);
    helloTimer.unref?.();

    socket.on('message', (data, isBinary) => {
      if (isBinary || data.length > MAX_MESSAGE_BYTES) {
        rejectClient(client, 'INVALID_MESSAGE', 'Only small JSON text messages are accepted.');
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString('utf8'));
      } catch {
        rejectClient(client, 'INVALID_MESSAGE', 'Message must contain valid JSON.');
        return;
      }
      if (!isRecord(message) || !Number.isSafeInteger(message.protocolVersion)) {
        rejectClient(client, 'INVALID_MESSAGE', 'Message shape is invalid.');
        return;
      }
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        rejectClient(client, 'UNSUPPORTED_PROTOCOL', `Protocol v${PROTOCOL_VERSION} is required.`);
        return;
      }

      if (!client.role) {
        if (message.type !== 'HELLO') {
          rejectClient(client, 'INVALID_MESSAGE', 'HELLO must be the first message.');
          return;
        }
        clearTimeout(helloTimer);
        acceptHello(client, message);
        return;
      }

      switch (message.type) {
        case 'INPUT':
          acceptInput(client, message);
          break;
        case 'GAME_EVENT':
          acceptGameEvent(client, message);
          break;
        case 'HEARTBEAT':
          acceptHeartbeat(client, message);
          break;
        case 'DISCONNECT':
          if (message.sessionId !== sessionId) {
            sendError(socket, 'SESSION_MISMATCH', 'The session has changed.');
          }
          socket.close(1000, 'Client requested disconnect');
          break;
        default:
          rejectClient(client, 'INVALID_MESSAGE', 'Message type is not allowed from a client.');
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      removeClient(client, 'Socket closed');
    });
  });

  function acceptHello(client, message) {
    if (
      !isRole(message.role) ||
      typeof message.clientId !== 'string' ||
      message.clientId.trim().length === 0 ||
      message.clientId.length > 100
    ) {
      rejectClient(client, 'INVALID_MESSAGE', 'HELLO requires a valid role and clientId.');
      return;
    }
    if (message.role === 'PHONE_CONTROLLER' && !isOpen(tvHost?.socket)) {
      rejectClient(client, 'TV_HOST_OFFLINE', 'Start the TV host before connecting a phone.');
      return;
    }
    if (message.role === 'PHONE_CONTROLLER') {
      const isReconnect = message.clientId === pairedPhoneClientId &&
        message.reconnectToken === activeReconnectToken &&
        reconnectTokenExpiresAt > Date.now();
      if (!isReconnect) {
        if (typeof message.pairingCode !== 'string' || !/^\d{6}$/.test(message.pairingCode)) {
          rejectClient(client, 'PAIRING_REQUIRED', 'Enter the six-digit code shown on the receiver.');
          return;
        }
        const key = client.remoteAddress;
        const attempt = pairingFailures.get(key) ?? { count: 0, lockedUntil: 0 };
        if (attempt.lockedUntil > Date.now()) {
          rejectClient(client, 'PAIRING_REJECTED', 'Too many code attempts. Wait a minute and try again.');
          return;
        }
        if (message.pairingCode !== pairingCode) {
          attempt.count += 1;
          if (attempt.count >= 6) {
            attempt.count = 0;
            attempt.lockedUntil = Date.now() + 60_000;
          }
          pairingFailures.set(key, attempt);
          rejectClient(client, 'PAIRING_REJECTED', 'That code does not match the receiver. Check the TV and try again.');
          return;
        }
        pairingFailures.delete(key);
      }
    }
    if (message.role === 'TV_HOST' && isOpen(tvHost?.socket)) {
      rejectClient(client, 'ROLE_BUSY', 'A TV host is already connected.');
      return;
    }
    if (message.role === 'PHONE_CONTROLLER' && isOpen(phoneController?.socket)) {
      rejectClient(client, 'ROLE_BUSY', 'A phone controller is already connected.');
      return;
    }

    client.role = message.role;
    client.clientId = message.clientId;
    client.lastHeartbeatAt = Date.now();
    if (client.role === 'TV_HOST') tvHost = client;
    else {
      phoneController = client;
      if (message.reconnectToken !== activeReconnectToken || message.clientId !== pairedPhoneClientId) {
        pairedPhoneClientId = message.clientId;
        activeReconnectToken = crypto.randomBytes(24).toString('hex');
        pairingCode = createPairingCode();
        pairingCodeIssuedAt = Date.now();
        log(`[NETWORK] New pairing code: ${pairingCode}`);
      }
      reconnectTokenExpiresAt = 0;
    }

    rotateSession();
    lastGameEventSequence = 0;
    log(`[NETWORK] ${client.role} joined (${client.clientId})`);
    sendWelcome(tvHost);
    if (phoneController) sendWelcome(phoneController);
    broadcastPeerStatus();
  }

  function acceptInput(client, message) {
    if (client !== phoneController || client.role !== 'PHONE_CONTROLLER') {
      sendError(client.socket, 'INVALID_MESSAGE', 'Only the paired phone may send INPUT.');
      return;
    }
    if (message.sessionId !== sessionId) {
      sendError(client.socket, 'SESSION_MISMATCH', 'The input belongs to an old session.');
      return;
    }
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= lastSequence) {
      sendError(client.socket, 'SEQUENCE_REJECTED', 'Input sequence must increase.');
      return;
    }
    if (!isOpen(tvHost?.socket)) {
      sendError(client.socket, 'TV_HOST_OFFLINE', 'The TV host disconnected.');
      return;
    }

    if (!isValidInput(message)) {
      sendError(client.socket, 'INVALID_MESSAGE', 'INPUT fields are invalid.');
      return;
    }
    lastSequence = message.sequence;
    const forwarded = { ...message, serverReceivedAt: Date.now() };
    sendJson(tvHost.socket, forwarded);
    log(`[NETWORK] INPUT ${message.action} seq=${message.sequence}`);
  }

  function acceptGameEvent(client, message) {
    if (client !== tvHost || client.role !== 'TV_HOST' || !isOpen(phoneController?.socket)) {
      sendError(client.socket, 'INVALID_MESSAGE', 'Only the receiver can send game events to a paired phone.');
      return;
    }
    if (message.sessionId !== sessionId) {
      sendError(client.socket, 'SESSION_MISMATCH', 'The event belongs to an old session.');
      return;
    }
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= lastGameEventSequence) {
      sendError(client.socket, 'SEQUENCE_REJECTED', 'Game event sequence must increase.');
      return;
    }
    if (!isGameEvent(message.event) || !Number.isFinite(message.timestamp)) {
      sendError(client.socket, 'INVALID_MESSAGE', 'GAME_EVENT fields are invalid.');
      return;
    }
    lastGameEventSequence = message.sequence;
    sendJson(phoneController.socket, message);
  }

  function acceptHeartbeat(client, message) {
    if (message.sessionId !== sessionId || !Number.isFinite(message.timestamp)) {
      sendError(client.socket, 'SESSION_MISMATCH', 'Heartbeat session is invalid.');
      return;
    }
    client.lastHeartbeatAt = Date.now();
    const acknowledgement = {
      type: 'HEARTBEAT_ACK',
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      timestamp: message.timestamp,
      serverTimestamp: client.lastHeartbeatAt,
      role: client.role,
    };
    sendJson(client.socket, acknowledgement);
    const peer = client.role === 'PHONE_CONTROLLER' ? tvHost : phoneController;
    if (isOpen(peer?.socket)) sendJson(peer.socket, acknowledgement);
  }

  function rotateSession() {
    sessionId = crypto.randomUUID();
    lastSequence = 0;
    lastGameEventSequence = 0;
  }

  function sendWelcome(client) {
    if (!client || !isOpen(client.socket)) return;
    client.hasWelcomed = true;
    sendJson(client.socket, {
      type: 'WELCOME',
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      serverRole: 'TV_HOST',
      clientRole: client.role,
      serverTimestamp: Date.now(),
      receiverId,
      receiverName,
      ...(client.role === 'TV_HOST' ? { pairingCode } : {}),
      ...(client.role === 'PHONE_CONTROLLER' ? { reconnectToken: activeReconnectToken } : {}),
    });
  }

  function refreshPairingCode() {
    if (isOpen(phoneController?.socket)) return;
    if (reconnectTokenExpiresAt > 0 && reconnectTokenExpiresAt <= Date.now()) {
      pairedPhoneClientId = null;
      activeReconnectToken = null;
      reconnectTokenExpiresAt = 0;
    }
    if (Date.now() - pairingCodeIssuedAt < pairingCodeLifetimeMs) return;
    pairingCode = createPairingCode();
    pairingCodeIssuedAt = Date.now();
    if (isOpen(tvHost?.socket)) sendWelcome(tvHost);
    log(`[NETWORK] Pairing code refreshed: ${pairingCode}`);
  }

  function broadcastPeerStatus() {
    const message = {
      type: 'PEER_STATUS',
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      tvConnected: isOpen(tvHost?.socket),
      phoneConnected: isOpen(phoneController?.socket),
    };
    if (isOpen(tvHost?.socket)) sendJson(tvHost.socket, message);
    if (isOpen(phoneController?.socket)) sendJson(phoneController.socket, message);
  }

  function removeClient(client, reason) {
    let changed = false;
    if (client === tvHost) {
      tvHost = null;
      changed = true;
      log(`[NETWORK] TV_HOST disconnected: ${reason}`);
      if (phoneController) {
        reconnectTokenExpiresAt = Date.now() + RECONNECT_TOKEN_LIFETIME_MS;
        sendJson(phoneController.socket, {
          type: 'DISCONNECT',
          protocolVersion: PROTOCOL_VERSION,
          sessionId,
          role: 'TV_HOST',
          reason: 'TV host disconnected',
        });
        const phone = phoneController;
        phoneController = null;
        phone.socket.close(4001, 'TV host disconnected');
      }
    } else if (client === phoneController) {
      phoneController = null;
      reconnectTokenExpiresAt = Date.now() + RECONNECT_TOKEN_LIFETIME_MS;
      changed = true;
      log(`[NETWORK] PHONE_CONTROLLER disconnected: ${reason}`);
      if (isOpen(tvHost?.socket)) {
        sendJson(tvHost.socket, {
          type: 'DISCONNECT',
          protocolVersion: PROTOCOL_VERSION,
          sessionId,
          role: 'PHONE_CONTROLLER',
          reason: 'Phone controller disconnected',
        });
      }
    }
    if (changed) broadcastPeerStatus();
  }

  function rejectClient(client, code, message) {
    sendError(client.socket, code, message);
    if (client.role) removeClient(client, message);
    client.socket.close(code === 'UNSUPPORTED_PROTOCOL' ? 1002 : 1008, message.slice(0, 120));
  }

  const heartbeatSweep = setInterval(() => {
    const now = Date.now();
    for (const client of [tvHost, phoneController]) {
      if (!client || !isOpen(client.socket)) continue;
      if (now - client.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        log(`[NETWORK] ${client.role} heartbeat timeout`);
        client.socket.close(4000, 'Heartbeat timeout');
      }
    }
  }, 500);
  heartbeatSweep.unref?.();
  const pairingCodeSweep = setInterval(() => refreshPairingCode(), pairingCodeSweepIntervalMs);
  pairingCodeSweep.unref?.();

  return {
    httpServer,
    webSocketServer,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          httpServer.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          resolve(httpServer.address());
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, host);
      });
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      clearInterval(heartbeatSweep);
      clearInterval(pairingCodeSweep);
      for (const client of [tvHost, phoneController]) {
        if (isOpen(client?.socket)) client.socket.close(1001, 'Host shutting down');
      }
      return new Promise((resolve) => {
        webSocketServer.close(() => {
          if (!httpServer.listening) return resolve();
          httpServer.close(() => resolve());
        });
      });
    },
    getAddress() {
      return httpServer.address();
    },
    getSessionId() {
      return sessionId;
    },
    getReceiverInfo() {
      return { receiverId, receiverName, pairingCode, discoveryStatus, port: getPort(httpServer, port) };
    },
    setDiscoveryStatus(status) {
      discoveryStatus = status;
    },
  };
}

function serveStatic(request, response, staticDirectory) {
  if (!staticDirectory) {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Active Kids local network host is running. Open the exported TV web app on this host.');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  const root = path.resolve(staticDirectory);
  const relativePath = pathname.replace(/^\/+/, '');
  let filePath = path.resolve(root, relativePath || 'index.html');
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(pathname)) {
      response.writeHead(404).end('Not found');
      return;
    }
    filePath = path.join(root, 'index.html');
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': getContentType(filePath),
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    response.end(contents);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  })[extension] ?? 'application/octet-stream';
}

function sendError(socket, code, message) {
  sendJson(socket, {
    type: 'ERROR',
    protocolVersion: PROTOCOL_VERSION,
    code,
    message,
  });
}

function sendJson(socket, value) {
  if (isOpen(socket)) socket.send(JSON.stringify(value));
}

function isOpen(socket) {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRole(value) {
  return value === 'TV_HOST' || value === 'PHONE_CONTROLLER';
}

function createPairingCode() {
  return String(crypto.randomInt(100_000, 1_000_000));
}

function isValidInput(message) {
  if (!Number.isSafeInteger(message.sequence) || !Number.isFinite(message.timestamp)) return false;
  if (message.action === 'MOTION_EVENT') {
    return Boolean(MOTION_BY_EVENT[message.event]) &&
      message.motion === MOTION_BY_EVENT[message.event] &&
      Number.isFinite(message.confidence) && message.confidence >= 0 && message.confidence <= 1;
  }
  if (message.action === 'MOVE') {
    return Number.isFinite(message.value) && message.value >= -1 && message.value <= 1;
  }
  return ['JUMP', 'ATTACK', 'CROUCH_START', 'CROUCH_END', 'START_GAME', 'PAUSE', 'RESUME', 'RESTART'].includes(message.action) &&
    message.event === undefined && message.value === undefined &&
    message.confidence === undefined && message.motion === undefined;
}

function isGameEvent(value) {
  return [
    'GAME_STARTED',
    'CHECKPOINT_REACHED',
    'MISSION_COMPLETED',
    'PLAYER_DIED',
    'GAME_PAUSED',
    'GAME_FINISHED',
    'CONNECTION_WARNING',
  ].includes(value);
}

function isLocalRemoteAddress(address = '') {
  let host = address.toLowerCase();
  if (host.startsWith('::ffff:')) host = host.slice(7);
  if (host === '::1' || host === 'localhost') return true;
  if (
    host.includes(':') &&
    (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))
  ) return true;
  const octets = host.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254);
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function getPort(server, fallback) {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : fallback;
}

if (require.main === module) {
  const port = Number.parseInt(process.env.ACTIVE_KIDS_NETWORK_PORT ?? '', 10) || DEFAULT_PORT;
  const host = process.env.ACTIVE_KIDS_NETWORK_BIND ?? '0.0.0.0';
  const appDist = process.env.ACTIVE_KIDS_WEB_DIST ?? path.resolve(__dirname, '..', 'dist');
  const staticDirectory = fs.existsSync(path.join(appDist, 'index.html')) ? appDist : null;
  const receiverName = process.env.ACTIVE_KIDS_RECEIVER_NAME?.trim() || 'Active Kids TV';
  const discoveryEnabled = process.env.ACTIVE_KIDS_DISCOVERY !== '0';
  const networkHost = createNetworkHost({
    port,
    host,
    staticDirectory,
    receiverName,
    discoveryStatus: discoveryEnabled ? 'STARTING' : 'DISABLED',
  });
  const discovery = discoveryEnabled
    ? new Bonjour({}, (error) => {
      process.stderr.write(`[DISCOVERY] ${error.message}\n`);
      networkHost.setDiscoveryStatus('ERROR');
    })
    : null;
  networkHost.listen().then((address) => {
    const networkAddresses = getLanAddresses();
    const receiver = networkHost.getReceiverInfo();
    const service = discovery?.publish({
      name: receiverName,
      type: RECEIVER_SERVICE_TYPE,
      protocol: 'tcp',
      port: address.port,
      txt: {
        id: receiver.receiverId,
        deviceType: 'receiver',
        deviceName: receiverName,
        protocolVersion: String(PROTOCOL_VERSION),
      },
    });
    service?.on('up', () => {
      networkHost.setDiscoveryStatus('ADVERTISING');
      process.stdout.write(`[DISCOVERY] _${RECEIVER_SERVICE_TYPE}._tcp advertisement is active\n`);
    });
    service?.on('error', (error) => {
      networkHost.setDiscoveryStatus('ERROR');
      process.stderr.write(`[DISCOVERY] Advertisement failed: ${error.message}\n`);
    });
    process.stdout.write(`[NETWORK] TV host listening on port ${address.port}\n`);
    process.stdout.write(`[NETWORK] Pairing code: ${receiver.pairingCode}\n`);
    process.stdout.write(`[DISCOVERY] ${discoveryEnabled ? 'Starting' : 'Disabled'} _${RECEIVER_SERVICE_TYPE}._tcp advertisement\n`);
    for (const ip of networkAddresses) {
      process.stdout.write(`[NETWORK] TV app: http://${ip}:${address.port}/tv\n`);
      process.stdout.write(`[NETWORK] Phone WebSocket: ws://${ip}:${address.port}/ws\n`);
    }
    if (networkAddresses.length === 0) {
      process.stdout.write(`[NETWORK] Local app: http://localhost:${address.port}/tv\n`);
    }
    if (process.argv.includes('--open-browser')) {
      const receiverHost = process.env.ACTIVE_KIDS_RECEIVER_HOST || networkAddresses[0] || '127.0.0.1';
      const receiverUrl = `http://${receiverHost}:${address.port}/tv`;
      process.stdout.write(`[RECEIVER] Opening ${receiverUrl}\n`);
      openReceiverBrowser(receiverUrl);
    }
  }).catch((error) => {
    process.stderr.write(`[NETWORK] Host failed: ${error.message}\n`);
    process.exitCode = 1;
  });

  const shutdown = () => {
    discovery?.destroy();
    networkHost.close().finally(() => process.exit());
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function openReceiverBrowser(url) {
  const configuredBrowser = process.env.ACTIVE_KIDS_BROWSER;
  let command;
  let args;
  if (configuredBrowser) {
    command = configuredBrowser;
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', `start "" "${url}"`];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.env.ACTIVE_KIDS_KIOSK === '1') {
    command = process.env.ACTIVE_KIDS_CHROMIUM || 'chromium';
    args = ['--kiosk', '--noerrdialogs', '--disable-infobars', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const browser = require('node:child_process').spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    let fallbackPrinted = false;
    const printFallback = (reason) => {
      if (fallbackPrinted) return;
      fallbackPrinted = true;
      process.stderr.write(`[RECEIVER] Browser could not be opened${reason ? ` (${reason})` : ''}. Open ${url} on this device.\n`);
    };
    browser.once('error', (error) => {
      printFallback(error.message);
    });
    browser.once('exit', (code, signal) => {
      if (code !== 0) printFallback(signal ? `stopped by ${signal}` : `browser command exited with code ${code}`);
    });
    browser.unref();
  } catch (error) {
    process.stderr.write(`[RECEIVER] Browser could not be opened (${error.message}). Open ${url} on this device.\n`);
  }
}

module.exports = { createNetworkHost };
