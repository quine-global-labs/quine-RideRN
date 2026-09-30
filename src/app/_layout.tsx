import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DispatchProvider } from '@/lib/dispatch/DispatchContext';
import { RideProvider } from '@/lib/RideContext';

export default function RootLayout() {
  return (
    <DispatchProvider>
      <RideProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: '#111', contentStyle: { backgroundColor: '#fff' } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ presentation: 'modal', title: 'Where to?' }} />
          <Stack.Screen name="finding" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="trip" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="trips" options={{ title: 'Your trips' }} />
          <Stack.Screen name="driver" options={{ headerShown: false }} />
        </Stack>
      </RideProvider>
    </DispatchProvider>
  );
}
