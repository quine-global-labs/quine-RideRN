import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { TripSummary } from '@/components/TripSummary';
import { getTrips } from '@/lib/storage';
import type { Trip } from '@/lib/types';

export default function TripsScreen() {
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTrips().then(setTrips);
    }, []),
  );

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={trips ?? []}
      keyExtractor={(trip) => trip.id}
      renderItem={({ item }) => <TripSummary trip={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        trips ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptyText}>Your completed rides will show up here.</Text>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: '#fff' },
  content: { padding: 16 },
  separator: { height: 12 },
  empty: { alignItems: 'center', marginTop: 80, gap: 6 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#111' },
  emptyText: { color: '#666' },
});
