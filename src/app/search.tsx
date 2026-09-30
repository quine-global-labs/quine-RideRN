import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchPlaces } from '@/lib/places';
import { useRide } from '@/lib/RideContext';
import { addRecentPlace, getRecentPlaces } from '@/lib/storage';
import type { Place } from '@/lib/types';

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const { pickup, setDestination } = useRide();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [recent, setRecent] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRecentPlaces().then(setRecent);
  }, []);

  const trimmed = query.trim();
  const showingRecent = trimmed.length < 2;

  useEffect(() => {
    if (showingRecent) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      searchPlaces(trimmed, pickup, controller.signal)
        .then((places) => {
          setResults(places);
          setError(null);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Only re-search when the text changes; pickup drift shouldn't retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const choose = (place: Place) => {
    setDestination(place);
    addRecentPlace(place);
    router.back();
  };

  const data = showingRecent ? recent : results;

  return (
    <View style={styles.container}>
      <View style={styles.inputs}>
        <View style={styles.inputRow}>
          <View style={styles.circleDot} />
          <Text style={styles.pickupText}>Current location</Text>
        </View>
        <View style={styles.inputRow}>
          <View style={styles.squareDot} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Where to?"
            placeholderTextColor="#777"
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            testID="destination-input"
          />
        </View>
      </View>

      {!showingRecent && loading && <ActivityIndicator style={styles.spinner} color="#111" />}
      {!showingRecent && error && <Text style={styles.message}>{error}</Text>}

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={showingRecent && recent.length > 0 ? <Text style={styles.sectionTitle}>Recent</Text> : null}
        ListEmptyComponent={
          !loading && !error && !showingRecent ? <Text style={styles.message}>No places found for “{trimmed}”.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.result, pressed && styles.pressed]} onPress={() => choose(item)}>
            <View style={styles.resultIcon}>
              <Text>{showingRecent ? '🕘' : '📍'}</Text>
            </View>
            <View style={styles.resultText}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text style={styles.resultSubtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inputs: { padding: 16, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f1f1', borderRadius: 8, paddingHorizontal: 12, height: 44 },
  circleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#111', marginRight: 12 },
  squareDot: { width: 8, height: 8, backgroundColor: '#111', marginRight: 12 },
  pickupText: { fontSize: 16, color: '#555' },
  input: { flex: 1, fontSize: 16, color: '#111', height: '100%' },
  spinner: { marginTop: 16 },
  message: { textAlign: 'center', color: '#666', marginTop: 16, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#666', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  result: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { backgroundColor: '#f4f4f4' },
  resultIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 16, fontWeight: '500', color: '#111' },
  resultSubtitle: { fontSize: 14, color: '#6b6b6b', marginTop: 2 },
});
