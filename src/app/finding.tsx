import { Redirect, router } from 'expo-router';
import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RiderRideView } from '@/lib/dispatch/protocol';
import { useSecondsLeft } from '@/lib/dispatch/useSecondsLeft';
import { useRide } from '@/lib/RideContext';
import { formatPrice, getRideType } from '@/lib/rideTypes';

export default function FindingDriverScreen() {
  const insets = useSafeAreaInsets();
  const { ride, requesting, cancelRide, dismissRide } = useRide();
  // Set when this screen is on its way out, so the ride disappearing doesn't redirect mid-transition.
  const [leaving, setLeaving] = useState(false);

  const status = ride?.status;
  useEffect(() => {
    if (status === 'completed') router.replace('/trip');
  }, [status]);

  if (!ride || ride.status === 'completed') {
    if (requesting || leaving || ride) return <View style={styles.container} />;
    return <Redirect href="/" />;
  }

  const leave = (action: () => void) => {
    setLeaving(true);
    action();
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      {ride.status === 'auction' && <Auction ride={ride} onCancel={() => leave(cancelRide)} />}
      {ride.status === 'matched' && <Matched ride={ride} />}
      {ride.status === 'unmatched' && <Unmatched ride={ride} onBack={() => leave(dismissRide)} />}
    </View>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} testID="ride-status">
        {title}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function tripLine(ride: RiderRideView) {
  return `${getRideType(ride.rideTypeId).name} to ${ride.destination.title}`;
}

function Auction({ ride, onCancel }: { ride: RiderRideView; onCancel: () => void }) {
  const secondsLeft = useSecondsLeft(ride.closesAt);
  return (
    <>
      <Header title="Finding your driver" subtitle={`${tripLine(ride)} · quoted ${formatPrice(ride.quotedFare)}`} />
      <LottieView source={require('../../assets/lottie/finding-driver.json')} autoPlay loop style={styles.animation} />
      <View style={styles.auctionInfo}>
        <Text style={styles.offers} testID="round-price">
          Offering drivers {formatPrice(ride.price)}
        </Text>
        <Text style={[styles.muted, styles.centered]}>
          <Text testID="round-number">Round {ride.round}</Text> · {secondsLeft}s left
        </Text>
      </View>
      <Pressable style={styles.secondaryButton} onPress={onCancel} accessibilityRole="button" testID="cancel-request">
        <Text style={styles.secondaryButtonText}>Cancel request</Text>
      </Pressable>
    </>
  );
}

function Matched({ ride }: { ride: RiderRideView }) {
  const { driver, fare } = ride;
  if (!driver || fare === null) return null;
  const difference = fare - ride.quotedFare;
  return (
    <>
      <Header title="Driver found" subtitle={tripLine(ride)} />
      <View style={styles.fareBox}>
        <Text style={styles.fare} testID="ride-fare">
          {formatPrice(fare)}
        </Text>
        <Text style={[styles.muted, styles.centered]} testID="fare-vs-quote">
          {difference < 0
            ? `${formatPrice(-difference)} below your quote`
            : difference > 0
              ? `${formatPrice(difference)} above your quote`
              : 'Your quoted fare'}
        </Text>
      </View>
      <View style={styles.card} testID="matched-driver">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{driver.name[0]}</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.driverName} testID="driver-name">
            {driver.name} · ★ {driver.rating.toFixed(2)}
          </Text>
          <Text style={styles.muted}>{driver.car}</Text>
        </View>
        <Text style={styles.plate}>{driver.plate}</Text>
      </View>
    </>
  );
}

function Unmatched({ ride, onBack }: { ride: RiderRideView; onBack: () => void }) {
  return (
    <>
      <Header title="No drivers available" subtitle={`No driver took ${tripLine(ride)}, even at ${formatPrice(ride.price)}.`} />
      <Pressable style={styles.primaryButton} onPress={onBack} accessibilityRole="button" testID="unmatched-back">
        <Text style={styles.primaryButtonText}>Back</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 24, justifyContent: 'space-between' },
  header: { alignItems: 'center', gap: 6 },
  title: { fontSize: 26, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center' },
  animation: { width: 260, height: 260, alignSelf: 'center' },
  auctionInfo: { alignItems: 'center', gap: 4 },
  offers: { fontSize: 18, fontWeight: '600', color: '#111' },
  fareBox: { alignItems: 'center', gap: 4 },
  fare: { fontSize: 40, fontWeight: '700', color: '#111' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f4f4f4', borderRadius: 14, padding: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  cardText: { flex: 1 },
  driverName: { fontSize: 17, fontWeight: '600', color: '#111' },
  muted: { color: '#666', marginTop: 2 },
  centered: { textAlign: 'center' },
  plate: { fontSize: 15, fontWeight: '700', color: '#111', backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  secondaryButton: { backgroundColor: '#eee', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { fontSize: 17, fontWeight: '600', color: '#111' },
  primaryButton: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
