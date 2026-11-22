export type MissionEvent = 'STAR_COLLECTED' | 'ENEMY_DEFEATED' | 'JUMP_SUCCESS' | 'COMBO';

export interface MissionReward {
  points: number;
  bonusStars: number;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
  reward: MissionReward;
}

export interface MissionCompletion {
  mission: Mission;
  nextMission: Mission | null;
}

const MISSION_TEMPLATES: Omit<Mission, 'progress' | 'completed'>[] = [
  { id: 'collect-stars', title: 'STAR SEEKER', description: 'Collect 5 stars', target: 5, reward: { points: 25, bonusStars: 1 } },
  { id: 'help-friends', title: 'SPIDER HELPER', description: 'Help 2 spider friends', target: 2, reward: { points: 25, bonusStars: 1 } },
  { id: 'jump-high', title: 'JUMPING STAR', description: 'Land 3 jumps', target: 3, reward: { points: 25, bonusStars: 1 } },
  { id: 'build-combo', title: 'COMBO CREW', description: 'Reach combo x3', target: 3, reward: { points: 25, bonusStars: 1 } },
];

/** One active, short mission at a time; progress lives only for this run. */
export class MissionManager {
  private missions: Mission[] = [];
  private activeIndex = 0;

  constructor() {
    this.reset();
  }

  get current(): Mission | null {
    const mission = this.missions[this.activeIndex];
    return mission ? copyMission(mission) : null;
  }

  get totalBonusStars(): number {
    return this.missions.reduce((sum, mission) => sum + mission.reward.bonusStars, 0);
  }

  record(event: MissionEvent, value = 1): MissionCompletion | null {
    const mission = this.missions[this.activeIndex];
    if (!mission || mission.completed || !matchesEvent(mission.id, event)) return null;
    mission.progress = event === 'COMBO'
      ? Math.min(mission.target, Math.max(mission.progress, Math.floor(value)))
      : Math.min(mission.target, mission.progress + Math.max(1, Math.floor(value)));
    if (mission.progress < mission.target) return null;

    mission.completed = true;
    this.activeIndex += 1;
    return {
      mission: copyMission(mission),
      nextMission: this.current,
    };
  }

  reset(): void {
    this.missions = MISSION_TEMPLATES.map((template) => ({
      ...template,
      reward: { ...template.reward },
      progress: 0,
      completed: false,
    }));
    this.activeIndex = 0;
  }
}

function matchesEvent(missionId: string, event: MissionEvent): boolean {
  if (missionId === 'collect-stars') return event === 'STAR_COLLECTED';
  if (missionId === 'help-friends') return event === 'ENEMY_DEFEATED';
  if (missionId === 'jump-high') return event === 'JUMP_SUCCESS';
  return missionId === 'build-combo' && event === 'COMBO';
}

function copyMission(mission: Mission): Mission {
  return { ...mission, reward: { ...mission.reward } };
}
