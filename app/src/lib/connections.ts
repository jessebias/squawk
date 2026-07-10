// Connection routing — docs/plan.md §7.4, decided in Phase 2 (see docs/decisions.md).
// Preferred: single Magic Router connection (router picks base layer vs ER per
// transaction; getDelegationStatus locates accounts). Fallback: explicit dual
// connections — instructions 1–4 & 10 → baseConn, 5–9 → erConn.
import { Connection } from "@solana/web3.js";

export const DEVNET_RPC = "https://api.devnet.solana.com";
// TODO(Phase 2): take the current ER/router endpoints from the MagicBlock skill
// docs (.agents/skills/magicblock) and delete whichever path we don't use.
export const EPHEMERAL_RPC = "";

export const baseConn = new Connection(DEVNET_RPC, "confirmed");
