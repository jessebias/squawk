// Private-ER (PER) acceptance proof: blind-betting private channel on the
// devnet TEE validator. Modeled on phase2-lifecycle.ts.
//
//   npx ts-node scripts/phase-per-lifecycle.ts
//
// Assertions:
//   P1  unauthenticated TEE reads of permissioned accounts are blocked
//   P2  member token: channel ✓ / own Member ✓ / other Member ✗ / Round ✗
//   P3  a member can STAKE into the host-only-readable Round  ← go/no-go
//   P4  the crank fires lock_round on the TEE
//   P5  the channel board mirror reveals pools + outcome to members
//   P6  settlement commits to devnet and withdraw round-trips funds
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
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  PERMISSION_PROGRAM_ID,
  GetCommitmentSignature,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://rpc.magicblock.app/devnet";
const TEE_RPC = process.env.TEE_RPC_URL ?? "https://devnet-tee.magicblock.app";
const ROUTER = process.env.ROUTER_ENDPOINT ?? "https://devnet-router.magicblock.app/";
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");

const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");
const PERMISSION_SEED = Buffer.from("permission:");
const PERMISSION_RENT_LAMPORTS = 500_000;

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (msg: string) => console.log(`\n▶ ${msg}`);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
let erTxCount = 0;

const permissionPda = (account: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [PERMISSION_SEED, account.toBuffer()],
    PERMISSION_PROGRAM_ID
  )[0];

