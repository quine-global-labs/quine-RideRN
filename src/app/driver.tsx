import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DriverNavigation } from '@/components/DriverNavigation';
import { RideMap } from '@/components/RideMap';
import { useDispatch } from '@/lib/dispatch/DispatchContext';
import { device, startsDriving } from '@/lib/dispatch/device';
import type { DriverJobView, DriverOfferView, DriverResult } from '@/lib/dispatch/protocol';
import { useSecondsLeft } from '@/lib/dispatch/useSecondsLeft';
import { pickupRoute } from '@/lib/navigation';
import { useRide } from '@/lib/RideContext';
import { formatDistance, formatDuration, formatPrice, getRideType } from '@/lib/rideTypes';

export default function DriverScreen() {
  const insets = useSafeAreaInsets();
  const { connected, snapshot, error, send } = useDispatch();
  const { pickup: position } = useRide();
  const [driving, setDriving] = useState(startsDriving);

  // Dispatch only sends requests to drivers in driving mode. Tell it on every (re)connect.
  useEffect(() => {
    if (connected) send({ type: 'setDriving', driving });
  }, [connected, driving, send]);

  // Where the driver is counts toward supply in that surge zone.
  useEffect(() => {
    if (connected) send({ type: 'setPosition', position });
  }, [connected, position, send]);

  const driver = snapshot?.role === 'driver' ? snapshot : null;
  const job = driver?.job ?? null;
  const nextJob = driver?.nextJob ?? null;
  const offers = driver?.offers ?? [];
  const openOffers = offers.filter((offer) => !offer.declined);
  const passedOffers = offers.filter((offer) => offer.declined);

  return (
    <View style={styles.screen}>
      {/* On a ride: directions, which stay mounted under ride requests. Otherwise the map. */}
      {job ? (
        <DriverNavigation key={job.rideId} route={pickupRoute(job.riderName)} />
      ) : (
        <RideMap pickup={position} userLocation={null} showsUserLocation={false} destination={null} route={null} topInset={insets.top} />
      )}

      {!job && (driving ? <Waiting /> : <Offline onStart={() => setDriving(true)} />)}

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {job && <Job job={job} onComplete={() => send({ type: 'completeTrip', rideId: job.rideId })} />}
        {nextJob && (
          <Text style={styles.next} testID="next-job">
            Next: {nextJob.riderName} → {nextJob.destination.title} · you earn {formatPrice(nextJob.earnings)}
          </Text>
        )}
        {!job &&
          passedOffers.map((offer) => (
            <Text key={offer.rideId} style={styles.passed} testID="offer-passed">
              You passed at {formatPrice(offer.price)} · {offer.riderName} → {offer.destination.title}
            </Text>
          ))}
        {!job && driver?.lastResult && <ResultBanner result={driver.lastResult} />}
        {error && (
          <Text style={styles.error} testID="driver-error">
            {error}
          </Text>
        )}
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: connected && driving ? '#1a8f3c' : '#bbb' }]} />
          <Text style={styles.name}>{device.name}</Text>
          <Text style={styles.muted} testID="driver-status">
            {!connected ? 'Connecting…' : driving ? 'Driving' : 'Offline'}
          </Text>
          {/* While a request is up, its sheet carries this button instead. */}
          {driving ? (
            openOffers.length === 0 && <GoOfflineButton onPress={() => setDriving(false)} />
          ) : (
            job && (
              <Pressable style={styles.smallButton} onPress={() => setDriving(true)} accessibilityRole="button" testID="start-driving">
                <Text style={styles.smallButtonText}>Start driving</Text>
              </Pressable>
            )
          )}
        </View>
      </View>

      {openOffers.length > 0 && (
        <View style={styles.overlay} testID="offer-sheet">
          <ScrollView
            style={styles.offerSheet}
            contentContainerStyle={[styles.offerSheetContent, { paddingBottom: insets.bottom + 16 }]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{openOffers.length === 1 ? 'New ride request' : `${openOffers.length} ride requests`}</Text>
              <GoOfflineButton onPress={() => setDriving(false)} />
            </View>
            {job && <Text style={styles.muted}>Accepting makes this your next ride, after {job.riderName}.</Text>}
            {openOffers.map((offer) => (
              <Offer
                key={`${offer.rideId}:${offer.round}`}
                offer={offer}
                onAccept={() => send({ type: 'accept', rideId: offer.rideId, round: offer.round })}
                onPass={() => send({ type: 'decline', rideId: offer.rideId, round: offer.round })}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function GoOfflineButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.smallButton} onPress={onPress} accessibilityRole="button" testID="stop-driving">
      <Text style={styles.smallButtonText}>Go offline</Text>
    </Pressable>
  );
}

/** Driving with no ride: waiting for requests. */
function Waiting() {
  return (
    <View style={styles.center} testID="driver-waiting" pointerEvents="none">
      <LottieView source={require('../../assets/lottie/finding-driver.json')} autoPlay loop style={styles.animation} />
      <Text style={styles.centerTitle}>Looking for ride requests</Text>
      <Text style={styles.muted}>Requests pop up here while you’re driving.</Text>
    </View>
  );
}

function Offline({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.center} testID="driver-offline">
      <View style={styles.offlineCard}>
        <Text style={styles.centerTitle}>You’re offline</Text>
        <Text style={styles.muted}>Start driving to get ride requests.</Text>
        <Pressable style={[styles.button, styles.primary, styles.startButton]} onPress={onStart} accessibilityRole="button" testID="start-driving">
          <Text style={styles.primaryText}>Start driving</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Offer({ offer, onAccept, onPass }: { offer: DriverOfferView; onAccept: () => void; onPass: () => void }) {
  const secondsLeft = useSecondsLeft(offer.closesAt);

  return (
    <View style={styles.card} testID="offer">
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} testID="offer-round">
          Ride request · round {offer.round}
        </Text>
        <Text style={styles.muted}>{secondsLeft}s left</Text>
      </View>
      <Text style={styles.destination} testID="offer-destination">
        {offer.riderName} → {offer.destination.title}
      </Text>
      <Text style={styles.muted}>
        {getRideType(offer.rideTypeId).name} · {formatDistance(offer.distanceMeters)} · {formatDuration(offer.durationSeconds)}
      </Text>
      <View>
        <Text style={styles.price} testID="offer-earnings">
          {formatPrice(offer.earnings)}
        </Text>
        <Text style={styles.muted}>
          You earn · rider pays <Text testID="offer-price">{formatPrice(offer.price)}</Text>
        </Text>
      </View>

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.secondary]} onPress={onPass} accessibilityRole="button" testID="decline-offer">
          <Text style={styles.secondaryText}>Pass</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={onAccept} accessibilityRole="button" testID="accept-offer">
          <Text style={styles.primaryText}>Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Job({ job, onComplete }: { job: DriverJobView; onComplete: () => void }) {
  return (
    <View style={styles.card} testID="driver-job">
      <Text style={styles.won}>You got the ride</Text>
      <Text style={styles.destination}>
        {job.riderName} → {job.destination.title}
      </Text>
      <Text style={styles.fare} testID="job-earnings">
        You earn {formatPrice(job.earnings)}
      </Text>
      <Text style={styles.muted} testID="job-fare">
        Fare {formatPrice(job.fare)}
      </Text>
      <Pressable style={[styles.button, styles.primary]} onPress={onComplete} accessibilityRole="button" testID="complete-trip">
        <Text style={styles.primaryText}>Complete trip</Text>
      </Pressable>
    </View>
  );
}

const RESULT_TEXT: Record<DriverResult['outcome'], string> = {
  lost: 'Another driver took that ride',
  expired: 'That request closed before you answered',
  cancelled: 'The rider cancelled their request',
  completed: 'Trip complete',
};

function ResultBanner({ result }: { result: DriverResult }) {
  return (
    <Text style={styles.banner} testID="driver-result">
      {RESULT_TEXT[result.outcome]}
      {result.outcome === 'completed' ? ` · you earned ${formatPrice(result.earnings)}` : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e8ecef' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontSize: 17, fontWeight: '700', color: '#111', flex: 1 },
  muted: { color: '#666', fontSize: 14 },
  error: { backgroundColor: '#fdecec', color: '#9b1c1c', padding: 10, borderRadius: 8, overflow: 'hidden' },
  banner: { backgroundColor: '#f1f1f1', color: '#333', padding: 12, borderRadius: 8, overflow: 'hidden' },
  next: { backgroundColor: '#eef7f1', color: '#0b6e4f', padding: 10, borderRadius: 8, overflow: 'hidden', fontSize: 14, fontWeight: '600' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 160, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 24 },
  animation: { width: 220, height: 220 },
  centerTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  offlineCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 6, alignItems: 'center', alignSelf: 'stretch' },
  startButton: { flex: 0, alignSelf: 'stretch', marginTop: 10 },
  smallButton: { backgroundColor: '#eee', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  smallButtonText: { fontSize: 14, fontWeight: '600', color: '#111' },
  passed: { backgroundColor: '#eef4fa', color: '#1a5f8f', padding: 10, borderRadius: 8, overflow: 'hidden', fontSize: 14 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  offerSheet: { flexGrow: 0, maxHeight: '75%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  offerSheetContent: { padding: 16, gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  card: { backgroundColor: '#f6f6f6', borderRadius: 14, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#666', textTransform: 'uppercase' },
  destination: { fontSize: 18, fontWeight: '600', color: '#111' },
  price: { fontSize: 32, fontWeight: '700', color: '#111' },
  fare: { fontSize: 16, color: '#111' },
  won: { fontSize: 13, fontWeight: '700', color: '#1a8f3c', textTransform: 'uppercase' },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primary: { backgroundColor: '#111' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#e4e4e4' },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
});
