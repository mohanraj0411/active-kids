import type { GameAction, GameConfig, ScoringConfig, TargetMetadata } from './types';

export const GAME_CONFIG: Readonly<GameConfig> = {
  totalRounds: 7,
  targetDurationMs: 5_000,
  successFeedbackMs: 700,
  missFeedbackMs: 700,
  countdownSeconds: 3,
  countdownGoDurationMs: 450,
};

export const SCORE_CONFIG: Readonly<ScoringConfig> = {
  correctGesture: 10,
  missedGesture: 0,
  wrongGesture: 0,
  comboBonusEvery: 3,
  comboBonus: 10,
};

export const TARGET_CONFIG: Readonly<{
  sequence: readonly GameAction[];
  actions: Readonly<Record<GameAction, TargetMetadata>>;
}> = {
  sequence: [
    'LEFT_HAND_UP',
    'RIGHT_HAND_UP',
    'BOTH_HANDS_UP',
    'SQUAT',
    'JUMP',
    'MOVE_LEFT',
    'MOVE_RIGHT',
  ],
  actions: {
    LEFT_HAND_UP: {
      title: 'Raise Your Left Hand',
      instruction: 'Raise your left hand above your shoulder',
      icon: '✋',
    },
    RIGHT_HAND_UP: {
      title: 'Raise Your Right Hand',
      instruction: 'Raise your right hand above your shoulder',
      icon: '✋',
    },
    BOTH_HANDS_UP: {
      title: 'Both Hands Up',
      instruction: 'Raise both hands above your shoulders',
      icon: '🙌',
    },
    SQUAT: {
      title: 'Squat',
      instruction: 'Bend your knees and squat down',
      icon: '🧎',
    },
    JUMP: {
      title: 'Jump',
      instruction: 'Jump once',
      icon: '⬆️',
    },
    MOVE_LEFT: {
      title: 'Move Left',
      instruction: 'Move your body to the left',
      icon: '⬅️',
    },
    MOVE_RIGHT: {
      title: 'Move Right',
      instruction: 'Move your body to the right',
      icon: '➡️',
    },
  },
};
