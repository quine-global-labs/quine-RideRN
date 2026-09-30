import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RideMap } from '@/components/RideMap';
import { RideOptions } from '@/components/RideOptions';
import { useRide } from '@/lib/RideContext';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const {
    userLocation,
    pickup,
    locationStatus,
    destination,
    route,
    routeLoading,
    rideTypeId,
    quote,
    dispatchError,
    setDestination,
    setRideTypeId,
    requestRide,
  } = useRide();

  const clearDestination = () => setDestination(null);

  const confirmRide = () => {
    if (requestRide()) router.push('/finding');
  };

  return (
    <View style={styles.container}>
      <RideMap
        pickup={pickup}
        userLocation={userLocation}
        showsUserLocation={locationStatus === 'granted'}
        destination={destination}
        route={route}
        topInset={insets.top}
      />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {destination ? (
          <View style={styles.row}>
            <Pressable style={styles.circleButton} onPress={clearDestination} accessibilityLabel="Clear destination" testID="clear-destination">
              <Text style={styles.circleButtonText}>←</Text>
            </Pressable>
            <View style={[styles.searchBar, styles.flex]}>
              <View style={styles.squareDot} />
              <Text style={styles.searchText} numberOfLines={1}>
                {destination.title}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <Pressable style={styles.circleButton} onPress={() => router.push('/trips')} accessibilityLabel="Your trips">
                <Text style={styles.circleButtonText}>☰</Text>
              </Pressable>
            </View>
            <Pressable style={styles.searchBar} onPress={() => router.push('/search')} accessibilityRole="search" testID="where-to">
              <View style={styles.squareDot} />
              <Text style={[styles.searchText, styles.placeholder]}>Where to?</Text>
            </Pressable>
            {locationStatus === 'denied' && (
              <Text style={styles.banner}>Location is off. Using a default pickup in San Francisco.</Text>
            )}
          </>
        )}
        {dispatchError && (
          <Text style={[styles.banner, styles.errorBanner]} testID="dispatch-error">
            {dispatchError}
          </Text>
        )}
      </View>

      {destination && (
        <View style={styles.bottom}>
          <RideOptions route={route} quote={quote} loading={routeLoading} selectedId={rideTypeId} onSelect={setRideTypeId} onConfirm={confirmRide} />
        </View>
      )}
    </View>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 6,
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  top: { position: 'absolute', left: 16, right: 16, top: 0, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  circleButtonText: { fontSize: 20, color: '#111' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 56,
    ...shadow,
  },
  squareDot: { width: 10, height: 10, backgroundColor: '#111', marginRight: 14 },
  searchText: { flex: 1, fontSize: 18, fontWeight: '600', color: '#111' },
  placeholder: { color: '#333' },
  banner: { backgroundColor: '#fff4e5', color: '#7a4b00', padding: 10, borderRadius: 8, overflow: 'hidden', fontSize: 13 },
  errorBanner: { backgroundColor: '#fdecec', color: '#9b1c1c' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
