import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import type { Coord, Place, Route } from '@/lib/types';

export type RideMapProps = {
  pickup: Coord;
  userLocation: Coord | null;
  showsUserLocation: boolean;
  destination: Place | null;
  route: Route | null;
  topInset: number;
};

const ZOOMED_IN = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

export function RideMap({ pickup, userLocation, showsUserLocation, destination, route, topInset }: RideMapProps) {
  const mapRef = useRef<MapView>(null);

  // Centre on the user the first time we learn where they are.
  const hasCentred = useRef(false);
  useEffect(() => {
    if (!userLocation || hasCentred.current || destination) return;
    hasCentred.current = true;
    mapRef.current?.animateToRegion({ ...userLocation, ...ZOOMED_IN }, 600);
  }, [userLocation, destination]);

  // Frame the whole route once it arrives.
  useEffect(() => {
    if (!route) return;
    mapRef.current?.fitToCoordinates(route.coordinates, {
      edgePadding: { top: topInset + 80, right: 48, bottom: 460, left: 48 },
      animated: true,
    });
  }, [route, topInset]);

  // Zoom back in on the pickup when the destination is cleared.
  const hadDestination = useRef(false);
  useEffect(() => {
    if (hadDestination.current && !destination) mapRef.current?.animateToRegion({ ...pickup, ...ZOOMED_IN }, 500);
    hadDestination.current = destination !== null;
    // Only react to the destination changing, not to the pickup drifting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...pickup, ...ZOOMED_IN }}
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      showsPointsOfInterests={false}
    >
      {!showsUserLocation && <Marker coordinate={pickup} title="Pickup" pinColor="black" />}
      {destination && <Marker coordinate={destination.coordinate} title={destination.title} />}
      {route && (
        <Polyline
          coordinates={route.coordinates}
          strokeWidth={5}
          strokeColor="#111"
          lineDashPattern={route.approximate ? [10, 8] : undefined}
        />
      )}
    </MapView>
  );
}
