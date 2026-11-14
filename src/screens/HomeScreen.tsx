import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { CameraStatus, type StatusTone } from '../components/CameraStatus';
import type { CameraPermissionState } from '../detection/types';
import { colors, radius, spacing } from '../theme';

type HomeScreenProps = {
  onStartGame: () => void;
};

export function HomeScreen({ onStartGame }: HomeScreenProps) {
  const [permission] = useCameraPermissions();
  let permissionState: CameraPermissionState = 'checking';
  if (permission !== null) {
    permissionState = permission.granted ? 'granted' : 'denied';
  }
  let cameraStatus = 'Checking permission';
  let cameraTone: StatusTone = 'neutral';

  if (permissionState === 'granted') {
    cameraStatus = 'Ready';
    cameraTone = 'ready';
  } else if (permissionState === 'denied') {
    cameraStatus = 'Permission required';
    cameraTone = 'attention';
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>AK</Text>
          </View>
          <Text style={styles.logoText}>ACTIVE KIDS</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroMark}>
            <Text style={styles.heroMarkText}>MOVE &amp; PLAY</Text>
          </View>
          <Text style={styles.title}>Move your body. Control the game.</Text>
          <Text style={styles.subtitle}>
            Get ready to move and play. On-device pose detection finds your
            body in the live camera preview.
          </Text>
        </View>

        <View style={styles.footer}>
          <CameraStatus
            label="Camera"
            value={cameraStatus}
            tone={cameraTone}
          />

          <AppButton
            title="START GAME"
            accessibilityLabel="Start game"
            onPress={onStartGame}
            style={styles.startButton}
          />

          <Text style={styles.footerText}>
            Camera permission is requested only when you start.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    width: '100%',
    maxWidth: 520,
    flex: 1,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  logoBadgeText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  logoText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  heroMark: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: '#E8E9FF',
  },
  heroMarkText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    maxWidth: 380,
    color: colors.text,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 350,
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  footer: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  startButton: {
    width: '100%',
    minHeight: 60,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
