import { PlatformerScreen } from './PlatformerScreen';

type GameScreenProps = { onHome: () => void };

/** PLAY enters the local camera-controlled platformer directly. */
export function GameScreen({ onHome }: GameScreenProps) {
  return <PlatformerScreen onHome={onHome} />;
}
