// Phase 2 acceptance proof (docs/plan.md §9): full delegation lifecycle against
// the real MagicBlock ER on devnet. Proves that a delegated account is
//   (a) writable on the ER,
//   (b) rejected on the base layer,
//   (c) committed back to base after close_channel, with withdraw working.
//
//   npx ts-node scripts/phase2-lifecycle.ts
//
// Connection architecture (docs/decisions.md): dual connections — base devnet
// for init/delegate/withdraw, ER endpoint for delegated ops + undelegate;
// router used only for getDelegationStatus.
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.EPHEMERAL_RPC_URL ?? "https://devnet-as.magicblock.app/";
const ROUTER = process.env.ROUTER_ENDPOINT ?? "https://devnet-router.magicblock.app/";
const WALLET_PATH =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/jbias.json");

const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/squawk.json"), "utf8"));
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let erTxCount = 0;

const step = (msg: string) => console.log(`\n▶ ${msg}`);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

async function getDelegationStatus(account: PublicKey): Promise<{ isDelegated: boolean }> {
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
  const body = (await res.json()) as { result?: { isDelegated: boolean }; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result!;
}

async function main(): Promise<void> {
  const baseConn = new Connection(BASE_RPC, "confirmed");
  const erConn = new Connection(ER_RPC, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const baseProvider = new anchor.AnchorProvider(baseConn, wallet, { commitment: "confirmed" });
  const erProvider = new anchor.AnchorProvider(erConn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const program = new anchor.Program(idl, baseProvider) as anchor.Program;
  const programER = new anchor.Program(idl, erProvider) as anchor.Program;

  console.log(`payer: ${payer.publicKey.toBase58()}`);
  console.log(`base:  ${BASE_RPC}\nER:    ${ER_RPC}`);
  console.log(`balance: ${(await baseConn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // ---- config (one-time global; reuse existing mint if already initialized)
  step("config + mock USDC");
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  let usdcMint: PublicKey;
  const existing = await baseConn.getAccountInfo(configPda);
  if (existing) {
    usdcMint = (await (program.account as any).config.fetch(configPda)).usdcMint;
    ok(`config exists, mint ${usdcMint.toBase58()}`);
  } else {
    usdcMint = await createMint(baseConn, payer, payer.publicKey, null, 6);
    await program.methods
      .initializeConfig()
      .accountsPartial({ admin: payer.publicKey, config: configPda, usdcMint })
      .rpc();
    ok(`config initialized, mint ${usdcMint.toBase58()}`);
  }
  const payerAta = (
    await getOrCreateAssociatedTokenAccount(baseConn, payer, usdcMint, payer.publicKey)
  ).address;
  if (Number((await getAccount(baseConn, payerAta)).amount) < 10_000_000) {
    await mintTo(baseConn, payer, usdcMint, payerAta, payer, 1_000_000_000);
    ok("minted 1000 mock USDC to payer");
  }

  // ---- channel + join (base layer)
  step("create_channel + join_channel (base layer)");
  const channelId = new anchor.BN(Date.now());
  const idBuf = channelId.toArrayLike(Buffer, "le", 8);
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), idBuf],
    program.programId
  );
  const [memberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), channelPda.toBuffer(), payer.publicKey.toBuffer()],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
  const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 7200);

  await program.methods
    .createChannel(channelId, "Phase 2 Lifecycle", endsAt)
    .accountsPartial({ host: payer.publicKey, config: configPda, usdcMint, channel: channelPda, vault })
    .rpc();
  ok(`channel ${channelPda.toBase58()} (id ${channelId.toString()})`);

  await program.methods
    .joinChannel(new anchor.BN(5_000_000), Keypair.generate().publicKey)
    .accountsPartial({
      user: payer.publicKey,
      config: configPda,
      usdcMint,
      channel: channelPda,
      member: memberPda,
      userTokenAccount: payerAta,
      vault,
    })
    .rpc();
  ok(`joined with 5 USDC · vault=${Number((await getAccount(baseConn, vault)).amount) / 1e6}`);

  // ---- go live + delegate (base layer)
  step("go_live + delegate channel & member (base layer)");
  await program.methods
    .goLive()
    .accountsPartial({ host: payer.publicKey, channel: channelPda })
    .rpc();
  await program.methods
    .delegateChannel(channelId)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  await program.methods
    .delegateMember(channelId, payer.publicKey)
    .accountsPartial({ payer: payer.publicKey, channel: channelPda, member: memberPda })
    .rpc({ skipPreflight: true });
  ok("delegation transactions sent");
  await sleep(3000); // state propagation (skill best practice)

  const chOwner = (await baseConn.getAccountInfo(channelPda))!.owner;
  const memOwner = (await baseConn.getAccountInfo(memberPda))!.owner;
  if (!chOwner.equals(DELEGATION_PROGRAM_ID) || !memOwner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(`delegation failed: owners ${chOwner.toBase58()} / ${memOwner.toBase58()}`);
  }
  ok("base-layer owner of channel + member == DELEGATION_PROGRAM_ID");
  const status = await getDelegationStatus(channelPda);
  ok(`router getDelegationStatus: isDelegated=${status.isDelegated}`);

  // ---- (b) write on base layer must FAIL while delegated
  step("extend_channel on BASE layer (must fail — account is delegated)");
  const newEndsAt = endsAt.addn(1800);
  try {
    await program.methods
      .extendChannel(newEndsAt)
      .accountsPartial({ host: payer.publicKey, channel: channelPda })
      .rpc();
    throw new Error("UNEXPECTED: base-layer write to delegated account succeeded");
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNEXPECTED")) throw e;
    ok(`rejected as expected (${msg.slice(0, 80)}...)`);
  }

  // ---- (a) write on the ER must SUCCEED
  step("extend_channel on the ER (must succeed)");
  const erSig = await programER.methods
    .extendChannel(newEndsAt)
    .accountsPartial({ host: payer.publicKey, channel: channelPda })
    .rpc({ skipPreflight: true });
  erTxCount++;
  ok(`ER tx: ${erSig}`);
  const chOnEr = await (programER.account as any).channel.fetch(channelPda);
  if (chOnEr.endsAt.toNumber() !== newEndsAt.toNumber()) {
    throw new Error("ER state did not update");
  }
  ok(`ER state updated: ends_at=${chOnEr.endsAt.toString()}`);

  // ---- (c) close on the ER → single commitment back to base
  step("close_channel on the ER (commit + undelegate)");
  const closeSig = await programER.methods
    .closeChannel()
    .accountsPartial({
      host: payer.publicKey,
      channel: channelPda,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts([{ pubkey: memberPda, isWritable: true, isSigner: false }])
    .rpc({ skipPreflight: true });
  erTxCount++;
  ok(`ER tx: ${closeSig}`);
  const commitSig = await GetCommitmentSignature(closeSig, erConn);
  ok(`base-layer commitment: ${commitSig}`);
  await sleep(3000);

  const chOwnerAfter = (await baseConn.getAccountInfo(channelPda))!.owner;
  if (!chOwnerAfter.equals(program.programId)) {
    throw new Error(`undelegation failed: channel owner ${chOwnerAfter.toBase58()}`);
  }
  const chFinal = await (program.account as any).channel.fetch(channelPda);
  if (!("closed" in chFinal.status)) throw new Error(`status not Closed: ${JSON.stringify(chFinal.status)}`);
  if (chFinal.endsAt.toNumber() !== newEndsAt.toNumber()) {
    throw new Error("ER-side ends_at change did not survive the commit");
  }
  ok("channel back under program ownership · status=Closed · ER change persisted");

  // ---- withdraw on base layer
  step("withdraw (base layer, real tokens leave the vault)");
  const before = Number((await getAccount(baseConn, payerAta)).amount);
  await program.methods
    .withdraw()
    .accountsPartial({
      user: payer.publicKey,
      config: configPda,
      usdcMint,
      channel: channelPda,
      member: memberPda,
      userTokenAccount: payerAta,
      vault,
    })
    .rpc();
  const after = Number((await getAccount(baseConn, payerAta)).amount);
  if (after - before !== 5_000_000) throw new Error("withdraw amount mismatch");
  ok(`5 USDC returned (${before / 1e6} → ${after / 1e6})`);

  console.log(
    `\n★ PHASE 2 ACCEPTED — ${erTxCount} ER transactions · 1 settlement commitment · $0.00 ER fees`
  );
  console.log(`  explorer: https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
