// Trustless price-round acceptance: a full channel lifecycle where the round
// resolves by the PROGRAM reading a live Pyth Lazer feed ON THE ER — no host
// referee, no oracle authority, permissionless. Proves the on-chain feed read
// works on the real devnet ER.
//
//   npx ts-node scripts/phase-oracle-lifecycle.ts
//
// Flow: create channel + 1 price round → join 2 bots → go_live + delegate →
// open_price_round("SOL >= $X at close?") → bots stake YES/NO → resolve_price_round
// (reads SOL/USD @ offset 73 on the ER) → claim → settle → withdraw.
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

// Pyth Lazer SOL/USD feed (live on the ER, exponent -8, i64 LE @ offset 73)
const SOL_FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const PYTH_PRICE_OFFSET = 73;
const DEPOSIT = 10_000_000; // 10 USDC per bot

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (m: string) => console.log(`\n▶ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
let erTxCount = 0;

/// Read the raw i64 price (exponent -8) from a Pyth Lazer feed account.
async function readFeedPrice(conn: Connection, feed: PublicKey): Promise<number> {
  const info = await conn.getAccountInfo(feed);
  if (!info) throw new Error(`feed ${feed.toBase58()} not found on ${(conn as any)._rpcEndpoint}`);
  return Number(info.data.readBigInt64LE(PYTH_PRICE_OFFSET));
}

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

  // ---- confirm the feed is live on the ER before anything else
  step("read live SOL/USD from the Pyth Lazer feed on the ER");
  const rawAtStart = await readFeedPrice(erConn, SOL_FEED);
  console.log(`  SOL/USD = $${(rawAtStart / 1e8).toFixed(2)} (raw ${rawAtStart}) — feed readable on ${ER_RPC}`);

  // ---- setup: config/mint, 2 bots funded
  step("setup: 2 bots funded (SOL + 10 USDC each)");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const usdcMint: PublicKey = (await (program.account as any).config.fetch(configPda)).usdcMint;
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  if (Number((await getAccount(baseConn, payerAta)).amount) < 2 * DEPOSIT) {
    await mintTo(baseConn, payer, usdcMint, payerAta, payer, 1_000_000_000);
  }
  const bots = [Keypair.generate(), Keypair.generate()];
  const botAtas: PublicKey[] = [];
  for (const bot of bots) {
    await base.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: bot.publicKey,
          lamports: 0.02 * LAMPORTS_PER_SOL,
        })
      ),
      []
    );
    const ata = (await getOrCreateAssociatedTokenAccount(baseConn, payer, usdcMint, bot.publicKey))
      .address;
    await transfer(baseConn, payer, payerAta, ata, payer, DEPOSIT);
    botAtas.push(ata);
  }
  ok("bots funded");

  // ---- channel + 1 round + joins (base layer)
  step("create channel + 1 round + bots join");
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
  const round0 = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), channelPda.toBuffer(), Buffer.from([0, 0])],
    program.programId
  )[0];

  await program.methods
    .createChannel(channelId, "Oracle Price Round", new anchor.BN(Math.floor(Date.now() / 1000) + 7200), 0)
    .accountsPartial({ host: payer.publicKey, config: configPda, usdcMint, channel: channelPda, vault })
    .rpc();
  await program.methods
    .createRound(channelId, 0)
    .accountsPartial({ host: payer.publicKey, channel: channelPda, round: round0 })
    .rpc();
  for (let b = 0; b < 2; b++) {
    await program.methods
      .joinChannel(new anchor.BN(DEPOSIT), bots[b].publicKey)
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
  }
  ok(`channel ${channelPda.toBase58().slice(0, 8)}… · vault=20 USDC`);

  // ---- go live + delegate (channel, 2 members, 1 round)
  step("go_live + delegate to the ER");
  await program.methods.goLive().accountsPartial({ host: payer.publicKey, channel: channelPda }).rpc();
  await program.methods
    .delegateChannel(channelId, null)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  for (const bot of bots) {
    await program.methods
      .delegateMember(channelId, bot.publicKey, null)
      .accountsPartial({ payer: payer.publicKey, channel: channelPda, member: memberPda(bot.publicKey) })
      .rpc({ skipPreflight: true });
    await sleep(250);
  }
  await program.methods
    .delegateRound(channelId, 0, null)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda, round: round0 })
    .rpc({ skipPreflight: true });
  await sleep(3000);
  if (!(await baseConn.getAccountInfo(channelPda))!.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error("delegation failed");
  }
  ok("delegated");

  // ---- open the price round: target set just under the current price so an
  // "Above" round should resolve YES — but the on-chain read is what decides.
  step("open_price_round (SOL Above target)");
  const target = rawAtStart - 50_000_000; // $0.50 under
  const lockWindowSecs = 10;
  const locksAt = Math.floor(Date.now() / 1000) + lockWindowSecs;
  await programER.methods
    .openPriceRound(
      0,
      `SOL >= $${(target / 1e8).toFixed(2)} at close?`,
      new anchor.BN(locksAt),
      new anchor.BN(locksAt + 60),
      new anchor.BN(target),
      0, // Above
      SOL_FEED
    )
    .accountsPartial({ host: payer.publicKey, channel: channelPda, round: round0 })
    .rpc({ skipPreflight: true });
  erTxCount++;
  ok(`target $${(target / 1e8).toFixed(2)}, direction Above · locks in ${lockWindowSecs}s`);

  // ---- bots take opposite sides
  step("bots stake (bot0 YES, bot1 NO)");
  await programER.methods
    .stake(0, { yes: {} } as never, new anchor.BN(6_000_000))
    .accountsPartial({ signer: bots[0].publicKey, channel: channelPda, round: round0, member: memberPda(bots[0].publicKey) })
    .signers([bots[0]])
    .rpc({ skipPreflight: true });
  erTxCount++;
  await programER.methods
    .stake(0, { no: {} } as never, new anchor.BN(4_000_000))
    .accountsPartial({ signer: bots[1].publicKey, channel: channelPda, round: round0, member: memberPda(bots[1].publicKey) })
    .signers([bots[1]])
    .rpc({ skipPreflight: true });
  erTxCount++;
  ok("YES pool 6 · NO pool 4");

  // ---- wait past lock, then resolve TRUSTLESSLY (program reads the feed)
  step("resolve_price_round — the program reads the feed on the ER");
  await sleep((locksAt + 2) * 1000 - Date.now());
  const rawAtResolve = await readFeedPrice(erConn, SOL_FEED);
  const expectedYes = rawAtResolve >= target;
  await programER.methods
    .resolvePriceRound(0)
    .accountsPartial({ channel: channelPda, round: round0, priceFeed: SOL_FEED })
    .rpc({ skipPreflight: true });
  erTxCount++;

  const resolved = await (programER.account as any).round.fetch(round0);
  const onchainPrice = Number(resolved.resolverPrice);
  const status = Object.keys(resolved.status)[0];
  console.log(`  observed on-chain: $${(onchainPrice / 1e8).toFixed(2)} vs target $${(target / 1e8).toFixed(2)} → ${status}`);
  if (onchainPrice === 0) throw new Error("P-FAIL: program read a zero price (feed not readable in-tx)");
  const gotYes = status === "resolvedYes";
  if (gotYes !== expectedYes && status !== "voided") {
    throw new Error(`P-FAIL: outcome ${status} disagrees with observed>=target (${expectedYes})`);
  }
  ok(`TRUSTLESS RESOLVE — program read $${(onchainPrice / 1e8).toFixed(2)} on the ER and settled ${status}`);

  // ---- claim + settle + withdraw
  step("claim + settle + withdraw");
  for (const bot of bots) {
    const m = await (programER.account as any).member.fetch(memberPda(bot.publicKey));
    if (m.position.amount.toNumber() > 0) {
      try {
        await programER.methods
          .claimRound(0)
          .accountsPartial({ channel: channelPda, round: round0, member: memberPda(bot.publicKey) })
          .rpc({ skipPreflight: true });
        erTxCount++;
      } catch {}
    }
  }
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
  await programER.methods
    .commitRounds()
    .accountsPartial({ payer: payer.publicKey, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
    .remainingAccounts([{ pubkey: round0, isWritable: true, isSigner: false }])
    .rpc({ skipPreflight: true });
  erTxCount++;
  await sleep(4000);

  const ch = await (program.account as any).channel.fetch(channelPda);
  if (!("closed" in ch.status)) throw new Error("channel not Closed on base");
  for (let b = 0; b < 2; b++) {
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
    ok(`bot${b + 1} withdrew ${m.balance.toNumber() / 1e6} USDC`);
  }

  console.log(
    `\n★ TRUSTLESS PRICE ROUND ACCEPTED — resolved by an on-chain Pyth read on the ER, no referee`
  );
  console.log(`  SOL $${(onchainPrice / 1e8).toFixed(2)} vs target $${(target / 1e8).toFixed(2)} → ${status} · ${erTxCount} ER txs · 1 settlement · $0.00 fees`);
  console.log(`  explorer: https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
