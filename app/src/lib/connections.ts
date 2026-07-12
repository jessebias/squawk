// Connection routing — docs/plan.md §7.4, decided in Phase 2 (docs/decisions.md):
// dual connections per the MagicBlock skill's best practices. Base layer for
// join/deposit/delegate/withdraw; ER for delegated ops (stake/claim/close);
// the router is used only for getDelegationStatus. Private channels use the
// TEE ER instead, reached through a per-identity token-authenticated
// connection (getTeeConnection).
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

// magicblock RPC: api.devnet.solana.com blocks getProgramAccounts + rate-limits
export const DEVNET_RPC = "https://rpc.magicblock.app/devnet";
export const EPHEMERAL_RPC = "https://devnet-as.magicblock.app/";
export const ROUTER_RPC = "https://devnet-router.magicblock.app/";
// TEE-backed Private ER (blind-betting channels) + its validator identity.
export const TEE_RPC = "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey(
  "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);

export const baseConn = new Connection(DEVNET_RPC, "confirmed");
export const erConn = new Connection(EPHEMERAL_RPC, "confirmed");

// TEE connections are per-identity: reads are gated by the permission lists,
// so the RPC needs to know who is asking. Tokens come from the SDK's
// challenge/login flow signed with a LOCAL keypair (session key for players,
// host key for hosts — Privy/MWA can't sign messages popup-free) and are
// cached until shortly before expiry.
const teeCache = new Map<string, { conn: Connection; expiresAt: number }>();

export async function getTeeConnection(identity: Keypair): Promise<Connection> {
  const key = identity.publicKey.toBase58();
  const hit = teeCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.conn;
  const { token, expiresAt } = await getAuthToken(
    TEE_RPC,
    identity.publicKey,
    async (message) => nacl.sign.detached(message, identity.secretKey)
  );
  const conn = new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
  teeCache.set(key, { conn, expiresAt });
  return conn;
}

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
