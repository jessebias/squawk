// Seeds demo channels for Discover (docs/plan.md §9 Phase 5): creates N open
// channels with distinct titles and one funded bot join each, so the trending
// carousel shows real pools. Live rounds are driven by host-demo.ts.
//
//   npx ts-node scripts/seed-demo.ts
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://rpc.magicblock.app/devnet";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");

const CHANNELS = [
  { title: "⚽ Madrid vs Inter", deposit: 24 },
  { title: "🎮 Ranked duo stream", deposit: 17 },
  { title: "📈 SOL price next hour", deposit: 31 },
  { title: "🏆 Hackathon finals", deposit: 140 },
  { title: "🎬 Blitz demos", deposit: 30 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const conn = new Connection(BASE_RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
  );
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8")
  );
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider) as anchor.Program;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;

  for (const spec of CHANNELS) {
    const channelId = new anchor.BN(Date.now());
    const [channelPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), channelId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
    await program.methods
      .createChannel(channelId, spec.title, new anchor.BN(Math.floor(Date.now() / 1000) + 7200))
      .accountsPartial({
        host: payer.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        vault,
      })
      .rpc();

    const bot = Keypair.generate();
    const fund = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: bot.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fund, []);
    const botAta = (await getOrCreateAssociatedTokenAccount(conn, payer, usdcMint, bot.publicKey))
      .address;
    await mintTo(conn, payer, usdcMint, botAta, payer, BigInt(spec.deposit * 1_000_000));
    const [memberPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), channelPda.toBuffer(), bot.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .joinChannel(new anchor.BN(spec.deposit * 1_000_000), bot.publicKey)
      .accountsPartial({
        user: bot.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda,
        userTokenAccount: botAta,
        vault,
      })
      .signers([bot])
      .rpc();
    console.log(`✓ ${spec.title} · ${spec.deposit} USDC pool · ${channelPda.toBase58()}`);
    await sleep(400);
  }
  console.log("\nseeded — channels visible on Discover for ~2h");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
