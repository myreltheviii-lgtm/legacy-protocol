const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  crypto: require.resolve("expo-crypto"),
  stream: require.resolve("stream-browserify"),
  buffer: require.resolve("buffer"),
  assert: require.resolve("assert"),
  http: require.resolve("stream-http"),
  https: require.resolve("https-browserify"),
  os: require.resolve("os-browserify/browser"),
  url: require.resolve("url"),
  readline: require.resolve("readline"),
  snarkjs: false,

  fastfile: false,
  circom_runtime: false,
};

config.resolver.blockList = [
  /node_modules\/web-worker\/.*/,
  /node_modules\/ffjavascript\/.*/,
  /node_modules\/circomlibjs\/.*/,
  /node_modules\/snarkjs\/.*/,
];

module.exports = config;
