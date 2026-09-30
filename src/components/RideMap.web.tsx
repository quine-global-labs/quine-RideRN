import { StyleSheet, View } from 'react-native';

import type { RideMapProps } from './RideMap';

// react-native-maps has no web implementation; the browser build (used by the
// multi-phone simulator) shows a plain backdrop instead of a map.
export function RideMap(_props: RideMapProps) {
  return <View style={[StyleSheet.absoluteFill, styles.backdrop]} />;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#e8ecef' },
});
