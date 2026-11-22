import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { CameraScreen, useCameraGameSession } from './CameraScreen';
import { BODY_LEAN_CONFIG } from '../motion/motionThresholds';
import { normalizeWebSocketUrl } from '../network/address';
import { parseReceiverQrData } from '../network/pairing';
import { checkReceiverReachability } from '../network/reachability';
import { NetworkManager, type NetworkSnapshot } from '../network/NetworkManager';
import { PhoneController } from '../network/PhoneController';
import type { ReceiverDescriptor } from '../network/receiverTypes';
import { useReceiverDiscovery } from '../network/useReceiverDiscovery';
import { colors, radius, spacing } from '../theme';

type ActiveConnection = {
  receiver: ReceiverDescriptor;
  network: NetworkManager;
  controller: PhoneController;
};

type ConnectTVScreenProps = { onHome: () => void };
type ReachabilityState = 'NOT RUN' | 'CHECKING' | 'PASS' | 'FAIL';

export function ConnectTVScreen({ onHome }: ConnectTVScreenProps) {
  const [discoveryRetryKey, setDiscoveryRetryKey] = useState(0);
  const discovery = useReceiverDiscovery(discoveryRetryKey);
  const [permission, requestPermission] = useCameraPermissions();
  const [receiver, setReceiver] = useState<ReceiverDescriptor | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);
  const [networkSnapshot, setNetworkSnapshot] = useState<NetworkSnapshot | null>(null);
  const [reachabilityState, setReachabilityState] = useState<ReachabilityState>('NOT RUN');
  const [gameEvent, setGameEvent] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState('');
  const [manualPort, setManualPort] = useState('8765');
  const [phoneIp, setPhoneIp] = useState('Unavailable');
  const [networkType, setNetworkType] = useState('Unknown');

  useEffect(() => {
    let active = true;
    const readNetworkDetails = async () => {
      try {
        // These values only improve the pairing screen. Keep the route usable
        // in older development clients that do not include ExpoNetwork.
        const network = await import('expo-network');
        const [ip, state] = await Promise.all([
          network.getIpAddressAsync(),
          network.getNetworkStateAsync(),
        ]);
        if (!active) return;
        setPhoneIp(ip || 'Unavailable');
        setNetworkType(String(state.type ?? 'Unknown'));
      } catch {
        if (!active) return;
        setPhoneIp('Unavailable');
        setNetworkType('Unknown');
      }
    };
    void readNetworkDetails();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!activeConnection) return;
    let active = true;
    const unsubscribeState = activeConnection.network.subscribe(setNetworkSnapshot);
    const unsubscribeEvents = activeConnection.controller.subscribeGameEvents(setGameEvent);
    void checkReceiverReachability(activeConnection.receiver.endpoint).then((result) => {
      if (active) setReachabilityState(result.status);
    });
    activeConnection.network.connect();
    return () => {
      active = false;
      unsubscribeEvents();
      unsubscribeState();
      activeConnection.controller.disconnect();
    };
  }, [activeConnection]);

  const connect = useCallback((selected: ReceiverDescriptor, code: string) => {
    const normalizedCode = code.trim();
    const endpoint = normalizeWebSocketUrl(selected.endpoint);
    if (!endpoint || !/^\d{6}$/.test(normalizedCode)) return;
    setNetworkSnapshot(null);
    setReachabilityState('CHECKING');
    setGameEvent(null);
    const network = new NetworkManager(endpoint, 'PHONE_CONTROLLER', { pairingCode: normalizedCode });
    setReceiver(selected);
    setActiveConnection({ receiver: selected, network, controller: new PhoneController(network) });
  }, []);

  const selectQr = useCallback((data: string) => {
    setHasScanned(true);
    const parsed = parseReceiverQrData(data);
    if (!parsed) {
      setScanMessage('That code is not an Active Kids receiver code. Try again or choose a TV from the list.');
      return;
    }
    const url = new URL(parsed.endpoint);
    const qrReceiver: ReceiverDescriptor = {
      id: parsed.receiverId,
      name: parsed.receiverName,
      host: url.hostname,
      port: Number(url.port || 8765),
      endpoint: parsed.endpoint,
      discoveryMethod: 'QR',
      protocolVersion: parsed.protocolVersion,
    };
    setReceiver(qrReceiver);
    setPairingCode(parsed.pairingCode);
    setScanMessage(`Receiver found: ${parsed.receiverName}`);
    setShowScanner(false);
  }, []);

  const addManualReceiver = useCallback(() => {
    const endpoint = normalizeWebSocketUrl(`${manualAddress.trim()}:${manualPort.trim()}`);
    if (!endpoint) {
      setScanMessage('Enter a private LAN address and a valid receiver port.');
      return;
    }
    const url = new URL(endpoint);
    setReceiver({
      id: `manual-${url.hostname}-${url.port}`,
      name: 'Manual receiver',
      host: url.hostname,
      port: Number(url.port || 8765),
      endpoint,
      discoveryMethod: 'MANUAL',
      protocolVersion: 2,
    });
    setScanMessage('Receiver address added. Enter the code shown on its screen.');
  }, [manualAddress, manualPort]);

  const leaveConnection = useCallback(() => {
    setActiveConnection(null);
    setReceiver(null);
    setPairingCode('');
    setNetworkSnapshot(null);
    setReachabilityState('NOT RUN');
    setGameEvent(null);
  }, []);

  const activeNetworkSnapshot = activeConnection ? networkSnapshot : null;
  const activeGameEvent = activeConnection ? gameEvent : null;
  const isConnected = activeNetworkSnapshot?.state === 'CONNECTED';
  const connectionMessage = useMemo(() => {
    if (!activeNetworkSnapshot) return null;
    if (activeNetworkSnapshot.state === 'CONNECTED') return `Connected to ${activeNetworkSnapshot.receiverName ?? receiver?.name ?? 'Active Kids TV'}.`;
    if (activeNetworkSnapshot.state === 'CONNECTING' || activeNetworkSnapshot.state === 'RECONNECTING') {
      return 'Trying to reach the receiver. Keep both devices on a local network that allows devices to communicate; guest networks or client isolation can block this.';
    }
    if (activeNetworkSnapshot.state === 'ERROR') return activeNetworkSnapshot.lastError ?? 'Pairing failed. Check the code shown on the TV.';
    return null;
  }, [activeNetworkSnapshot, receiver]);

  if (activeConnection && isConnected) {
    return (
      <CameraScreen
        onExit={leaveConnection}
        gameMode
        previewVisible={false}
        motionEnabled
        onMotionEvent={(event) => activeConnection.controller.handleMotionEvent(event)}
        onHorizontalMovement={(movement) => activeConnection.controller.handleMovement(movement)}
      >
        <RemoteControllerOverlay
          receiverName={activeNetworkSnapshot?.receiverName ?? activeConnection.receiver.name}
          discoveryMethod={activeConnection.receiver.discoveryMethod}
          network={activeNetworkSnapshot}
          reachabilityState={reachabilityState}
          gameEvent={activeGameEvent}
          onStart={() => activeConnection.controller.sendControl('START_GAME')}
          onPause={() => activeConnection.controller.sendControl('PAUSE')}
          onResume={() => activeConnection.controller.sendControl('RESUME')}
          onRestart={() => activeConnection.controller.sendControl('RESTART')}
          onExit={leaveConnection}
        />
      </CameraScreen>
    );
  }

  if (showScanner) {
    return (
      <View style={styles.scannerRoot}>
        <StatusBar hidden />
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={hasScanned ? undefined : ({ data }) => selectQr(data)}
          />
        ) : (
          <View style={styles.scannerPermission}>
            <Text style={styles.scannerTitle}>Camera access is needed to scan the TV code.</Text>
            <AppButton title="ALLOW CAMERA" onPress={() => void requestPermission()} />
          </View>
        )}
        <View style={styles.scannerTop}>
          <Text style={styles.scannerTitle}>SCAN THE TV CODE</Text>
          <Text style={styles.scannerDescription}>Point the back camera at the QR code on the receiver.</Text>
        </View>
        <View style={styles.scannerBottom}>
          {scanMessage && <Text style={styles.scanMessage}>{scanMessage}</Text>}
          <AppButton title="CANCEL" variant="light" onPress={() => setShowScanner(false)} />
          {hasScanned && <AppButton title="SCAN AGAIN" variant="secondary" onPress={() => { setHasScanned(false); setScanMessage(null); }} />}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.page}>
        <AppButton title="BACK" variant="light" onPress={onHome} style={styles.backButton} />
        <Text style={styles.eyebrow}>ACTIVE KIDS TV</Text>
        <Text style={styles.title}>Connect to your receiver</Text>
        <Text style={styles.description}>The receiver runs the game on the TV. This phone keeps the camera and sends motion controls over your local network.</Text>
        {networkType.toUpperCase() === 'NONE' && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>LOCAL NETWORK UNAVAILABLE</Text>
            <Text style={styles.statusText}>Connect this phone and the TV receiver to the same reachable Wi-Fi network. If the router blocks device traffic, a parent can connect the receiver to a hotspot created by this phone.</Text>
          </View>
        )}

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>{discovery.state === 'SEARCHING' ? 'SEARCHING FOR TV…' : 'LOCAL NETWORK'}</Text>
          <Text style={styles.statusText}>{discovery.message ?? (discovery.receivers.length ? `${discovery.receivers.length} Active Kids TV${discovery.receivers.length === 1 ? '' : 's'} found.` : 'Waiting for an Active Kids receiver on this network.')}</Text>
          {discovery.receivers.length === 0 && (
            <Text style={styles.statusText}>TV not found? Keep both devices on the same local network, disable guest Wi-Fi or client isolation, or scan the TV QR code. Manual address entry is available in developer mode.</Text>
          )}
          {discovery.receivers.map((candidate) => (
            <Text
              key={candidate.id}
              onPress={() => { setReceiver(candidate); setScanMessage(null); }}
              style={[styles.receiverChoice, receiver?.id === candidate.id && styles.receiverSelected]}
              accessibilityRole="button"
            >
              {candidate.name}{'\n'}<Text style={styles.receiverAddress}>{candidate.host}:{candidate.port}</Text>
            </Text>
          ))}
        </View>

        <View style={styles.actionRow}>
          <AppButton title="SCAN TV QR" onPress={() => { setHasScanned(false); setScanMessage(null); setShowScanner(true); }} style={styles.flexButton} />
          <AppButton title="SEARCH AGAIN" variant="secondary" onPress={() => setDiscoveryRetryKey((key) => key + 1)} style={styles.flexButton} />
        </View>

        {receiver && (
          <View style={styles.pairCard}>
            <Text style={styles.statusTitle}>PAIR WITH {receiver.name.toUpperCase()}</Text>
            <Text style={styles.statusText}>Enter the six-digit code displayed on the TV receiver.</Text>
            <TextInput
              value={pairingCode}
              onChangeText={(value) => setPairingCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={colors.textSecondary}
              style={styles.codeInput}
              accessibilityLabel="Six digit receiver pairing code"
            />
            <AppButton
              title="CONNECT TO TV"
              onPress={() => connect(receiver, pairingCode)}
              disabled={pairingCode.length !== 6 || Boolean(activeConnection)}
            />
            {connectionMessage && <Text style={styles.connectionMessage}>{connectionMessage}</Text>}
          </View>
        )}

        {activeConnection && !isConnected && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>{activeNetworkSnapshot?.state ?? 'CONNECTING'}</Text>
            <Text style={styles.statusText}>{connectionMessage ?? 'Connecting to receiver…'}</Text>
            <AppButton title="CANCEL" variant="secondary" onPress={leaveConnection} />
            {activeNetworkSnapshot?.state === 'ERROR' && receiver && (
              <AppButton
                title="TRY AGAIN"
                onPress={() => {
                  activeConnection.controller.disconnect();
                  connect(receiver, pairingCode);
                }}
              />
            )}
          </View>
        )}

        {__DEV__ && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>DEVELOPER NETWORK DETAILS</Text>
            <Text style={styles.statusText}>Phone: {phoneIp} · Network: {networkType}</Text>
            <Text style={styles.statusText}>Receiver: {receiver ? `${receiver.host}:${receiver.port}` : 'Not selected'}</Text>
            <Text style={styles.statusText}>Discovery: {getDiscoveryDiagnostic(receiver, discovery)}</Text>
            <Text style={styles.statusText}>Reachability: {reachabilityState}</Text>
            <Text style={styles.statusText}>WebSocket: {getWebSocketDiagnostic(activeNetworkSnapshot)}</Text>
            <Text style={styles.statusText}>Pairing: {getPairingDiagnostic(activeNetworkSnapshot)}</Text>
            <Text style={styles.statusText}>Game session: {getGameSessionDiagnostic(activeNetworkSnapshot, activeGameEvent)}</Text>
            <Text style={styles.statusText}>Ping: {activeNetworkSnapshot?.latencyMs == null ? 'Unavailable' : `${activeNetworkSnapshot.latencyMs} ms`} (heartbeat round-trip)</Text>
            {reachabilityState === 'FAIL' && activeNetworkSnapshot?.state === 'CONNECTED' && (
              <Text style={styles.statusText}>HTTP health probe failed, but WebSocket and pairing succeeded. Direct connection is working.</Text>
            )}
          </View>
        )}

        {__DEV__ && (
          <View style={styles.devCard}>
            <Text style={styles.statusTitle}>MANUAL CONNECTION · DEVELOPER</Text>
            <Text style={styles.statusText}>Use this only when mDNS is blocked. The address must be reachable on the local network.</Text>
            <View style={styles.manualRow}>
              <TextInput value={manualAddress} onChangeText={setManualAddress} placeholder="192.168.1.40" autoCapitalize="none" style={[styles.manualInput, styles.manualAddress]} />
              <TextInput value={manualPort} onChangeText={setManualPort} placeholder="8765" keyboardType="number-pad" style={[styles.manualInput, styles.manualPort]} />
            </View>
            <AppButton title="USE ADDRESS" variant="secondary" onPress={addManualReceiver} />
          </View>
        )}
        {scanMessage && !showScanner && <Text style={styles.scanMessage}>{scanMessage}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function RemoteControllerOverlay({
  receiverName,
  discoveryMethod,
  network,
  reachabilityState,
  gameEvent,
  onStart,
  onPause,
  onResume,
  onRestart,
  onExit,
}: {
  receiverName: string;
  discoveryMethod: ReceiverDescriptor['discoveryMethod'];
  network: NetworkSnapshot | null;
  reachabilityState: ReachabilityState;
  gameEvent: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  const {
    cameraStatus,
    bodyLean,
    bodyVisibility,
    beginNeutralCalibration,
    completeNeutralCalibration,
    errorMessage,
  } = useCameraGameSession();
  const calibrationStarted = useRef(false);

  useEffect(() => {
    if (cameraStatus !== 'ready' || bodyLean.calibrated || calibrationStarted.current) return;
    calibrationStarted.current = true;
    beginNeutralCalibration();
    const timer = setTimeout(() => {
      completeNeutralCalibration();
    }, BODY_LEAN_CONFIG.calibrationDurationMs);
    return () => clearTimeout(timer);
  }, [beginNeutralCalibration, bodyLean.calibrated, cameraStatus, completeNeutralCalibration]);

  const cameraReady = cameraStatus === 'ready' && bodyLean.calibrated;
  const tracking = bodyVisibility.state === 'FULL_BODY';
  const canStart = cameraReady && tracking && network?.state === 'CONNECTED';

  return (
    <SafeAreaView style={styles.remoteRoot}>
      <View style={styles.remoteHeader}>
        <View style={styles.remoteOnlineDot} />
        <Text style={styles.remoteTitle}>CONNECTED TO {receiverName.toUpperCase()}</Text>
        <AppButton title="DISCONNECT" variant="light" onPress={onExit} style={styles.disconnectButton} />
      </View>
      <View style={styles.remoteCenter}>
        <Text style={styles.remoteHeading}>Your body is the controller</Text>
        <Text style={styles.remoteText}>{canStart ? 'Stand back so the camera can see your whole body, then start the game on the TV.' : cameraStatus !== 'ready' ? 'Starting the camera and pose detection on this phone…' : !bodyLean.calibrated ? 'Stand normally while we find your center.' : 'Step back until your head, knees, and feet are visible.'}</Text>
        <View style={styles.remoteStatusRow}>
          <StatusPill label="TV" value={network?.state === 'CONNECTED' ? 'CONNECTED' : 'OFFLINE'} ready={network?.state === 'CONNECTED'} />
          <StatusPill label="CAMERA" value={cameraStatus === 'ready' ? 'READY' : cameraStatus.toUpperCase()} ready={cameraStatus === 'ready'} />
          <StatusPill label="TRACKING" value={tracking ? 'FULL BODY' : 'LOOKING'} ready={tracking} />
        </View>
        {gameEvent && <Text style={styles.remoteEvent}>{formatGameEvent(gameEvent)}</Text>}
        {errorMessage && <Text style={styles.remoteError}>{errorMessage}</Text>}
        {__DEV__ && (
          <View style={styles.remoteDiagnostics}>
            <Text style={styles.remoteDiagnosticText}>Discovery: {discoveryMethod === 'mDNS' ? 'PASS (mDNS)' : `BYPASSED (${discoveryMethod})`}</Text>
            <Text style={styles.remoteDiagnosticText}>Reachability: {reachabilityState}</Text>
            <Text style={styles.remoteDiagnosticText}>WebSocket: {getWebSocketDiagnostic(network)}</Text>
            <Text style={styles.remoteDiagnosticText}>Pairing: {getPairingDiagnostic(network)}</Text>
            <Text style={styles.remoteDiagnosticText}>Game session: {getGameSessionDiagnostic(network, gameEvent)}</Text>
            <Text style={styles.remoteDiagnosticText}>Ping: {network?.latencyMs == null ? 'Unavailable' : `${network.latencyMs} ms`}</Text>
            {reachabilityState === 'FAIL' && <Text style={styles.remoteDiagnosticText}>HTTP probe unavailable; direct WebSocket and pairing succeeded.</Text>}
          </View>
        )}
        {network?.state === 'CONNECTED' ? (
          <View style={styles.remoteButtons}>
            <AppButton title="START GAME" onPress={onStart} disabled={!canStart} style={styles.flexButton} />
            <AppButton title="PAUSE" variant="secondary" onPress={onPause} style={styles.flexButton} />
            <AppButton title="RESUME" variant="secondary" onPress={onResume} style={styles.flexButton} />
            <AppButton title="RESTART" variant="light" onPress={onRestart} style={styles.flexButton} />
          </View>
        ) : (
          <Text style={styles.remoteError}>TV connection lost. Reconnect from the home screen.</Text>
        )}
        <Text style={styles.remotePrivacy}>Pose detection stays on this phone. No camera video is sent to the TV.</Text>
      </View>
    </SafeAreaView>
  );
}

function StatusPill({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <View style={styles.statusPill}>
      <View style={[styles.remoteOnlineDot, !ready && styles.remoteOfflineDot]} />
      <Text style={styles.statusPillLabel}>{label}</Text>
      <Text style={styles.statusPillValue}>{value}</Text>
    </View>
  );
}

function getDiscoveryDiagnostic(receiver: ReceiverDescriptor | null, discovery: ReturnType<typeof useReceiverDiscovery>): string {
  if (receiver?.discoveryMethod === 'mDNS') return 'PASS (mDNS receiver found)';
  if (receiver) return `BYPASSED (${receiver.discoveryMethod})`;
  if (discovery.receivers.length > 0) return 'PASS (receiver found)';
  if (discovery.state === 'SEARCHING') return 'SEARCHING';
  return discovery.message ? 'UNAVAILABLE' : discovery.state;
}

function getWebSocketDiagnostic(network: NetworkSnapshot | null): string {
  if (network?.state === 'CONNECTED') return 'PASS (OPEN)';
  if (network?.webSocketOpen) return 'OPEN · WAITING FOR WELCOME';
  if (network?.state === 'ERROR') return 'FAIL';
  if (network?.state === 'CONNECTING' || network?.state === 'RECONNECTING') return network.state;
  return 'NOT RUN';
}

function getPairingDiagnostic(network: NetworkSnapshot | null): string {
  if (network?.state === 'CONNECTED') return 'PASS (WELCOME accepted)';
  if (network?.state === 'ERROR') {
    const error = network.lastError?.toLowerCase() ?? '';
    if (error.includes('pair') || error.includes('code') || error.includes('unsupported network protocol')) return 'FAIL';
    return 'NOT CONFIRMED';
  }
  return network?.state === 'CONNECTING' || network?.state === 'RECONNECTING' ? 'WAITING' : 'NOT RUN';
}

function getGameSessionDiagnostic(network: NetworkSnapshot | null, event: string | null): string {
  if (event === 'GAME_STARTED') return 'ACTIVE';
  if (event === 'GAME_PAUSED') return 'PAUSED';
  if (event === 'GAME_FINISHED' || event === 'MISSION_COMPLETED') return 'COMPLETE';
  return network?.state === 'CONNECTED' ? 'READY' : 'WAITING';
}

function formatGameEvent(event: string): string {
  const messages: Record<string, string> = {
    GAME_STARTED: 'The adventure has started!',
    CHECKPOINT_REACHED: 'Checkpoint reached!',
    MISSION_COMPLETED: 'Mission complete! Nice work!',
    PLAYER_DIED: 'Back to the checkpoint. Try again!',
    GAME_PAUSED: 'The game is paused.',
    GAME_FINISHED: 'Great job! Adventure complete!',
    CONNECTION_WARNING: 'The TV connection needs attention.',
  };
  return messages[event] ?? '';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, gap: spacing.md },
  backButton: { alignSelf: 'flex-start', minWidth: 90 },
  eyebrow: { color: colors.primaryDark, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '900' },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  statusCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.white, gap: spacing.sm },
  statusTitle: { color: colors.primaryDark, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  statusText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  receiverChoice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: '#EFF6FF', color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '800' },
  receiverSelected: { borderWidth: 2, borderColor: colors.primary },
  receiverAddress: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  flexButton: { flex: 1 },
  pairCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: '#EAF5FF', gap: spacing.sm },
  codeInput: { minHeight: 58, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.white, color: colors.text, textAlign: 'center', fontSize: 28, fontWeight: '900', letterSpacing: 8 },
  connectionMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  devCard: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, gap: spacing.sm },
  manualRow: { flexDirection: 'row', gap: spacing.sm },
  manualInput: { minHeight: 46, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, color: colors.text },
  manualAddress: { flex: 1 },
  manualPort: { width: 86, textAlign: 'center' },
  scanMessage: { color: colors.primaryDark, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  scannerRoot: { flex: 1, backgroundColor: '#101B2A' },
  scannerPermission: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  scannerTop: { position: 'absolute', top: 0, left: 0, right: 0, padding: spacing.lg, backgroundColor: 'rgba(6,21,35,0.72)' },
  scannerBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg, gap: spacing.sm, backgroundColor: 'rgba(6,21,35,0.72)' },
  scannerTitle: { color: colors.white, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  scannerDescription: { marginTop: spacing.xs, color: colors.white, fontSize: 14, textAlign: 'center' },
  remoteRoot: { flex: 1, backgroundColor: 'rgba(7,23,39,0.86)', justifyContent: 'space-between', padding: spacing.lg },
  remoteHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  remoteOnlineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#42D392' },
  remoteOfflineDot: { backgroundColor: '#FFB454' },
  remoteTitle: { flex: 1, color: colors.white, fontSize: 13, fontWeight: '900', letterSpacing: 0.7 },
  disconnectButton: { minHeight: 38 },
  remoteCenter: { alignItems: 'center', alignSelf: 'center', width: '100%', maxWidth: 780, gap: spacing.md },
  remoteHeading: { color: colors.white, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  remoteText: { maxWidth: 600, color: '#DCE9F5', fontSize: 17, lineHeight: 25, textAlign: 'center' },
  remoteStatusRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  statusPill: { minWidth: 120, padding: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', gap: 4 },
  statusPillLabel: { color: '#B7D1E8', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  statusPillValue: { color: colors.white, fontSize: 13, fontWeight: '800' },
  remoteEvent: { color: '#FFE187', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  remoteError: { color: '#FFD3A1', fontSize: 15, textAlign: 'center' },
  remoteButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, width: '100%' },
  remotePrivacy: { color: '#C6D8E8', fontSize: 12, textAlign: 'center' },
  remoteDiagnostics: { width: '100%', padding: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.12)', gap: 3 },
  remoteDiagnosticText: { color: '#DCE9F5', fontSize: 11, fontFamily: 'monospace' },
});
