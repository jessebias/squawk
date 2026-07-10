// Session keys — docs/plan.md §7.3. Main wallet (MWA) signs only join/deposit and
// withdraw; stakes/claims are signed popup-free by a session key.
// TODO(Phase 4): try the official MagicBlock Session Keys SDK first
// (SessionWalletProvider + useSessionKeyManager); if its React hooks fight
// React Native, fall back to a burner Keypair in expo-secure-store registered
// as Member.session_key. Record the outcome in docs/decisions.md. Check the skill's
// lamports-topup.md for funding session-key transaction envelopes.
export {};
