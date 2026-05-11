const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Polyfills for packages that expect a Node.js environment.
// These map Node built-ins to browser/RN compatible equivalents
// for packages still bundled through Metro (i.e. everything except
// the signing-service worklet which runs in Bare).
config.resolver.extraNodeModules = {
  crypto:  require.resolve("expo-crypto"),
  stream:  require.resolve("stream-browserify"),
  buffer:  require.resolve("buffer"),
  assert:  require.resolve("assert"),
  http:    require.resolve("stream-http"),
  https:   require.resolve("https-browserify"),
  os:      require.resolve("os-browserify/browser"),
  url:     require.resolve("url"),
  readline: require.resolve("readline"),
};

// Treat .bundle files as opaque binary assets.
// The signing-service worklet (app.bundle) is pre-built by bare-pack
// and must never be parsed by Metro as JavaScript.
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  "bundle",
];

module.exports = config;
