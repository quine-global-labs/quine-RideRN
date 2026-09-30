import { StyleSheet, Text, View } from 'react-native';

import { formatDistance, formatDuration, formatPrice, getRideType } from '@/lib/rideTypes';
import type { Trip } from '@/lib/types';

export function formatTripDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TripSummary({ trip }: { trip: Trip }) {
  const ride = getRideType(trip.rideTypeId);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.icon}>{ride.icon}</Text>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {trip.destination.title}
          </Text>
          <Text style={styles.muted}>{formatTripDate(trip.completedAt)}</Text>
        </View>
        <Text style={styles.fare}>{formatPrice(trip.fare)}</Text>
      </View>
      <Text style={styles.details}>
        {ride.name} · {formatDistance(trip.distanceMeters)} · {formatDuration(trip.durationSeconds)} · {trip.driver.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#f6f6f6', borderRadius: 14, padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { fontSize: 28, marginRight: 12 },
  title: { fontSize: 16, fontWeight: '600', color: '#111' },
  muted: { color: '#666', marginTop: 2 },
  fare: { fontSize: 16, fontWeight: '600', color: '#111', marginLeft: 8 },
  details: { color: '#555', fontSize: 14 },
});
