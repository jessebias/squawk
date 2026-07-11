// Local burner wallet — the app's default identity on the emulator/demo
// devices (docs/decisions.md Phase 4). MWA connect (useMobileWallet) remains
// the flagship path on devices with a wallet app; both expose the same shape
// via useWallet in hooks/useWallet.ts.
import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

const LOCAL_WALLET_STORE = "squawk_local_wallet_v1";

let cached: Keypair | null = null;

export async function getLocalWallet(): Promise<Keypair> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(LOCAL_WALLET_STORE);
  if (stored) {
    cached = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    return cached;
  }
  const fresh = Keypair.generate();
  await SecureStore.setItemAsync(
    LOCAL_WALLET_STORE,
    JSON.stringify(Array.from(fresh.secretKey))
  );
  cached = fresh;
  return fresh;
}
