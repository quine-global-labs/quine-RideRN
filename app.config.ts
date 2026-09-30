import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, two apps: the rider app (default) and the driver app. Pick one with
// APP_VARIANT=driver when starting the dev server or in an EAS build profile (eas.json).
// Static settings stay in app.json; only what differs between the apps is set here.
const variant = process.env.APP_VARIANT === 'driver' ? 'driver' : 'rider';
const isDriver = variant === 'driver';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDriver ? 'RideRN Driver' : 'RideRN',
  slug: config.slug ?? 'RideRN',
  scheme: isDriver ? 'ridern-driver' : 'ridern',
  ios: {
    ...config.ios,
    bundleIdentifier: isDriver ? 'com.example.ridern.driver' : 'com.example.ridern',
  },
  android: {
    ...config.android,
    package: isDriver ? 'com.example.ridern.driver' : 'com.example.ridern',
  },
  extra: {
    ...config.extra,
    appVariant: variant,
  },
});
