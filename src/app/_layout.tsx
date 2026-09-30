import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { device } from '@/lib/dispatch/device';
import { DispatchProvider } from '@/lib/dispatch/DispatchContext';
import { RideProvider } from '@/lib/RideContext';

// The rider app and the driver app share this codebase; each only exposes its own screens.
// Opening a guarded route (including "/" in the driver app) lands on the first allowed screen.
const isDriverApp = device.role === 'driver';

export default function RootLayout() {
  return (
    <DispatchProvider>
      <RideProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: '#111', contentStyle: { backgroundColor: '#fff' } }}>
          <Stack.Protected guard={!isDriverApp}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={{ presentation: 'modal', title: 'Where to?' }} />
            <Stack.Screen name="finding" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
            <Stack.Screen name="trip" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="trips" options={{ title: 'Your trips' }} />
          </Stack.Protected>
          <Stack.Protected guard={isDriverApp}>
            <Stack.Screen name="driver" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
      </RideProvider>
    </DispatchProvider>
  );
}
