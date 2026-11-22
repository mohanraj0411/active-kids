import { useEffect, useState } from 'react';
import type Zeroconf from 'react-native-zeroconf';
import type { Service } from 'react-native-zeroconf';

import { NETWORK_PROTOCOL_VERSION, NETWORK_RECEIVER_SERVICE_TYPE } from './networkConstants';
import { parseReceiverService } from './receiverDiscovery';
import type { ReceiverDescriptor, ReceiverDiscoverySnapshot } from './receiverTypes';

const INITIAL_SNAPSHOT: ReceiverDiscoverySnapshot = {
  state: 'SEARCHING',
  receivers: [],
  message: null,
};

export function useReceiverDiscovery(retryKey = 0): ReceiverDiscoverySnapshot {
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);

  useEffect(() => {
    let active = true;
    let zeroconf: Zeroconf | null = null;
    let searchTimeout: ReturnType<typeof setTimeout> | null = null;
    const receivers = new Map<string, ReceiverDescriptor>();
    const publish = (message: string | null = null) => {
      if (!active) return;
      setSnapshot({
        state: receivers.size > 0 ? 'READY' : message ? 'UNAVAILABLE' : 'SEARCHING',
        receivers: [...receivers.values()].sort((first, second) => first.name.localeCompare(second.name)),
        message,
      });
    };

    const startDiscovery = (ZeroconfModule: typeof import('react-native-zeroconf').default) => {
      let instance: Zeroconf;
      try {
        instance = new ZeroconfModule();
        zeroconf = instance;
      } catch {
        publish('Automatic discovery is unavailable in this app build. Scan the TV code instead.');
        return;
      }

    const onResolved = (service: Service) => {
      if (service.txt?.deviceType !== 'receiver') return;
      if (Number(service.txt.protocolVersion) !== NETWORK_PROTOCOL_VERSION) {
        publish('A receiver was found, but it needs an update.');
        return;
      }
      const receiver = parseReceiverService(service);
      if (!receiver) return;
      receivers.set(receiver.id, receiver);
      publish();
    };
    const onRemove = (name: string) => {
      for (const [id, receiver] of receivers) {
        if (receiver.name === name) receivers.delete(id);
      }
      publish();
    };
    const onError = (error: Error) => {
      publish(error.message || 'Local network discovery is unavailable. Scan the TV code instead.');
    };
    instance.on('resolved', onResolved);
    instance.on('remove', onRemove);
    instance.on('error', onError);

    void instance.checkLocalNetworkAccess({ type: NETWORK_RECEIVER_SERVICE_TYPE, timeout: 4 })
      .then((access) => {
        if (!active) return;
        if (access === 'denied') {
          publish('Allow local network access in device settings, or scan the TV code.');
          return;
        }
        instance.scan({ type: NETWORK_RECEIVER_SERVICE_TYPE, protocol: 'tcp', resolveTimeout: 4 });
        publish();
        searchTimeout = setTimeout(() => {
          if (!receivers.size) publish('No receiver found yet. Check that the TV receiver is on the same reachable local network.');
        }, 8_000);
      })
      .catch(() => publish('Local network discovery is unavailable. Scan the TV code instead.'));
    };

    // Load the native package lazily so Expo Go can still open the app and use QR pairing.
    void import('react-native-zeroconf')
      .then(({ default: ZeroconfModule }) => { if (active) startDiscovery(ZeroconfModule); })
      .catch(() => publish('Automatic discovery is unavailable in this app build. Scan the TV code instead.'));

    return () => {
      active = false;
      if (searchTimeout) clearTimeout(searchTimeout);
      try {
        zeroconf?.stop();
        zeroconf?.removeAllListeners();
        zeroconf?.removeDeviceListeners();
      } catch {
        // The native discovery module may be absent in an Expo Go binary.
      }
    };
  }, [retryKey]);

  return snapshot;
}

