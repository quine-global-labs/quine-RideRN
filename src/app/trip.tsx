import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TripSummary } from '@/components/TripSummary';
import { tripFromRide, useRide } from '@/lib/RideContext';

export default function TripCompleteScreen() {
  const insets = useSafeAreaInsets();
  const { ride, completeTrip } = useRide();
  // Keep the trip this screen opened with, so completing it doesn't redirect mid-transition.
  const [trip] = useState(() => (ride?.status === 'completed' ? tripFromRide(ride) : null));
  const [saving, setSaving] = useState(false);

  if (!trip) return <Redirect href="/" />;

  const done = async () => {
    setSaving(true);
    await completeTrip();
    router.dismissAll();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.header}>
        <Text style={styles.check}>✓</Text>
        <Text style={styles.title} testID="ride-status">
          You’ve arrived
        </Text>
        <Text style={styles.subtitle}>Thanks for riding with {trip.driver.name}.</Text>
      </View>
      <TripSummary trip={trip} />
      <Pressable
        style={[styles.button, saving && styles.disabled]}
        onPress={done}
        disabled={saving}
        accessibilityRole="button"
        testID="trip-done"
      >
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, justifyContent: 'space-between' },
  header: { alignItems: 'center', gap: 8, marginTop: 48 },
  check: {
    fontSize: 36,
    color: '#fff',
    backgroundColor: '#1a8f3c',
    width: 72,
    height: 72,
    lineHeight: 72,
    borderRadius: 36,
    overflow: 'hidden',
    textAlign: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 16, color: '#666' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
