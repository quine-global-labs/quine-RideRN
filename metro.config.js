// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The app config (app.config.ts) is baked into transformed modules, but Metro's cache
// doesn't notice APP_VARIANT changing. Key the cache by variant so switching between the
// rider and driver apps never serves the other app's config.
config.cacheVersion = `${config.cacheVersion ?? ''}:app-variant=${process.env.APP_VARIANT === 'driver' ? 'driver' : 'rider'}`;

module.exports = config;
