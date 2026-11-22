import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { CameraStatus, type StatusTone } from '../components/CameraStatus';
import type { CameraPermissionState } from '../detection/types';
import { colors, radius, spacing } from '../theme';

type HomeScreenProps = {
  onStartGame: () => void;
  onPlayOnTv: () => void;
};

export function HomeScreen({ onStartGame, onPlayOnTv }: HomeScreenProps) {
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
          <Text style={styles.title}>Your body is the controller.</Text>
          <Text style={styles.subtitle}>
            Run, jump, swing, and crouch to guide your explorer. Play here or
            connect this phone to an Active Kids TV receiver.
          </Text>
          <View style={styles.moveList} accessibilityLabel="Run, jump, swing, and crouch">
            {[
              ['RUN', '↗'],
              ['JUMP', '↑'],
              ['SWING', '↻'],
              ['CROUCH', '↓'],
            ].map(([label, icon]) => (
              <View key={label} style={styles.moveChip}>
                <Text style={styles.moveIcon} accessibilityElementsHidden>{icon}</Text>
                <Text style={styles.moveLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footer}>
          <CameraStatus
            label="Camera"
            value={cameraStatus}
            tone={cameraTone}
          />

          <AppButton
            title="PLAY ON PHONE"
            accessibilityLabel="Play on this phone"
            onPress={onStartGame}
            style={styles.startButton}
          />
          <AppButton
            title="PLAY ON TV"
            accessibilityLabel="Find and connect to an Active Kids TV receiver"
            variant="secondary"
            onPress={onPlayOnTv}
            style={styles.startButton}
          />

          <Text style={styles.footerText}>
            Stand several feet back so the camera can see your whole body.
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
  moveList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  moveChip: {
    minWidth: 74,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moveIcon: {
    color: colors.primaryDark,
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900',
  },
  moveLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
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
