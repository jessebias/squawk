// Thin re-export: the wallet lives in WalletProvider (privy → mwa → local).
// Screens keep consuming { ready, publicKey, sessionKey, signAndSend } —
// plus auth extras (mode, identityLabel, login/logout) where needed.
export { useWalletContext as useWallet } from "../providers/WalletProvider";
export type { AppWallet, WalletMode } from "../providers/WalletProvider";
