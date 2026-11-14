import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  PoseDetectorCameraProps,
} from './types';

export type { PoseDetectorCameraProps } from './types';

/**
 * Web fallback. Native iOS/Android builds resolve the platform-specific camera
 * implementation, while web reports the unsupported local inference platform.
 */
export function PoseDetectorCamera({ onError }: PoseDetectorCameraProps) {
  useEffect(() => {
    onError('unsupportedDevice');
  }, [onError]);

  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        On-device pose detection needs an iOS or Android development build.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#111827',
  },
  fallbackText: {
    maxWidth: 320,
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
});
