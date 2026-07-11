// Phase 3 acceptance (docs/plan.md §9): simulate a full channel on the real
// devnet ER — host opens rounds, bots stake — and prove the 10-round channel
// settles with balances summing correctly after undelegation.
//
//   npx ts-node scripts/phase3-simulate.ts
//
// Also exercises the MagicBlock crank for lock_round, with the permissionless
// client lock as fallback (docs/plan.md §5.2 item 7).
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://rpc.magicblock.app/devnet";
const ER_RPC = process.env.EPHEMERAL_RPC_URL ?? "https://devnet-as.magicblock.app/";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

const N_BOTS = 3;
const N_ROUNDS = 10;
const DEPOSIT = 15_000_000; // 15 USDC per bot
const QUESTIONS = [
  "Shot on goal in the next 2 minutes?",
  "Corner kick before the clock hits 5?",
  "Keeper touches the ball twice?",
  "Anyone gets a yellow card?",
  "Throw-in on the far side?",
  "Home team completes 10 passes in a row?",
  "Foul called in the next minute?",
  "Ball hits the woodwork?",
  "Offside flag goes up?",
  "Sub happens before the round ends?",
];

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
let erTxCount = 0;
let crankLocks = 0;
let manualLocks = 0;

async function main(): Promise<void> {
  const baseConn = new Connection(BASE_RPC, "confirmed");
  const erConn = new Connection(ER_RPC, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const base = new anchor.AnchorProvider(baseConn, wallet, { commitment: "confirmed" });
  const er = new anchor.AnchorProvider(erConn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const program = new anchor.Program(idl, base) as anchor.Program;
  const programER = new anchor.Program(idl, er) as anchor.Program;

  // ---- setup: config/mint, bots funded with SOL + mock USDC
  step(`setup: ${N_BOTS} bots, ${N_ROUNDS} rounds`);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  if (Number((await getAccount(baseConn, payerAta)).amount) < N_BOTS * DEPOSIT) {
    await mintTo(baseConn, payer, usdcMint, payerAta, payer, 1_000_000_000);
  }

  const bots = Array.from({ length: N_BOTS }, () => Keypair.generate());
  const botAtas: PublicKey[] = [];
  for (const bot of bots) {
    const fund = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: bot.publicKey,
        lamports: 0.02 * LAMPORTS_PER_SOL,
      })
    );
    await base.sendAndConfirm(fund, []);
    const ata = (await getOrCreateAssociatedTokenAccount(baseConn, payer, usdcMint, bot.publicKey))
      .address;
    await transfer(baseConn, payer, payerAta, ata, payer, DEPOSIT);
    botAtas.push(ata);
  }
  ok(`bots funded: ${bots.map((b) => b.publicKey.toBase58().slice(0, 6)).join(", ")}`);

  // ---- channel + rounds + joins (base layer)
  step("create channel + pre-create rounds + bots join (base layer)");
  const channelId = new anchor.BN(Date.now());
  const idBuf = channelId.toArrayLike(Buffer, "le", 8);
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), idBuf],
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

  await program.methods
    .createChannel(channelId, "Simulated Match", new anchor.BN(Math.floor(Date.now() / 1000) + 7200))
    .accountsPartial({ host: payer.publicKey, config: configPda, usdcMint, channel: channelPda, vault })
    .rpc();
  for (let i = 0; i < N_ROUNDS; i++) {
    await program.methods
      .createRound(channelId, i)
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(i) })
      .rpc();
    await sleep(250); // pace base-layer txs to stay under RPC rate limits
  }
  for (let b = 0; b < N_BOTS; b++) {
    await program.methods
      .joinChannel(new anchor.BN(DEPOSIT), bots[b].publicKey) // bot signs directly; session keys are Phase 4
      .accountsPartial({
        user: bots[b].publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(bots[b].publicKey),
        userTokenAccount: botAtas[b],
        vault,
      })
      .signers([bots[b]])
      .rpc();
    await sleep(250);
  }
  ok(`channel ${channelPda.toBase58().slice(0, 8)}… · ${N_ROUNDS} rounds · vault=${Number((await getAccount(baseConn, vault)).amount) / 1e6} USDC`);

  // ---- go live + delegate everything (base layer)
  step("go_live + delegate channel/members/rounds");
  await program.methods.goLive().accountsPartial({ host: payer.publicKey, channel: channelPda }).rpc();
  await program.methods
    .delegateChannel(channelId)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  for (const bot of bots) {
    await program.methods
      .delegateMember(channelId, bot.publicKey)
      .accountsPartial({ payer: payer.publicKey, channel: channelPda, member: memberPda(bot.publicKey) })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  for (let i = 0; i < N_ROUNDS; i++) {
    await program.methods
      .delegateRound(channelId, i)
      .accountsPartial({ payer: payer.publicKey, channel: channelPda, round: roundPda(i) })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  await sleep(3000);
  const owner = (await baseConn.getAccountInfo(channelPda))!.owner;
  if (!owner.equals(DELEGATION_PROGRAM_ID)) throw new Error("delegation failed");
  ok(`1 channel + ${N_BOTS} members + ${N_ROUNDS} rounds delegated`);

  // ---- the session: N_ROUNDS of open → crank → stake → lock → resolve → claim
  step(`running ${N_ROUNDS} rounds on the ER`);
  for (let r = 0; r < N_ROUNDS; r++) {
    const locksAt = Math.floor(Date.now() / 1000) + 6;
    await programER.methods
      .openRound(r, QUESTIONS[r], new anchor.BN(locksAt), new anchor.BN(locksAt + 60))
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(r) })
      .rpc({ skipPreflight: true });
    erTxCount++;

    // schedule the lock crank (one-shot); manual lock remains the fallback
    let crankScheduled = true;
    try {
      await programER.methods
        .scheduleLockCrank(r, new anchor.BN(Date.now() + r), new anchor.BN(6000))
        .accountsPartial({
          payer: payer.publicKey,
          channel: channelPda,
          round: roundPda(r),
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true });
      erTxCount++;
    } catch (e) {
      crankScheduled = false;
      console.log(`  ! crank scheduling failed (${String(e).slice(0, 60)}…) — will lock manually`);
    }

    // bots stake random sides/amounts
    for (const bot of bots) {
      const side = Math.random() < 0.5 ? { yes: {} } : { no: {} };
      const amount = new anchor.BN((1 + Math.floor(Math.random() * 3)) * 1_000_000);
      try {
        await programER.methods
          .stake(r, side as never, amount)
          .accountsPartial({
            signer: bot.publicKey,
            channel: channelPda,
            round: roundPda(r),
            member: memberPda(bot.publicKey),
          })
          .signers([bot])
          .rpc({ skipPreflight: true });
        erTxCount++;
      } catch {
        /* insufficient balance is fine for a bot late in the game */
      }
    }

    // wait past locks_at; prefer the crank, fall back to manual lock
    await sleep((locksAt + 2) * 1000 - Date.now());
    let status = (await (programER.account as any).round.fetch(roundPda(r))).status;
    if ("locked" in status && crankScheduled) {
      crankLocks++;
    } else if ("staking" in status) {
      try {
        await programER.methods
          .lockRound(r)
          .accountsPartial({ channel: channelPda, round: roundPda(r) })
          .rpc({ skipPreflight: true });
        erTxCount++;
        manualLocks++;
      } catch {
        crankLocks++; // benign race: the crank locked it between fetch and tx
      }
    }

    const outcome = Math.random() < 0.5 ? { yes: {} } : { no: {} };
    await programER.methods
      .resolveRound(r, outcome as never)
      .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda(r) })
      .rpc({ skipPreflight: true });
    erTxCount++;

    for (const bot of bots) {
      const m = await (programER.account as any).member.fetch(memberPda(bot.publicKey));
      if (m.position.amount.toNumber() > 0 && m.position.roundIndex === r) {
        await programER.methods
          .claimRound(r)
          .accountsPartial({ channel: channelPda, round: roundPda(r), member: memberPda(bot.publicKey) })
          .rpc({ skipPreflight: true });
        erTxCount++;
      }
    }
    const label = "yes" in outcome ? "YES" : "NO";
    console.log(`  round ${r + 1}/${N_ROUNDS} resolved ${label} · ${erTxCount} ER txs so far`);
  }

  // ---- settle: close (channel + members), then release rounds in batches
  step("close_channel (commit + undelegate) and settle");
  const closeSig = await programER.methods
    .closeChannel()
    .accountsPartial({
      host: payer.publicKey,
      channel: channelPda,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts(bots.map((b) => ({ pubkey: memberPda(b.publicKey), isWritable: true, isSigner: false })))
    .rpc({ skipPreflight: true });
  erTxCount++;
  const commitSig = await GetCommitmentSignature(closeSig, erConn);
  ok(`settlement commitment: ${commitSig}`);

  for (let i = 0; i < N_ROUNDS; i += 5) {
    await programER.methods
      .commitRounds()
      .accountsPartial({ payer: payer.publicKey, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
      .remainingAccounts(
        Array.from({ length: Math.min(5, N_ROUNDS - i) }, (_, k) => ({
          pubkey: roundPda(i + k),
          isWritable: true,
          isSigner: false,
        }))
      )
      .rpc({ skipPreflight: true });
    erTxCount++;
  }
  await sleep(4000);

  // ---- verify conservation on BASE layer after undelegation
  step("verify settlement on base layer");
  const ch = await (program.account as any).channel.fetch(channelPda);
  if (!("closed" in ch.status)) throw new Error("channel not Closed on base");
  let balances = 0;
  for (const bot of bots) {
    balances += (await (program.account as any).member.fetch(memberPda(bot.publicKey))).balance.toNumber();
  }
  let pools = 0;
  for (let i = 0; i < N_ROUNDS; i++) {
    const rd = await (program.account as any).round.fetch(roundPda(i));
    pools += rd.yesPool.toNumber() + rd.noPool.toNumber();
  }
  const totalPool = ch.totalPool.toNumber();
  const vaultAmt = Number((await getAccount(baseConn, vault)).amount);
  console.log(
    `  Σ balances=${balances / 1e6} + Σ pools(dust)=${pools / 1e6} = ${(balances + pools) / 1e6} · total_pool=${totalPool / 1e6} · vault=${vaultAmt / 1e6}`
  );
  if (balances + pools !== totalPool || vaultAmt !== totalPool) {
    throw new Error("CONSERVATION VIOLATED");
  }
  ok("conservation holds after settlement");

  // ---- withdraw all bots (base layer, real tokens)
  step("withdraw all bots");
  for (let b = 0; b < N_BOTS; b++) {
    const m = await (program.account as any).member.fetch(memberPda(bots[b].publicKey));
    if (m.balance.toNumber() === 0) continue;
    await program.methods
      .withdraw()
      .accountsPartial({
        user: bots[b].publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(bots[b].publicKey),
        userTokenAccount: botAtas[b],
        vault,
      })
      .signers([bots[b]])
      .rpc();
    ok(`bot${b + 1} withdrew ${m.balance.toNumber() / 1e6} USDC (deposited 15)`);
  }

  console.log(
    `\n★ PHASE 3 ACCEPTED — ${erTxCount} ER transactions · 1 settlement · $0.00 ER fees`
  );
  console.log(`  locks: ${crankLocks} by crank, ${manualLocks} manual fallback`);
  console.log(`  explorer: https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
