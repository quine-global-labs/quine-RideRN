import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { simulatedLocation } from './dispatch/device';
import { useDispatch } from './dispatch/DispatchContext';
import type { RiderRideView } from './dispatch/protocol';
import { DEFAULT_LOCATION } from './location';
import { getRideType, priceFor, RIDE_TYPES } from './rideTypes';
import { fetchRoute } from './route';
import { saveTrip } from './storage';
import type { Coord, Place, Route, Trip } from './types';

type LocationStatus = 'pending' | 'granted' | 'denied';

type RideState = {
  userLocation: Coord | null;
  pickup: Coord;
  locationStatus: LocationStatus;
  destination: Place | null;
  route: Route | null;
  routeLoading: boolean;
  rideTypeId: string;
  /** The rider's current ride, as dispatch sees it. */
  ride: RiderRideView | null;
  /** A ride request was sent and dispatch hasn't answered yet. */
  requesting: boolean;
  /** The last error dispatch reported, e.g. a rejected request. */
  dispatchError: string | null;
  setDestination: (place: Place | null) => void;
  setRideTypeId: (id: string) => void;
  /** Sends the request to dispatch, which opens a price auction among drivers. */
  requestRide: () => boolean;
  cancelRide: () => void;
  /** Dismiss a ride that ended without a driver. */
  dismissRide: () => void;
  /** Save the finished trip to history and reset for the next ride. */
  completeTrip: () => Promise<void>;
};

const RideContext = createContext<RideState | null>(null);

export function RideProvider({ children }: { children: ReactNode }) {
  const [userLocation, setUserLocation] = useState<Coord | null>(simulatedLocation);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(simulatedLocation ? 'granted' : 'pending');
  const [destination, setDestination] = useState<Place | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [rideTypeId, setRideTypeId] = useState(RIDE_TYPES[0].id);
  const [requestPending, setRequestPending] = useState(false);

  const { snapshot, error: dispatchError, send } = useDispatch();
  const ride = snapshot?.role === 'rider' ? snapshot.ride : null;
  const requesting = requestPending && !ride && !dispatchError;

  const pickup = userLocation ?? DEFAULT_LOCATION;
  const routeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    // Simulated phones keep the mocked position they started with.
    if (simulatedLocation) return;
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setLocationStatus('denied');
        return;
      }
      setLocationStatus('granted');
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 25 },
        ({ coords }) => setUserLocation({ latitude: coords.latitude, longitude: coords.longitude }),
      );
      if (cancelled) subscription.remove();
    })().catch(() => {
      if (!cancelled) setLocationStatus('denied');
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // Routes are computed from the pickup at the moment a destination is chosen,
  // not re-fetched every time the user's position updates.
  const chooseDestination = useCallback(
    (place: Place | null) => {
      routeRequest.current?.abort();
      setDestination(place);
      setRoute(null);
      if (!place) {
        setRouteLoading(false);
        return;
      }

      const controller = new AbortController();
      routeRequest.current = controller;
      setRouteLoading(true);
      fetchRoute(pickup, place.coordinate, controller.signal)
        .then(setRoute)
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setRouteLoading(false);
        });
    },
    [pickup],
  );

  const requestRide = useCallback(() => {
    if (!destination || !route) return false;
    const sent = send({
      type: 'requestRide',
      request: {
        pickup,
        destination,
        rideTypeId,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        quotedFare: priceFor(getRideType(rideTypeId), route),
      },
    });
    setRequestPending(sent);
    return sent;
  }, [destination, route, rideTypeId, pickup, send]);

  const cancelRide = useCallback(() => {
    send({ type: 'cancelRide' });
    setRequestPending(false);
  }, [send]);

  const dismissRide = useCallback(() => {
    send({ type: 'ackRide' });
    setRequestPending(false);
  }, [send]);

  const completeTrip = useCallback(async () => {
    const trip = ride && tripFromRide(ride);
    if (trip) await saveTrip(trip);
    dismissRide();
    chooseDestination(null);
  }, [ride, dismissRide, chooseDestination]);

  const value = useMemo<RideState>(
    () => ({
      userLocation,
      pickup,
      locationStatus,
      destination,
      route,
      routeLoading,
      rideTypeId,
      ride,
      requesting,
      dispatchError,
      setDestination: chooseDestination,
      setRideTypeId,
      requestRide,
      cancelRide,
      dismissRide,
      completeTrip,
    }),
    [
      userLocation,
      pickup,
      locationStatus,
      destination,
      route,
      routeLoading,
      rideTypeId,
      ride,
      requesting,
      dispatchError,
      chooseDestination,
      requestRide,
      cancelRide,
      dismissRide,
      completeTrip,
    ],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

/** The trip-history record for a ride, once a driver has been matched. */
export function tripFromRide(ride: RiderRideView): Trip | null {
  if (!ride.driver || ride.fare === null) return null;
  return {
    id: ride.id,
    destination: ride.destination,
    rideTypeId: ride.rideTypeId,
    fare: ride.fare,
    distanceMeters: ride.distanceMeters,
    durationSeconds: ride.durationSeconds,
    driver: ride.driver,
    completedAt: ride.completedAt ?? new Date().toISOString(),
  };
}

export function useRide(): RideState {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used inside <RideProvider>');
  return ctx;
}
