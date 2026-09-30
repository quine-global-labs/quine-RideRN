import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Quote } from '@/lib/dispatch/protocol';
import { formatDistance, formatDuration, formatPrice, RIDE_TYPES } from '@/lib/rideTypes';
import type { Route } from '@/lib/types';

type Props = {
  route: Route | null;
  quote: Quote | null;
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onConfirm: () => void;
};

export function RideOptions({ route, quote, loading, selectedId, onSelect, onConfirm }: Props) {
  if (loading || !route || !quote) {
    return (
      <View style={[styles.sheet, styles.loading]}>
        <ActivityIndicator color="#111" />
        <Text style={styles.muted}>{loading || !route ? 'Finding the best route…' : 'Getting prices…'}</Text>
      </View>
    );
  }

  // Only ride types priced in this city.
  const available = RIDE_TYPES.filter((ride) => quote.fares[ride.id] !== undefined);
  const selected = available.find((r) => r.id === selectedId) ?? available[0];

  return (
    <View style={styles.sheet}>
      <Text style={styles.tripMeta}>
        {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
        {route.approximate ? ' · estimate' : ''}
      </Text>
      {quote.surge > 1 && (
        <Text style={styles.surge} testID="surge-notice">
          Busy area · prices are {quote.surge}× higher right now
        </Text>
      )}
      {available.map((ride) => {
        const isSelected = ride.id === selected.id;
        return (
          <Pressable
            key={ride.id}
            onPress={() => onSelect(ride.id)}
            style={[styles.option, isSelected && styles.optionSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={styles.icon}>{ride.icon}</Text>
            <View style={styles.optionText}>
              <Text style={styles.optionName}>
                {ride.name} <Text style={styles.muted}>· {ride.seats} seats</Text>
              </Text>
              <Text style={styles.muted}>{ride.description}</Text>
            </View>
            <Text style={styles.price} testID={`price-${ride.id}`}>
              {formatPrice(quote.fares[ride.id])}
            </Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.confirm} onPress={onConfirm} accessibilityRole="button" testID="confirm-ride">
        <Text style={styles.confirmText}>Choose {selected.name}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  surge: { backgroundColor: '#eaf1ff', color: '#1d4ed8', padding: 8, borderRadius: 8, overflow: 'hidden', textAlign: 'center', marginBottom: 6, fontWeight: '500' },
  tripMeta: { textAlign: 'center', color: '#555', marginBottom: 8, fontWeight: '500' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: '#111', backgroundColor: '#f6f6f6' },
  icon: { fontSize: 32, marginRight: 12 },
  optionText: { flex: 1 },
  optionName: { fontSize: 17, fontWeight: '600', color: '#111' },
  muted: { color: '#6b6b6b', fontWeight: '400', fontSize: 14 },
  price: { fontSize: 17, fontWeight: '600', color: '#111' },
  confirm: { marginTop: 12, backgroundColor: '#111', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  confirmText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
