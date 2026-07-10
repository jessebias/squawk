// Creates the mock USDC mint (6 decimals) and mints 1,000,000 to the payer.
// All money in Squawk is this mock SPL token — docs/plan.md §0.
//
//   SOLANA_RPC_URL=https://api.devnet.solana.com npx ts-node scripts/mint-mock-usdc.ts
//
// Prints the mint address; pass it to initialize_config and docs/decisions.md.
import { Connection, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");

const loadKeypair = (p: string): Keypair =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(WALLET_PATH);
  console.log(`payer: ${payer.publicKey.toBase58()} · rpc: ${RPC_URL}`);

  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`mock USDC mint: ${mint.toBase58()}`);

  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  const sig = await mintTo(connection, payer, mint, ata.address, payer, 1_000_000_000_000n); // 1,000,000 USDC
  console.log(`minted 1,000,000 mock USDC to ${ata.address.toBase58()}\n${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
