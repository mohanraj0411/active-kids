import { useRouter } from 'expo-router';

import { ConnectTVScreen } from '../screens/ConnectTVScreen';

export default function ConnectTVRoute() {
  const router = useRouter();
  return <ConnectTVScreen onHome={() => router.replace('/')} />;
}
