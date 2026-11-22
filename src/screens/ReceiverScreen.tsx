import QRCode from 'react-native-qrcode-svg';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PlatformerRenderer } from '../game/platformer/PlatformerRenderer';
import { usePlatformerRuntime } from '../game/platformer/usePlatformerRuntime';
import { NetworkManager, type NetworkSnapshot } from '../network/NetworkManager';
import { NetworkInputAdapter } from '../network/NetworkInputAdapter';
import { getReceiverWebSocketUrl } from '../network/address';
import { buildReceiverQrData } from '../network/pairing';
import type { ReceiverDescriptor } from '../network/receiverTypes';
import { TVController, type TVControllerSnapshot } from '../network/TVController';
import { NETWORK_PROTOCOL_VERSION } from '../network/networkConstants';

export function ReceiverScreen() {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const runtime = usePlatformerRuntime(Math.max(240, width), Math.max(220, height));
  const { input, snapshot, publish } = runtime;
  const networkInput = useMemo(() => new NetworkInputAdapter(input), [input]);
  const endpoint = getReceiverWebSocketUrl();
  const network = useMemo(() => endpoint
    ? new NetworkManager(endpoint, 'TV_HOST', { clientId: `receiver-${makeReceiverClientId()}` })
    : null, [endpoint]);
  const [networkState, setNetworkState] = useState<NetworkSnapshot | null>(null);
  const [remoteState, setRemoteState] = useState<TVControllerSnapshot | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState('CHECKING');
  const priorSnapshot = useRef(snapshot);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof globalThis.window === 'undefined') return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshDiscoveryStatus = async () => {
      try {
        const response = await globalThis.fetch(new URL('/api/receiver', globalThis.window.location.origin).toString(), {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Receiver status unavailable');
        const details = await response.json() as { discoveryStatus?: unknown };
        if (!active) return;
        const nextStatus = typeof details.discoveryStatus === 'string' ? details.discoveryStatus : 'UNKNOWN';
        setDiscoveryStatus(nextStatus);
        if (nextStatus === 'STARTING') retryTimer = setTimeout(() => void refreshDiscoveryStatus(), 1_000);
      } catch {
        if (active) setDiscoveryStatus('UNAVAILABLE');
      }
    };
    void refreshDiscoveryStatus();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!network) return;
    const unsubscribe = network.subscribe(setNetworkState);
    network.connect();
    return () => {
      unsubscribe();
      network.disconnect('Receiver page closed');
    };
  }, [network]);

  const handleControl = useCallback((action: Parameters<NetworkInputAdapter['control']>[0]) => {
    networkInput.control(action);
    publish();
  }, [networkInput, publish]);

  useEffect(() => {
    if (!network) return;
    const controller = new TVController(network, input, {
      onChange: setRemoteState,
      onControl: handleControl,
      onGameInput: publish,
    });
    return () => controller.dispose();
  }, [handleControl, input, network, publish]);

  useEffect(() => {
    if (networkState?.state !== 'CONNECTED' || !remoteState?.phoneConnected || !network) {
      priorSnapshot.current = snapshot;
      return;
    }
    const previous = priorSnapshot.current;
    if (snapshot.performance.checkpointReached > previous.performance.checkpointReached) {
      network.sendGameEvent('CHECKPOINT_REACHED');
    }
    if (snapshot.missionToast?.id !== previous.missionToast?.id && snapshot.missionToast) {
      network.sendGameEvent('MISSION_COMPLETED');
    }
    if (snapshot.hearts < previous.hearts) network.sendGameEvent('PLAYER_DIED');
    if (snapshot.status !== previous.status) {
      if (snapshot.status === 'PLAYING' && previous.status !== 'PAUSED') network.sendGameEvent('GAME_STARTED');
      else if (snapshot.status === 'PAUSED') network.sendGameEvent('GAME_PAUSED');
      else if (snapshot.status === 'COMPLETE') network.sendGameEvent('GAME_FINISHED');
    }
    priorSnapshot.current = snapshot;
  }, [network, networkState?.state, remoteState?.phoneConnected, snapshot]);

  const receiver = getReceiverDescriptor(network, endpoint);
  const pairingCode = networkState?.pairingCode;
  const paired = Boolean(networkState?.state === 'CONNECTED' && remoteState?.phoneConnected);
  const showPairingCard = !paired || snapshot.status === 'READY';

  return (
    <View style={styles.root}>
      <StatusBar hidden={Platform.OS !== 'web'} barStyle="light-content" />
      <PlatformerRenderer state={snapshot} width={width} height={height} onRenderTime={runtime.recordReactRender} />
      {showPairingCard && (
        <View pointerEvents="box-none" style={styles.overlay}>
          <View style={styles.receiverCard}>
            <Text style={styles.brand}>ACTIVE KIDS</Text>
            <Text style={styles.eyebrow}>TV RECEIVER</Text>
            <View style={styles.receiverStatus}>
              <View style={[styles.dot, paired ? styles.dotReady : null]} />
              <Text style={styles.receiverStatusText}>{getReceiverStatus(networkState, remoteState)}</Text>
            </View>
            <View style={styles.receiverDetails}>
              <Text style={styles.receiverDetail}>NETWORK: {networkState?.state === 'CONNECTED' ? 'READY' : 'STARTING'}</Text>
              <Text style={styles.receiverDetail}>IP: {receiver?.host ?? 'Unavailable'}</Text>
              <Text style={styles.receiverDetail}>DISCOVERY: {discoveryStatus}</Text>
              <Text style={styles.receiverDetail}>PHONE: {paired ? 'CONNECTED' : 'WAITING'}</Text>
              {paired && <Text style={styles.readyToPlay}>STATUS: READY TO PLAY</Text>}
            </View>
            {networkState?.state === 'ERROR' && (
              <Text style={styles.receiverDescription}>{networkState.lastError ?? 'Receiver connection failed.'}</Text>
            )}
            {!endpoint && <Text style={styles.receiverDescription}>Open this page from the receiver host at its local network address, usually port 8765.</Text>}
            {paired ? (
              <Text style={styles.receiverDescription}>Phone connected. Press START GAME on the phone when ready.</Text>
            ) : pairingCode ? (
              <>
                <Text style={styles.receiverDescription}>On the phone, choose this TV and enter the pairing code, or scan this QR code.</Text>
                {receiver && <QRCode value={buildReceiverQrData(receiver, pairingCode)} size={190} backgroundColor="#FFFFFF" color="#10253A" />}
                <Text style={styles.pairingCode}>{pairingCode}</Text>
                <Text style={styles.receiverName}>{networkState?.receiverName ?? receiver?.name ?? 'Active Kids TV'}</Text>
              </>
            ) : (
              <Text style={styles.receiverDescription}>Connecting to the local receiver service…</Text>
            )}
            <Text style={styles.receiverFooter}>No screen casting · Local network only · Protocol v{NETWORK_PROTOCOL_VERSION}</Text>
          </View>
        </View>
      )}
      {paired && snapshot.status === 'PLAYING' && (
        <View pointerEvents="none" style={styles.playingBadge}>
          <View style={[styles.dot, styles.dotReady]} />
          <Text style={styles.playingText}>PHONE CONNECTED</Text>
        </View>
      )}
      {paired && snapshot.status === 'PAUSED' && (
        <View pointerEvents="none" style={styles.pausedBadge}><Text style={styles.pausedText}>PAUSED</Text></View>
      )}
      {__DEV__ && networkState && (
        <View pointerEvents="none" style={styles.diagnostics}>
          <Text style={styles.diagnosticText}>TV {networkState.state} · PHONE {remoteState?.phoneConnected ? 'CONNECTED' : 'WAITING'} · NETWORK RTT {networkState.latencyMs == null ? 'N/A' : `${networkState.latencyMs.toFixed(0)} ms`}</Text>
          <Text style={styles.diagnosticText}>INPUT #{remoteState?.lastSequence ?? 0} {remoteState?.lastAction ?? '—'} · INPUT RATE {remoteState?.inputRatePerSecond ?? 0} Hz · MOVE {remoteState?.movement.toFixed(2) ?? '0.00'} · PROTOCOL v{NETWORK_PROTOCOL_VERSION}</Text>
        </View>
      )}
    </View>
  );
}

