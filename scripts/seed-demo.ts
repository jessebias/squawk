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

// hoursOverride (argv[2]) forces every channel's lifetime; default is the
// per-channel stagger below so Discover shows varied countdown chips.
const CHANNELS = [
  { title: "⚽ Madrid vs Inter", deposit: 24, hours: 6 * 24 },
  { title: "🏀 Lakers vs Celtics", deposit: 42, hours: 3 * 24 },
];

const normalizeTitle = (t: string) =>
  t.replace(/\p{Extended_Pictographic}/gu, "").trim().toLowerCase();

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

  const hoursOverride = process.argv[2] ? Number(process.argv[2]) : null;

  // Idempotent: skip titles that already exist as open/live channels, so
  // re-running tops up the demo set instead of duplicating channels.
  const now = Math.floor(Date.now() / 1000);
  const existing = new Set(
    // dataSize filter: pre-visibility channels have a smaller layout that
    // overruns the decoder (same class of gotcha as old Member accounts).
    ((await (program.account as any).channel.all([
      { dataSize: (program.account as any).channel.size },
    ])) as any[])
      .filter((c) => {
        const st = Object.keys(c.account.status)[0];
        return (st === "open" || st === "live") && c.account.endsAt.toNumber() > now;
      })
      .map((c) =>
        normalizeTitle(Buffer.from(c.account.title).toString("utf8").replace(/\0+$/, ""))
      )
  );

  for (const spec of CHANNELS) {
    if (existing.has(normalizeTitle(spec.title))) {
      console.log(`• ${spec.title} — already live, skipping`);
      continue;
    }
    const channelId = new anchor.BN(Date.now());
    const [channelPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), channelId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
    const lifetimeHours = hoursOverride ?? spec.hours;
    const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + lifetimeHours * 3600);
    await program.methods
      .createChannel(channelId, spec.title, endsAt, 0)
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
    console.log(
      `✓ ${spec.title} · ${spec.deposit} USDC pool · ${lifetimeHours}h · ${channelPda.toBase58()}`
    );
    await sleep(400);
  }
  console.log("\nseeded — channels stay on Discover until each ends_at passes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
