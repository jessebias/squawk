// The app's single wallet context. Active wallet precedence:
//   privy (embedded Solana wallet, social login) → mwa (Seeker Seed Vault) →
//   local (secure-store burner — the zero-setup fallback).
// The SESSION key is always the local burner registered at join; every ER
// interaction (stake/claim) is signed by it regardless of wallet mode.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  PrivyProvider,
  useEmbeddedSolanaWallet,
  usePrivy,
} from "@privy-io/expo";
import { baseConn } from "../lib/connections";
import { getLocalWallet } from "../lib/wallet";
import { getSessionKeypair } from "../lib/session";
import { sendLocal } from "../lib/squawk";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";

export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? "";
export const privyEnabled = PRIVY_APP_ID.length > 0 && PRIVY_CLIENT_ID.length > 0;

export type WalletMode = "privy" | "mwa" | "local";

export type AppWallet = {
  ready: boolean;
  mode: WalletMode;
  publicKey: PublicKey | null;
  sessionKey: Keypair | null;
  /// Sign + send a BASE-layer transaction with the active wallet.
  signAndSend: (tx: Transaction) => Promise<string>;
  /// Identity/auth extras for the UI.
  identityLabel: string | null;
  privyAuthenticated: boolean;
  logoutPrivy: () => Promise<void>;
  mwaConnected: boolean;
  connectMwa: () => Promise<void>;
  disconnectMwa: () => Promise<void>;
};

const WalletContext = createContext<AppWallet | null>(null);

export function useWalletContext(): AppWallet {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

/// Local burner + session key + MWA — available in every configuration.
function useBaseWallet() {
  const [local, setLocal] = useState<Keypair | null>(null);
  const [session, setSession] = useState<Keypair | null>(null);
  const { selectedAccount } = useAuthorization();
  const mobileWallet = useMobileWallet();

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

  const connectMwa = useCallback(async () => {
    await mobileWallet.connect();
  }, [mobileWallet]);

  const disconnectMwa = useCallback(async () => {
    await mobileWallet.disconnect();
  }, [mobileWallet]);

  const mwaSignAndSend = useCallback(
    async (tx: Transaction): Promise<string> => {
      const minContextSlot = await baseConn.getSlot();
      const sig = await mobileWallet.signAndSendTransaction(tx, minContextSlot);
      await baseConn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [mobileWallet]
  );

  const localSignAndSend = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!local) throw new Error("wallet not ready");
      return sendLocal(baseConn, tx, [local]);
    },
    [local]
  );

  return {
    local,
    session,
    mwaAccount: selectedAccount ?? null,
    connectMwa,
    disconnectMwa,
    mwaSignAndSend,
    localSignAndSend,
  };
}

function buildWallet(
  base: ReturnType<typeof useBaseWallet>,
  privy: {
    authenticated: boolean;
    identityLabel: string | null;
    walletAddress: string | null;
    signAndSend: ((tx: Transaction) => Promise<string>) | null;
    logout: () => Promise<void>;
  }
): AppWallet {
  const mode: WalletMode =
    privy.authenticated && privy.walletAddress
      ? "privy"
      : base.mwaAccount
      ? "mwa"
      : "local";
  const publicKey =
    mode === "privy"
      ? new PublicKey(privy.walletAddress!)
      : mode === "mwa"
      ? base.mwaAccount!.publicKey
      : base.local?.publicKey ?? null;
  const signAndSend =
    mode === "privy" && privy.signAndSend
      ? privy.signAndSend
      : mode === "mwa"
      ? base.mwaSignAndSend
      : base.localSignAndSend;

  return {
    ready: base.local !== null && base.session !== null,
    mode,
    publicKey,
    sessionKey: base.session,
    signAndSend,
    identityLabel: privy.identityLabel,
    privyAuthenticated: privy.authenticated,
    logoutPrivy: privy.logout,
    mwaConnected: base.mwaAccount !== null,
    connectMwa: base.connectMwa,
    disconnectMwa: base.disconnectMwa,
  };
}

const NO_PRIVY = {
  authenticated: false,
  identityLabel: null,
  walletAddress: null,
  signAndSend: null,
  logout: async () => {},
};

function BasicWalletProvider({ children }: { children: React.ReactNode }) {
  const base = useBaseWallet();
  const value = useMemo(() => buildWallet(base, NO_PRIVY), [base]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function identityFromUser(user: any): string | null {
  const accounts: any[] = user?.linked_accounts ?? [];
  const email = accounts.find((a) => a.type === "email");
  if (email?.address) return email.address;
  const tw = accounts.find((a) => a.type === "twitter_oauth");
  if (tw?.username) return `@${tw.username}`;
  const tg = accounts.find((a) => a.type === "telegram");
  if (tg?.username) return `@${tg.username}`;
  if (tg?.first_name) return tg.first_name;
  return user ? "logged in" : null;
}

function PrivyWalletBridge({ children }: { children: React.ReactNode }) {
  const base = useBaseWallet();
  const { user, logout } = usePrivy();
  const solana = useEmbeddedSolanaWallet();
  const creating = useRef(false);

  // Embedded Solana wallets are not auto-created — create on first login.
  useEffect(() => {
    if (user && solana.status === "not-created" && solana.create && !creating.current) {
      creating.current = true;
      solana
        .create()
        .catch((e: unknown) => console.log("[squawk] privy wallet create failed:", e))
        .finally(() => (creating.current = false));
    }
  }, [user, solana.status]);

  const wallets = (solana as any).wallets as
    | { address: string; getProvider: () => Promise<any> }[]
    | undefined;
  const privyWallet = wallets?.[0] ?? null;

  useEffect(() => {
    if (privyWallet?.address) console.log(`[squawk] privy wallet ${privyWallet.address}`);
  }, [privyWallet?.address]);

  const privySignAndSend = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!privyWallet) throw new Error("privy wallet not ready");
      const provider = await privyWallet.getProvider();
      const { signature } = await provider.request({
        method: "signAndSendTransaction",
        params: { transaction: tx, connection: baseConn },
      });
      await baseConn.confirmTransaction(signature, "confirmed");
      return signature;
    },
    [privyWallet]
  );

  const value = useMemo(
    () =>
      buildWallet(base, {
        authenticated: !!user,
        identityLabel: identityFromUser(user),
        walletAddress: privyWallet?.address ?? null,
        signAndSend: privySignAndSend,
        logout: async () => {
          await logout();
        },
      }),
    [base, user, privyWallet?.address, privySignAndSend, logout]
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!privyEnabled) {
    return <BasicWalletProvider>{children}</BasicWalletProvider>;
  }
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID}>
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