function getReceiverDescriptor(network: NetworkManager | null, endpoint: string | null): ReceiverDescriptor | null {
  if (!network || !endpoint) return null;
  try {
    const url = new URL(endpoint);
    const state = network.getSnapshot();
    return {
      id: state.receiverId ?? 'active-kids-receiver',
      name: state.receiverName ?? 'Active Kids TV',
      host: url.hostname,
      port: Number(url.port || 8765),
      endpoint,
      discoveryMethod: 'mDNS',
      protocolVersion: NETWORK_PROTOCOL_VERSION,
    };
  } catch {
    return null;
  }
}

function getReceiverStatus(network: NetworkSnapshot | null, remote: TVControllerSnapshot | null): string {
  if (network?.state === 'ERROR') return 'Needs attention';
  if (remote?.phoneConnected) return 'PHONE CONNECTED';
  if (network?.state === 'CONNECTED') return 'READY · WAITING FOR PHONE';
  if (network?.state === 'RECONNECTING') return 'RECONNECTING';
  if (network?.state === 'CONNECTING') return 'CONNECTING TO LOCAL SERVICE';
  return 'START THE RECEIVER SERVICE';
}

function makeReceiverClientId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#162B3E' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(5,16,28,0.28)' },
  receiverCard: { alignItems: 'center', width: '100%', maxWidth: 560, padding: 28, borderRadius: 28, backgroundColor: 'rgba(248,252,255,0.97)', gap: 12 },
  brand: { color: '#245F91', fontSize: 15, fontWeight: '900', letterSpacing: 2 },
  eyebrow: { color: '#334B60', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  receiverStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#E8AA52' },
  dotReady: { backgroundColor: '#36B77B' },
  receiverStatusText: { color: '#18364D', fontSize: 15, fontWeight: '900', letterSpacing: 0.6 },
  receiverDetails: { alignSelf: 'stretch', padding: 12, borderRadius: 12, backgroundColor: '#EEF4F8', gap: 5 },
  receiverDetail: { color: '#334B60', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  readyToPlay: { color: '#14844E', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  receiverDescription: { maxWidth: 440, color: '#455C70', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  pairingCode: { color: '#10253A', fontSize: 42, fontWeight: '900', letterSpacing: 12, marginLeft: 12 },
  receiverName: { color: '#18364D', fontSize: 17, fontWeight: '800' },
  receiverFooter: { marginTop: 4, color: '#718396', fontSize: 11, textAlign: 'center' },
  playingBadge: { position: 'absolute', top: 20, right: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(9,29,46,0.72)' },
  playingText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  pausedBadge: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,16,28,0.45)' },
  pausedText: { color: '#FFFFFF', fontSize: 42, fontWeight: '900', letterSpacing: 4 },
  diagnostics: { position: 'absolute', left: 12, bottom: 8, padding: 8, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.58)' },
  diagnosticText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'monospace' },
});
