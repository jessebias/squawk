// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add polyfill resolvers
config.resolver.extraNodeModules.crypto = require.resolve('expo-crypto');

// NOTE: do NOT enable unstable_enablePackageExports globally — it reroutes
// @solana/web3.js's crypto deps to builds that break Keypair derivation
// ("seed expected Uint8Array of length 32"). Privy's packages resolve fine
// via main fields once Metro's cache is fresh.

module.exports = config;
