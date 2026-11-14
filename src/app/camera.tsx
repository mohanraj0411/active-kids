import { useRouter } from 'expo-router';

import { CameraScreen } from '../screens/CameraScreen';

export default function CameraRoute() {
  const router = useRouter();

  return <CameraScreen onExit={() => router.replace('/')} />;
}
