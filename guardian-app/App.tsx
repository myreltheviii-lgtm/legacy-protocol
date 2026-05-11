import 'react-native-get-random-values';
import { useEffect } from 'react';
import { AppNavigator } from "./src/navigation/AppNavigator";
import { startSigningService } from "./src/lib/worklet-boot";

export default function App() {
  useEffect(() => {
    startSigningService().catch(console.error);
  }, []);

  return AppNavigator();
}
