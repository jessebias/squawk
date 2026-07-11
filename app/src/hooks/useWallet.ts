// One wallet abstraction for the app: the local burner is the default
// identity (always works, incl. emulator); MWA connect upgrades to a real
// wallet app when present. Session key is separate and always local.
import { useCallback, useEffect, useState } from "react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { baseConn } from "../lib/connections";
import { getLocalWallet } from "../lib/wallet";
import { getSessionKeypair } from "../lib/session";
import { sendLocal } from "../lib/squawk";

export type AppWallet = {
  ready: boolean;
  publicKey: PublicKey | null;
  sessionKey: Keypair | null;
  /// Sign + send a BASE-layer transaction with the user wallet.
  signAndSend: (tx: Transaction) => Promise<string>;
};

export function useWallet(): AppWallet {
  const [local, setLocal] = useState<Keypair | null>(null);
  const [session, setSession] = useState<Keypair | null>(null);

  useEffect(() => {
    (async () => {
      const wallet = await getLocalWallet();
      const sessionKp = await getSessionKeypair();
      setLocal(wallet);
      setSession(sessionKp);
      console.log(
        `[squawk] wallet ${wallet.publicKey.toBase58()} · session ${sessionKp.publicKey.toBase58()}`
      );
    })();
  }, []);

  const signAndSend = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!local) throw new Error("wallet not ready");
      return sendLocal(baseConn, tx, [local]);
    },
    [local]
  );

  return {
    ready: local !== null && session !== null,
    publicKey: local?.publicKey ?? null,
    sessionKey: session,
    signAndSend,
  };
}
