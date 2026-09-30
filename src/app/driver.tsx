import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDispatch } from '@/lib/dispatch/DispatchContext';
import { device } from '@/lib/dispatch/device';
import type { DriverJobView, DriverOfferView, DriverResult } from '@/lib/dispatch/protocol';
import { useSecondsLeft } from '@/lib/dispatch/useSecondsLeft';
import { formatDistance, formatDuration, formatPrice, getRideType } from '@/lib/rideTypes';

export default function DriverScreen() {
  const insets = useSafeAreaInsets();
  const { connected, snapshot, error, send } = useDispatch();
  const driver = snapshot?.role === 'driver' ? snapshot : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{device.name}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: connected ? '#1a8f3c' : '#bbb' }]} />
          <Text style={styles.muted} testID="driver-status">
            {connected ? 'Online' : 'Connecting…'}
          </Text>
        </View>
      </View>

      {error && (
        <Text style={styles.error} testID="driver-error">
          {error}
        </Text>
      )}

      {driver?.lastResult && !driver.job && <ResultBanner result={driver.lastResult} />}

      {driver?.job ? (
        <Job job={driver.job} onComplete={() => send({ type: 'completeTrip', rideId: driver.job!.rideId })} />
      ) : driver?.offers.length ? (
        driver.offers.map((offer) => (
          <Offer
            key={offer.rideId}
            offer={offer}
            onBid={(amount) => send({ type: 'bid', rideId: offer.rideId, amount })}
            onDecline={() => send({ type: 'decline', rideId: offer.rideId })}
          />
        ))
      ) : (
        <View style={styles.idle} testID="driver-idle">
          <Text style={styles.idleTitle}>Waiting for ride requests</Text>
          <Text style={styles.muted}>You’ll be invited to bid when a rider nearby requests a ride.</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Offer({ offer, onBid, onDecline }: { offer: DriverOfferView; onBid: (amount: number) => void; onDecline: () => void }) {
  const secondsLeft = useSecondsLeft(offer.closesAt);
  const [text, setText] = useState(offer.maxFare.toFixed(2));
  const amount = Number(text);
  const valid = amount > 0 && amount <= offer.maxFare;
  const responded = offer.myBid !== null || offer.declined;

  return (
    <View style={styles.card} testID="offer">
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Ride request</Text>
        <Text style={styles.muted}>{secondsLeft}s left</Text>
      </View>
      <Text style={styles.destination} testID="offer-destination">
        {offer.riderName} → {offer.destination.title}
      </Text>
      <Text style={styles.muted}>
        {getRideType(offer.rideTypeId).name} · {formatDistance(offer.distanceMeters)} · {formatDuration(offer.durationSeconds)}
      </Text>
      <Text style={styles.maxFare} testID="offer-max-fare">
        Rider pays up to {formatPrice(offer.maxFare)}
      </Text>

      {offer.myBid !== null ? (
        <Text style={styles.responded} testID="offer-my-bid">
          You bid {formatPrice(offer.myBid)} · waiting for the auction to close
        </Text>
      ) : offer.declined ? (
        <Text style={styles.responded}>You passed on this ride</Text>
      ) : null}

      {!responded && (
        <>
          <View style={styles.bidRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              style={styles.bidInput}
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel="Your bid"
              testID="bid-input"
            />
          </View>
          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.secondary]} onPress={onDecline} accessibilityRole="button" testID="decline-offer">
              <Text style={styles.secondaryText}>Pass</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !valid && styles.disabled]}
              onPress={() => onBid(amount)}
              disabled={!valid}
              accessibilityRole="button"
              testID="submit-bid"
            >
              <Text style={styles.primaryText}>Bid {valid ? formatPrice(amount) : ''}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function Job({ job, onComplete }: { job: DriverJobView; onComplete: () => void }) {
  return (
    <View style={styles.card} testID="driver-job">
      <Text style={styles.won}>You won the ride</Text>
      <Text style={styles.destination}>
        Pick up {job.riderName} → {job.destination.title}
      </Text>
      <Text style={styles.maxFare} testID="job-fare">
        Fare {formatPrice(job.fare)}
      </Text>
      <Pressable style={[styles.button, styles.primary]} onPress={onComplete} accessibilityRole="button" testID="complete-trip">
        <Text style={styles.primaryText}>Complete trip</Text>
      </Pressable>
    </View>
  );
}

const RESULT_TEXT: Record<DriverResult['outcome'], string> = {
  lost: 'Another driver won that ride',
  expired: 'That request closed before you answered',
  cancelled: 'The rider cancelled their request',
  completed: 'Trip complete',
};

function ResultBanner({ result }: { result: DriverResult }) {
  return (
    <Text style={styles.banner} testID="driver-result">
      {RESULT_TEXT[result.outcome]}
      {result.outcome === 'completed' ? ` · you earned ${formatPrice(result.fare)}` : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { gap: 4 },
  title: { fontSize: 26, fontWeight: '700', color: '#111' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  muted: { color: '#666', fontSize: 14 },
  error: { backgroundColor: '#fdecec', color: '#9b1c1c', padding: 10, borderRadius: 8, overflow: 'hidden' },
  banner: { backgroundColor: '#f1f1f1', color: '#333', padding: 12, borderRadius: 8, overflow: 'hidden' },
  idle: { alignItems: 'center', gap: 6, marginTop: 80, paddingHorizontal: 16 },
  idleTitle: { fontSize: 18, fontWeight: '600', color: '#111' },
  card: { backgroundColor: '#f6f6f6', borderRadius: 14, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#666', textTransform: 'uppercase' },
  destination: { fontSize: 18, fontWeight: '600', color: '#111' },
  maxFare: { fontSize: 16, color: '#111' },
  responded: { fontSize: 15, color: '#1a5f8f', fontWeight: '500' },
  won: { fontSize: 13, fontWeight: '700', color: '#1a8f3c', textTransform: 'uppercase' },
  bidRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, height: 48 },
  currency: { fontSize: 20, color: '#111', marginRight: 4 },
  bidInput: { flex: 1, fontSize: 20, fontWeight: '600', color: '#111', height: '100%' },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primary: { backgroundColor: '#111' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#e4e4e4' },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
