// Connection routing — docs/plan.md §7.4, decided in Phase 2 (docs/decisions.md):
// dual connections per the MagicBlock skill's best practices. Base layer for
// join/deposit/delegate/withdraw; ER for delegated ops (stake/claim/close);
// the router is used only for getDelegationStatus.
import { Connection, PublicKey } from "@solana/web3.js";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const EPHEMERAL_RPC = "https://devnet-as.magicblock.app/";
export const ROUTER_RPC = "https://devnet-router.magicblock.app/";

export const baseConn = new Connection(DEVNET_RPC, "confirmed");
export const erConn = new Connection(EPHEMERAL_RPC, "confirmed");

export async function getDelegationStatus(
  account: PublicKey
): Promise<{ isDelegated: boolean; fqdn?: string }> {
  const res = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
