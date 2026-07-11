// Host driver for live demos (docs/plan.md §11: laptop-driven host).
// Creates a channel, waits for phones to join, goes live, then loops
// rounds on a timer with a bot moving the odds. Ctrl+C settles everything.
//
//   npx ts-node scripts/host-demo.ts [rounds=20] [--no-bot]
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://rpc.magicblock.app/devnet";
const ER_RPC = process.env.EPHEMERAL_RPC_URL ?? "https://devnet-as.magicblock.app/";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

const STAKE_WINDOW_S = 15; // human-friendly PTT window
const GAP_S = 6;
const QUESTIONS = [
  "Shot on goal in the next 2 minutes?",
  "Someone laughs on camera?",
  "Next slide has a typo?",
  "Demo crashes before the timer?",
  "Judge asks about fees?",
  "Corner kick before the clock hits 5?",
  "Keeper touches the ball twice?",
  "Anyone says 'ephemeral' twice?",
  "Phone battery dies first?",
  "Crowd noise spikes?",
];

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let erTxCount = 0;
let crankLocks = 0;

async function main(): Promise<void> {
  const maxRounds = Number(process.argv[2] ?? 20);
  const useBot = !process.argv.includes("--no-bot");

  const baseConn = new Connection(BASE_RPC, "confirmed");
  const erConn = new Connection(ER_RPC, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const base = new anchor.AnchorProvider(baseConn, wallet, { commitment: "confirmed" });
  const er = new anchor.AnchorProvider(erConn, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, base) as anchor.Program;
  const programER = new anchor.Program(idl, er) as anchor.Program;

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;

  const channelId = new anchor.BN(Date.now());
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
  const memberPda = (u: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("member"), channelPda.toBuffer(), u.toBuffer()],
      program.programId
    )[0];
  const roundPda = (i: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(i);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("round"), channelPda.toBuffer(), b],
      program.programId
    )[0];
  };

  console.log(`\nSQUAWK host · channel id ${channelId.toString()}`);
  await program.methods
    .createChannel(channelId, "⚽ Live Match Demo", new anchor.BN(Math.floor(Date.now() / 1000) + 7200))
    .accountsPartial({ host: payer.publicKey, config: configPda, usdcMint, channel: channelPda, vault })
    .rpc();
  for (let i = 0; i < maxRounds; i++) {
    await program.methods
      .createRound(channelId, i)
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(i) })
      .rpc();
    await sleep(250);
  }
  console.log(`channel live on Discover: ${channelPda.toBase58()}`);

  if (useBot) {
    const bot = Keypair.generate();
    const fund = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: bot.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })
    );
    await base.sendAndConfirm(fund, []);
    const botAta = (await getOrCreateAssociatedTokenAccount(baseConn, payer, usdcMint, bot.publicKey)).address;
    await mintTo(baseConn, payer, usdcMint, botAta, payer, 20_000_000);
    await program.methods
      .joinChannel(new anchor.BN(20_000_000), bot.publicKey)
      .accountsPartial({
        user: bot.publicKey, config: configPda, usdcMint, channel: channelPda,
        member: memberPda(bot.publicKey), userTokenAccount: botAta, vault,
      })
      .signers([bot])
      .rpc();
    console.log("bot joined with 20 USDC (moves the odds)");
    (global as any).__bot = bot;
  }

  // wait for humans: ENTER, or --auto=<seconds> for unattended runs
  const autoArg = process.argv.find((a) => a.startsWith("--auto="));
  if (autoArg) {
    const secs = Number(autoArg.split("=")[1] || 60);
    console.log(`\nJoin from your phones now. Going LIVE in ${secs}s…`);
    await sleep(secs * 1000);
  } else {
    console.log("\nJoin from your phones now. Press ENTER to GO LIVE…");
    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", () => { rl.close(); resolve(); });
    });
  }

  // go live + delegate channel and every member that joined
  await program.methods.goLive().accountsPartial({ host: payer.publicKey, channel: channelPda }).rpc();
  await program.methods
    .delegateChannel(channelId)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  const members = await (program.account as any).member.all([
    { memcmp: { offset: 8, bytes: channelPda.toBase58() } },
  ]);
  for (const m of members) {
    await program.methods
      .delegateMember(channelId, m.account.user)
      .accountsPartial({ payer: payer.publicKey, channel: channelPda, member: m.publicKey })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  for (let i = 0; i < maxRounds; i++) {
    await program.methods
      .delegateRound(channelId, i)
      .accountsPartial({ payer: payer.publicKey, channel: channelPda, round: roundPda(i) })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  await sleep(3000);
  console.log(`LIVE · delegated 1 channel + ${members.length} members + ${maxRounds} rounds\n`);

  const bot: Keypair | undefined = (global as any).__bot;
  let closing = false;
  let currentRound = -1;

  const settle = async () => {
    if (closing) return;
    closing = true;
    console.log("\nsettling…");
    // sweep any unclaimed positions (permissionless, free)
    const allMembers = await (programER.account as any).member.all(
      [{ memcmp: { offset: 8, bytes: channelPda.toBase58() } }]
    ).catch(() => members);
    for (const m of allMembers) {
      const pos = m.account.position;
      if (pos.amount.toNumber() > 0) {
        try {
          await programER.methods
            .claimRound(pos.roundIndex)
            .accountsPartial({ channel: channelPda, round: roundPda(pos.roundIndex), member: m.publicKey })
            .rpc({ skipPreflight: true });
          erTxCount++;
        } catch {}
      }
    }
    const closeSig = await programER.methods
      .closeChannel()
      .accountsPartial({ host: payer.publicKey, channel: channelPda, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
      .remainingAccounts(allMembers.map((m: any) => ({ pubkey: m.publicKey, isWritable: true, isSigner: false })))
      .rpc({ skipPreflight: true });
    erTxCount++;
    const commitSig = await GetCommitmentSignature(closeSig, erConn);
    for (let i = 0; i <= currentRound; i += 5) {
      await programER.methods
        .commitRounds()
        .accountsPartial({ payer: payer.publicKey, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
        .remainingAccounts(
          Array.from({ length: Math.min(5, currentRound + 1 - i) }, (_, k) => ({
            pubkey: roundPda(i + k), isWritable: true, isSigner: false,
          }))
        )
        .rpc({ skipPreflight: true });
      erTxCount++;
    }
    console.log(`\n★ ${erTxCount} ER transactions · 1 settlement · $0.00 fees (${crankLocks} crank locks)`);
    console.log(`  https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);
    console.log("  users can now COLLECT from the Profile tab");
    process.exit(0);
  };
  process.on("SIGINT", () => void settle());

  for (let r = 0; r < maxRounds && !closing; r++) {
    currentRound = r;
    const locksAt = Math.floor(Date.now() / 1000) + STAKE_WINDOW_S;
    const q = QUESTIONS[r % QUESTIONS.length];
    await programER.methods
      .openRound(r, q, new anchor.BN(locksAt), new anchor.BN(locksAt + 60))
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(r) })
      .rpc({ skipPreflight: true });
    erTxCount++;
    console.log(`round ${r + 1}/${maxRounds}: "${q}" (${STAKE_WINDOW_S}s)`);

    try {
      await programER.methods
        .scheduleLockCrank(r, new anchor.BN(Date.now() + r), new anchor.BN(STAKE_WINDOW_S * 1000))
        .accountsPartial({ payer: payer.publicKey, channel: channelPda, round: roundPda(r), magicProgram: MAGIC_PROGRAM_ID })
        .rpc({ skipPreflight: true });
      erTxCount++;
    } catch {}

    if (bot) {
      // bot stakes in two bursts so phones see odds move mid-hold
      for (const delayMs of [2000, STAKE_WINDOW_S * 500]) {
        setTimeout(async () => {
          if (closing) return;
          try {
            const side = Math.random() < 0.5 ? { yes: {} } : { no: {} };
            await programER.methods
              .stake(r, side as never, new anchor.BN((0.5 + Math.random()) * 1e6))
              .accountsPartial({ signer: bot.publicKey, channel: channelPda, round: roundPda(r), member: memberPda(bot.publicKey) })
              .signers([bot])
              .rpc({ skipPreflight: true });
            erTxCount++;
          } catch {}
        }, delayMs);
      }
    }

    await sleep((locksAt + 2) * 1000 - Date.now());
    const st = (await (programER.account as any).round.fetch(roundPda(r))).status;
    if ("locked" in st) crankLocks++;
    else if ("staking" in st) {
      try {
        await programER.methods.lockRound(r).accountsPartial({ channel: channelPda, round: roundPda(r) }).rpc({ skipPreflight: true });
        erTxCount++;
      } catch {
        crankLocks++; // benign race: the crank locked it between our fetch and this tx
      }
    }

    const outcome = Math.random() < 0.5 ? { yes: {} } : { no: {} };
    await programER.methods
      .resolveRound(r, outcome as never)
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(r) })
      .rpc({ skipPreflight: true });
    erTxCount++;
    console.log(`  → resolved ${"yes" in outcome ? "YES" : "NO"} · ${erTxCount} ER txs total`);

    // claim for everyone (phones also auto-claim; double-claims just no-op fail)
    const erMembers = await (programER.account as any).member.all(
      [{ memcmp: { offset: 8, bytes: channelPda.toBase58() } }]
    ).catch(() => []);
    for (const m of erMembers) {
      if (m.account.position.amount.toNumber() > 0 && m.account.position.roundIndex === r) {
        try {
          await programER.methods
            .claimRound(r)
            .accountsPartial({ channel: channelPda, round: roundPda(r), member: m.publicKey })
            .rpc({ skipPreflight: true });
          erTxCount++;
        } catch {}
      }
    }
    await sleep(GAP_S * 1000);
  }
  await settle();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
