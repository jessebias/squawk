// Privy polyfills — ORDER MATTERS: the secure RNG must land before
// @ethersproject/shims, or the shim injects its own broken getRandomValues
// ("seed expected Uint8Array of length 32" from Keypair.generate).
import "fast-text-encoding";
import "react-native-get-random-values";
import "@ethersproject/shims";

import { getRandomValues as expoCryptoGetRandomValues } from "expo-crypto";
import { Buffer } from "buffer";

global.Buffer = Buffer;

// Hermes: Buffer.subarray falls back to Uint8Array.prototype.subarray and the
// result loses Buffer methods (readUIntLE, …), breaking anchor's account
// decoding. Re-attach the Buffer prototype (canonical RN fix).
Buffer.prototype.subarray = function subarray(
  begin?: number,
  end?: number
) {
  const result = Uint8Array.prototype.subarray.call(this, begin, end);
  Object.setPrototypeOf(result, Buffer.prototype);
  return result as Buffer;
};

// getRandomValues polyfill
class Crypto {
  getRandomValues = expoCryptoGetRandomValues;
}

const webCrypto = typeof crypto !== "undefined" ? crypto : new Crypto();

(() => {
  if (typeof crypto === "undefined") {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      enumerable: true,
      get: () => webCrypto,
    });
  }
})();

// structuredClone polyfill — Hermes lacks it; @coral-xyz/anchor uses it to
// deep-clone the (plain-JSON) IDL, so a JSON round-trip is sufficient.
if (typeof global.structuredClone === "undefined") {
  (global as any).structuredClone = (value: unknown) =>
    JSON.parse(JSON.stringify(value));
}
