// Funds a demo wallet (e.g. the app's local wallet shown on the Profile
// screen) with devnet SOL + mock USDC so it can join channels.
//
//   npx ts-node scripts/fund-wallet.ts <address> [sol=0.1] [usdc=50]
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://rpc.magicblock.app/devnet";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");

async function main(): Promise<void> {
  const [addr, solArg, usdcArg] = process.argv.slice(2);
  if (!addr) throw new Error("usage: fund-wallet.ts <address> [sol] [usdc]");
  const dest = new PublicKey(addr);
  const sol = Number(solArg ?? 0.1);
  const usdc = Number(usdcArg ?? 50);

  const conn = new Connection(BASE_RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
  );
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8")
  );
  const program = new anchor.Program(
    idl,
    new anchor.AnchorProvider(conn, new anchor.Wallet(payer), {})
  ) as anchor.Program;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: dest,
      lamports: Math.round(sol * 1e9),
    })
  );
  await anchor.web3.sendAndConfirmTransaction(conn, tx, [payer]);
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, usdcMint, dest);
  await mintTo(conn, payer, usdcMint, ata.address, payer, BigInt(Math.round(usdc * 1e6)));
  console.log(`funded ${dest.toBase58()} with ${sol} SOL + ${usdc} mock USDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
