// Session keys — docs/plan.md §7.3, decided in Phase 4 (docs/decisions.md):
// a burner Keypair persisted in expo-secure-store, registered as
// Member.session_key at join. The program validates signer == user ||
// session_key on stake/claim, so no external session program is needed.
// The main wallet signs only join/deposit and withdraw; every ER interaction
// is signed by this key — zero popups per stake.
import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

const SESSION_KEY_STORE = "squawk_session_key_v1";

let cached: Keypair | null = null;

export async function getSessionKeypair(): Promise<Keypair> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(SESSION_KEY_STORE);
  if (stored) {
    cached = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    return cached;
  }
  const fresh = Keypair.generate();
  await SecureStore.setItemAsync(
    SESSION_KEY_STORE,
    JSON.stringify(Array.from(fresh.secretKey))
  );
  cached = fresh;
  return fresh;
}