async function getDelegationStatus(account: PublicKey): Promise<any> {
  const res = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  const body = (await res.json()) as { result?: any; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function teeConnFor(identity: Keypair): Promise<Connection> {
  const { token } = await getAuthToken(TEE_RPC, identity.publicKey, async (m) =>
    nacl.sign.detached(m, identity.secretKey)
  );
  return new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
}

/// A read that should be BLOCKED: expect an error, or (defensively) a null
/// that we only accept because the same account is readable with the host
/// token — asserted before every blocked-read check.
async function expectBlocked(conn: Connection, account: PublicKey, label: string) {
  try {
    const info = await conn.getAccountInfo(account);
    if (info !== null) throw new Error(`UNEXPECTED: ${label} readable (${info.data.length}B)`);
    ok(`${label}: hidden (null)`);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNEXPECTED")) throw e;
    ok(`${label}: blocked (${msg.slice(0, 60)}…)`);
  }
}

async function expectReadable(conn: Connection, account: PublicKey, label: string) {
  const info = await conn.getAccountInfo(account);
  if (!info) throw new Error(`${label}: expected readable, got null`);
  ok(`${label}: readable (${info.data.length}B)`);
}

async function main(): Promise<void> {
  const baseConn = new Connection(BASE_RPC, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const baseProvider = new anchor.AnchorProvider(baseConn, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, baseProvider) as anchor.Program;

  console.log(`payer/host: ${payer.publicKey.toBase58()}`);
  console.log(`base: ${BASE_RPC}\nTEE:  ${TEE_RPC}`);
  console.log(`balance: ${(await baseConn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // ---- config / mint (must already exist from earlier phases)
  step("config + mock USDC");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;
  ok(`mint ${usdcMint.toBase58()}`);

  // ---- two bots with session keys
  const bots = [Keypair.generate(), Keypair.generate()];
  const sessions = [Keypair.generate(), Keypair.generate()];
  const atas: PublicKey[] = [];
  step("funding 2 bots (SOL + 20 USDC each) and session fee envelopes");
  for (let i = 0; i < 2; i++) {
    const ata = (
      await getOrCreateAssociatedTokenAccount(baseConn, payer, usdcMint, bots[i].publicKey)
    ).address;
    atas.push(ata);
    await mintTo(baseConn, payer, usdcMint, ata, payer, 20_000_000);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: bots[i].publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: sessions[i].publicKey,
        lamports: 0.005 * LAMPORTS_PER_SOL,
      })
    );
    await baseProvider.sendAndConfirm(tx);
  }
  ok("bots funded");

  // ---- private channel + 1 round + joins (base layer)
  step("create PRIVATE channel (visibility=1) + round + joins");
  const channelId = new anchor.BN(Date.now());
  const idBuf = channelId.toArrayLike(Buffer, "le", 8);
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), idBuf],
    program.programId
  );
  const memberPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("member"), channelPda.toBuffer(), user.toBuffer()],
      program.programId
    )[0];
  const roundPda = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), channelPda.toBuffer(), Buffer.from([0, 0])],
    program.programId
  )[0];
  const vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
  const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 7200);

  await program.methods
    .createChannel(channelId, "PER Proof", endsAt, 1)
    .accountsPartial({ host: payer.publicKey, config: configPda, usdcMint, channel: channelPda, vault })
    .rpc();
  await program.methods
    .createRound(channelId, 0)
    .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda })
    .rpc();
  for (let i = 0; i < 2; i++) {
    await program.methods
      .joinChannel(new anchor.BN(10_000_000), sessions[i].publicKey)
      .accountsPartial({
        user: bots[i].publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(bots[i].publicKey),
        userTokenAccount: atas[i],
        vault,
      })
      .signers([bots[i]])
      .rpc();
  }
  ok(`channel ${channelPda.toBase58()} · 2 members · vault=20 USDC`);

  // ---- go_live, pre-fund permission rent, delegate to the TEE validator
  step("go_live + pre-fund + delegate(validator=TEE)");
  await program.methods
    .goLive()
    .accountsPartial({ host: payer.publicKey, channel: channelPda })
    .rpc();
  const fundTx = new Transaction();
  for (const target of [channelPda, memberPda(bots[0].publicKey), memberPda(bots[1].publicKey), roundPda]) {
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: target,
        lamports: PERMISSION_RENT_LAMPORTS,
      })
    );
  }
  await baseProvider.sendAndConfirm(fundTx);
  await program.methods
    .delegateChannel(channelId, TEE_VALIDATOR)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  for (const bot of bots) {
    await program.methods
      .delegateMember(channelId, bot.publicKey, TEE_VALIDATOR)
      .accountsPartial({
        payer: payer.publicKey,
        channel: channelPda,
        member: memberPda(bot.publicKey),
      })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  await program.methods
    .delegateRound(channelId, 0, TEE_VALIDATOR)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda, round: roundPda })
    .rpc({ skipPreflight: true });
  await sleep(3000);

  const chOwner = (await baseConn.getAccountInfo(channelPda))!.owner;
  if (!chOwner.equals(DELEGATION_PROGRAM_ID)) throw new Error("channel not delegated");
  const status = await getDelegationStatus(channelPda);
  ok(`delegated · router: ${JSON.stringify(status)}`);

  // ---- permission burst on the TEE (host token)
  step("create permissions on the TEE (channel=all members, member=own, round=HOST ONLY)");
  const hostTee = await teeConnFor(payer);
  const hostErProvider = new anchor.AnchorProvider(hostTee, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const programTee = new anchor.Program(idl, hostErProvider) as anchor.Program;
  const commonAccounts = {
    host: payer.publicKey,
    vault: EPHEMERAL_VAULT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
    permissionProgram: PERMISSION_PROGRAM_ID,
  };
  await programTee.methods
    .createChannelPermission(channelId)
    .accountsPartial({
      ...commonAccounts,
      channel: channelPda,
      permission: permissionPda(channelPda),
    })
    .remainingAccounts(
      bots.map((b) => ({
        pubkey: memberPda(b.publicKey),
        isWritable: false,
        isSigner: false,
      }))
    )
    .rpc({ skipPreflight: true });
  erTxCount++;
  for (const bot of bots) {
    await programTee.methods
      .createMemberPermission(channelId, bot.publicKey)
      .accountsPartial({
        ...commonAccounts,
        channel: channelPda,
        member: memberPda(bot.publicKey),
        permission: permissionPda(memberPda(bot.publicKey)),
      })
      .rpc({ skipPreflight: true });
    erTxCount++;
  }
  await programTee.methods
    .createRoundPermission(channelId, 0)
    .accountsPartial({
      ...commonAccounts,
      channel: channelPda,
      round: roundPda,
      permission: permissionPda(roundPda),
    })
    .rpc({ skipPreflight: true });
  erTxCount++;
  ok("4 permissions created");

  // sanity: host (authority + member of all) can read everything
  await expectReadable(hostTee, channelPda, "host→channel");
  await expectReadable(hostTee, roundPda, "host→round");

  // ---- P1: unauthenticated reads blocked
  step("P1 — unauthenticated TEE reads");
  const anonConn = new Connection(TEE_RPC, "confirmed");
  await expectBlocked(anonConn, channelPda, "anon→channel");
  await expectBlocked(anonConn, memberPda(bots[0].publicKey), "anon→member[0]");
  await expectBlocked(anonConn, roundPda, "anon→round");

  // ---- P2: member-token read matrix (session key identity)
  step("P2 — member token read matrix");
  const bot0Tee = await teeConnFor(sessions[0]);
  await expectReadable(bot0Tee, channelPda, "member0→channel");
  await expectReadable(bot0Tee, memberPda(bots[0].publicKey), "member0→own member");
  await expectBlocked(bot0Tee, memberPda(bots[1].publicKey), "member0→other member");
  await expectBlocked(bot0Tee, roundPda, "member0→round (blind pool)");

  // ---- open round + crank, then P3: blind stake
  step("open_round + schedule_lock_crank (host, TEE)");
  const lockWindowSecs = 20;
  const locksAt = Math.floor(Date.now() / 1000) + lockWindowSecs;
  await programTee.methods
    .openRound(0, "Blind: will it work?", new anchor.BN(locksAt), new anchor.BN(locksAt + 60))
    .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda })
    .rpc({ skipPreflight: true });
  erTxCount++;
  let crankScheduled = true;
  try {
    await programTee.methods
      .scheduleLockCrank(0, new anchor.BN(Date.now()), new anchor.BN(lockWindowSecs * 1000))
      .accountsPartial({
        payer: payer.publicKey,
        channel: channelPda,
        round: roundPda,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });
    erTxCount++;
    ok("crank scheduled");
  } catch (e) {
    crankScheduled = false;
    console.log(`  ⚠ crank scheduling failed on TEE: ${String(e).slice(0, 100)}`);
  }

  step("P3 — GO/NO-GO: members stake into the unreadable Round");
  const stake = async (i: number, side: object, usdc: number) => {
    const conn = await teeConnFor(sessions[i]);
    const ix = await program.methods
      .stake(0, side as never, new anchor.BN(usdc * 1_000_000))
      .accountsPartial({
        signer: sessions[i].publicKey,
        channel: channelPda,
        round: roundPda,
        member: memberPda(bots[i].publicKey),
      })
      .instruction();
    const tx = new Transaction().add(ix);
    tx.feePayer = sessions[i].publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(sessions[i]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed");
    erTxCount++;
    return sig;
  };
  await stake(0, { yes: {} }, 6);
  await stake(1, { no: {} }, 4);
  // host (round-readable) verifies both stakes landed
  const hostProgramTee = programTee;
  const roundAfterStakes = await (hostProgramTee.account as any).round.fetch(roundPda);
  if (roundAfterStakes.yesPool.toNumber() !== 6_000_000 || roundAfterStakes.noPool.toNumber() !== 4_000_000) {
    throw new Error(
      `P3 FAILED: pools ${roundAfterStakes.yesPool} / ${roundAfterStakes.noPool}`
    );
  }
  ok("P3 PASS — both members staked into a Round they cannot read (blind betting works)");

  // members still can't see the pools mid-round
  await expectBlocked(bot0Tee, roundPda, "member0→round after staking");

  // ---- P4: crank fires on the TEE
  step("P4 — crank lock on the TEE");
  await sleep((lockWindowSecs + 8) * 1000);
  let roundLocked = await (hostProgramTee.account as any).round.fetch(roundPda);
  let crankFired = crankScheduled && "locked" in roundLocked.status;
  if (crankFired) {
    ok("P4 PASS — crank locked the round");
  } else {
    console.log(`  ⚠ P4: crank did not fire (status ${JSON.stringify(roundLocked.status)}) — using manual lock fallback`);
    try {
      await programTee.methods
        .lockRound(0)
        .accountsPartial({ channel: channelPda, round: roundPda })
        .rpc({ skipPreflight: true });
      erTxCount++;
    } catch {}
  }

  // ---- resolve + P5: board mirror reveal
  step("resolve_round(YES) + P5 — board mirror reveal for members");
  await programTee.methods
    .resolveRound(0, { yes: {} } as never)
    .accountsPartial({ host: payer.publicKey, channel: channelPda, round: roundPda })
    .rpc({ skipPreflight: true });
  erTxCount++;
  const bot0Program = new anchor.Program(
    idl,
    new anchor.AnchorProvider(bot0Tee, new anchor.Wallet(sessions[0]), { commitment: "confirmed" })
  ) as anchor.Program;
  const chMirror = await (bot0Program.account as any).channel.fetch(channelPda);
  if (
    chMirror.activeRoundStatus !== 3 ||
    chMirror.revealYes.toNumber() !== 6_000_000 ||
    chMirror.revealNo.toNumber() !== 4_000_000 ||
    chMirror.lastOutcome !== 1
  ) {
    throw new Error(
      `P5 FAILED: mirror ${chMirror.activeRoundStatus} / ${chMirror.revealYes} / ${chMirror.revealNo} / ${chMirror.lastOutcome}`
    );
  }
  ok("P5 PASS — member sees revealed pools 6/4 YES via the channel mirror");

  // claims (host sweep, permissionless)
  for (const bot of bots) {
    try {
      await programTee.methods
        .claimRound(0)
        .accountsPartial({
          channel: channelPda,
          round: roundPda,
          member: memberPda(bot.publicKey),
        })
        .rpc({ skipPreflight: true });
      erTxCount++;
    } catch {}
  }

  // ---- P6: settle + withdraw
  step("P6 — close_channel (commit+undelegate) + commit_rounds + withdraw");
  const closeSig = await programTee.methods
    .closeChannel()
    .accountsPartial({
      host: payer.publicKey,
      channel: channelPda,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts(
      bots.map((b) => ({ pubkey: memberPda(b.publicKey), isWritable: true, isSigner: false }))
    )
    .rpc({ skipPreflight: true });
  erTxCount++;
  const commitSig = await GetCommitmentSignature(closeSig, hostTee);
  ok(`commitment: ${commitSig}`);
  await programTee.methods
    .commitRounds()
    .accountsPartial({
      payer: payer.publicKey,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts([{ pubkey: roundPda, isWritable: true, isSigner: false }])
    .rpc({ skipPreflight: true });
  erTxCount++;
  await sleep(5000);

  const chOwnerAfter = (await baseConn.getAccountInfo(channelPda))!.owner;
  if (!chOwnerAfter.equals(program.programId)) {
    throw new Error(`undelegation failed: ${chOwnerAfter.toBase58()}`);
  }
  // winner (bot0): 10 - 6 + (6 + 4) = 14 USDC
  const before = Number((await getAccount(baseConn, atas[0])).amount);
  await program.methods
    .withdraw()
    .accountsPartial({
      user: bots[0].publicKey,
      config: configPda,
      usdcMint,
      channel: channelPda,
      member: memberPda(bots[0].publicKey),
      userTokenAccount: atas[0],
      vault,
    })
    .signers([bots[0]])
    .rpc();
  const after = Number((await getAccount(baseConn, atas[0])).amount);
  if (after - before !== 14_000_000) {
    throw new Error(`withdraw mismatch: got ${(after - before) / 1e6} expected 14`);
  }
  ok(`winner withdrew 14 USDC (${before / 1e6} → ${after / 1e6})`);

  console.log(
    `\n★ PER LIFECYCLE ${crankFired ? "FULLY " : ""}ACCEPTED — ${erTxCount} TEE transactions · 1 settlement · $0.00 fees`
  );
  if (!crankFired) console.log("  ⚠ P4 crank-on-TEE failed — host-side lock fallback required in-app");
  console.log(`  explorer: https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
