import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export type StatusTone = 'neutral' | 'ready' | 'attention' | 'error';

type CameraStatusProps = {
  label: string;
  value: string;
  tone?: StatusTone;
  dark?: boolean;
};

export function CameraStatus({
  label,
  value,
  tone = 'neutral',
  dark = false,
}: CameraStatusProps) {
  const toneStyle = styles[tone];

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.container, dark ? styles.darkContainer : styles.lightContainer]}
    >
      <Text style={[styles.label, dark && styles.darkLabel]}>{label}</Text>
      <View style={styles.valueRow}>
        <View style={[styles.dot, toneStyle]} />
        <Text style={[styles.value, dark && styles.darkValue]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 68,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  lightContainer: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  darkContainer: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  label: {
    marginBottom: spacing.xs,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  darkLabel: {
    color: 'rgba(255,255,255,0.75)',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  neutral: {
    backgroundColor: '#9CA3AF',
  },
  ready: {
    backgroundColor: '#22A06B',
  },
  attention: {
    backgroundColor: '#D99000',
  },
  error: {
    backgroundColor: '#D64545',
  },
  value: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  darkValue: {
    color: colors.white,
  },
});
