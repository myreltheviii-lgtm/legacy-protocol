const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  crypto: require.resolve("expo-crypto"),
};

module.exports = config;
