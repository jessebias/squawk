// Host key — a second local burner (same pattern as session.ts) that OWNS
// channels created on this device. Host instructions (open_round /
// resolve_round / close_channel) run on the ER and require the channel host
// to sign; Privy/MWA can't sign ER transactions without a popup per action,
// so the channel is created with host = this key and every host tx is signed
// locally. The main wallet's only involvement is one SOL transfer funding it.
// Caveat (docs/decisions.md): host identity is per-device — reinstalling the
// app orphans any live channel hosted from it.
import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

const HOST_KEY_STORE = "squawk_host_key_v1";

let cached: Keypair | null = null;

export async function getHostKeypair(): Promise<Keypair> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(HOST_KEY_STORE);
  if (stored) {
    cached = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    return cached;
  }
  const fresh = Keypair.generate();
  await SecureStore.setItemAsync(
    HOST_KEY_STORE,
    JSON.stringify(Array.from(fresh.secretKey))
  );
  cached = fresh;
  return fresh;
}
