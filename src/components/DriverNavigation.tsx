import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RideMap } from '@/components/RideMap';
import { useRide } from '@/lib/RideContext';
import type { NavRoute } from '@/lib/navigation';

// How long each simulated step lasts before the next maneuver comes up.
const STEP_MS = 5000;

/**
 * Full-screen turn-by-turn navigation. It keeps advancing while other UI (like a ride
 * request) sits on top of it, and stops at the last step; give it a new `key` to start
 * a different route.
 */
export function DriverNavigation({ route }: { route: NavRoute }) {
  const insets = useSafeAreaInsets();
  const { pickup: position } = useRide();
  const [index, setIndex] = useState(0);
  const last = route.steps.length - 1;

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, last)), STEP_MS);
    return () => clearInterval(timer);
  }, [last]);

  const step = route.steps[index];
  const next = index < last ? route.steps[index + 1] : null;

  return (
    <View style={StyleSheet.absoluteFill} testID="driver-navigation">
      <RideMap
        pickup={position}
        userLocation={null}
        showsUserLocation={false}
        destination={null}
        route={null}
        topInset={insets.top}
      />
      <View style={[styles.banner, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.heading} testID="nav-heading">
          {route.heading}
        </Text>
        <View style={styles.stepRow}>
          <Text style={styles.maneuver}>{step.maneuver}</Text>
          <View style={styles.stepText}>
            <Text style={styles.distance}>{step.distance}</Text>
            <Text style={styles.instruction} testID="nav-instruction">
              {step.instruction}
            </Text>
          </View>
        </View>
      </View>
      {next && (
        <Text style={styles.then}>
          Then {next.maneuver} {next.instruction}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#0b6e4f', paddingHorizontal: 16, paddingBottom: 14, gap: 6 },
  heading: { color: '#bfe6d6', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  maneuver: { color: '#fff', fontSize: 40, fontWeight: '700', width: 44, textAlign: 'center' },
  stepText: { flex: 1 },
  distance: { color: '#fff', fontSize: 26, fontWeight: '700' },
  instruction: { color: '#fff', fontSize: 18, fontWeight: '500' },
  then: {
    alignSelf: 'flex-start',
    backgroundColor: '#095a41',
    color: '#e6f4ee',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomRightRadius: 10,
    overflow: 'hidden',
  },
});
