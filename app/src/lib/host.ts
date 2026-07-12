// In-app host actions — a transliteration of scripts/host-demo.ts signed by
// the local host burner (lib/hostKey.ts). Base layer: create/rounds/go_live/
// delegation; ER: open/resolve/claim sweeps/close/commit. Every send is
// skipPreflight (mirrors host-demo's .rpc({skipPreflight:true})) and retries
// transient RPC failures (429s during the delegate burst on the public
// magicblock RPC), with 250ms pacing between base-layer sends.
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  EPHEMERAL_VAULT_ID,
  PERMISSION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { TEE_VALIDATOR, baseConn, erConn, getTeeConnection } from "./connections";
import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  channelPda,
  configPda,
  getProgram,
  memberPda,
  roundPda,
} from "./program";
import { getUsdcMint, type ChannelAccount } from "./squawk";

const programBase = getProgram(baseConn);
const programER = getProgram(erConn);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// A human-readable message for any thrown value — Errors, RPC response
/// objects, or plain objects (which `String(e)` renders as "[object Object]").
/// Shared by the host-controls UI so failures surface a real message.
export const describeError = (e: unknown): string => {
  if (e == null) return "unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || e.toString();
  const anyE = e as { message?: unknown };
  if (typeof anyE.message === "string") return anyE.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

const RETRY_ATTEMPTS = 4;

const isTransient = (e: unknown): boolean => {
  const msg = describeError(e).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("blockhash") ||
    msg.includes("block height exceeded") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("node is behind") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed")
  );
};

// A retried send that landed on-chain but whose confirmation we missed will
// re-submit and come back "already processed" — that's success, not failure.
const alreadyProcessed = (e: unknown): boolean =>
  describeError(e).toLowerCase().includes("already been processed");

/// Sign + send one instruction (or a batch) on `conn`, retrying transient RPC
/// errors with backoff and refreshing the blockhash each attempt. A single
/// 429 in a delegate burst no longer aborts go-live.
async function send(
  conn: Connection,
  host: Keypair,
  ix: any | any[]
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const tx = new Transaction().add(...(Array.isArray(ix) ? ix : [ix]));
      tx.feePayer = host.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(host);
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    } catch (e) {
      lastErr = e;
      if (alreadyProcessed(e)) return "already-processed";
      if (!isTransient(e) || attempt === RETRY_ATTEMPTS - 1) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export const RESOLVE_GRACE_SECS = 60; // resolves_by window after lock, per host-demo

/// Rent + fee envelope for hosting: channel (~0.002) + vault ATA (~0.002) +
/// rounds (~0.0025 each) + base tx fees, with headroom.
export const estimateHostLamports = (rounds: number): number =>
  Math.ceil((0.01 + rounds * 0.004) * LAMPORTS_PER_SOL);

export const newChannelId = (): BN => new BN(Date.now());

const sendBase = (host: Keypair, ix: any): Promise<string> =>
  send(baseConn, host, ix);

/// Lamports pre-funded onto each PDA before TEE delegation so it can pay its
/// own ephemeral-permission rent on the ER (~32 lamports/byte; worst case the
/// channel permission with 20 players ≈ 50k). Delegated accounts carry their
/// lamports onto the ER; only delegated accounts are ER-writable, which is
/// why the PDA itself — not the host key — pays.
const PERMISSION_RENT_LAMPORTS = 500_000;

const PERMISSION_SEED = Buffer.from("permission:");
const permissionPda = (account: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [PERMISSION_SEED, account.toBuffer()],
    PERMISSION_PROGRAM_ID
  )[0];

/// The ER connection for host actions on `channel`: the token-authenticated
/// TEE for private channels, the public ER otherwise.
export async function hostErConn(
  host: Keypair,
  channel: Pick<ChannelAccount, "visibility">
): Promise<Connection> {
  return channel.visibility === 1 ? getTeeConnection(host) : erConn;
}

/// All members of a channel. The dataSize filter is mandatory — pre-Phase-3
/// Member accounts have a smaller layout that overruns the decoder.
async function channelMembers(conn: Connection, channelPk: PublicKey) {
  const program = getProgram(conn);
  const size = (program.account as any).member.size;
  return (program.account as any).member.all([
    { dataSize: size },
    { memcmp: { offset: 8, bytes: channelPk.toBase58() } },
  ]);
}

/// One SOL transfer from the active wallet if the host key can't cover rent.
/// This is the only host-flow operation the main wallet signs — same shape as
/// the session-key funding inside buildJoinTx (proven through Privy/MWA).
export async function ensureHostFunded(
  signAndSend: (tx: Transaction) => Promise<string>,
  from: PublicKey,
  hostKey: PublicKey,
  rounds: number
): Promise<void> {
  const needed = estimateHostLamports(rounds);
  const balance = await baseConn.getBalance(hostKey);
  if (balance >= needed) return;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: hostKey,
      lamports: needed - balance,
    })
  );
  tx.feePayer = from;
  tx.recentBlockhash = (await baseConn.getLatestBlockhash()).blockhash;
  await signAndSend(tx);
  // MWA/Privy return a signature without guaranteeing confirmation — wait
  // until the lamports actually land before spending them on rent.
  for (let i = 0; i < 20; i++) {
    if ((await baseConn.getBalance(hostKey)) >= needed) return;
    await sleep(1000);
  }
  throw new Error("funding transfer not confirmed — try again");
}

/// create_channel + N sequential create_round on the base layer, signed by
/// the host key. Idempotent-resumable: pass the same channelId on retry and
/// it skips what already exists (create_round requires index == round_count).
export async function createChannelOnBase(
  host: Keypair,
  channelId: BN,
  title: string,
  endsAt: number,
  rounds: number,
  onProgress: (msg: string) => void,
  visibility: 0 | 1 = 0
): Promise<{ channelPk: PublicKey }> {
  const channelPk = channelPda(channelId);
  const usdcMint = await getUsdcMint();
  const vault = getAssociatedTokenAddressSync(usdcMint, channelPk, true);

  let existingRounds = 0;
  try {
    const existing = await (programBase.account as any).channel.fetch(channelPk);
    existingRounds = existing.roundCount as number;
  } catch {
    onProgress("creating channel…");
    const ix = await programBase.methods
      .createChannel(channelId, title, new BN(endsAt), visibility)
      .accountsPartial({
        host: host.publicKey,
        config: configPda(),
        usdcMint,
        channel: channelPk,
        vault,
      })
      .instruction();
    await sendBase(host, ix);
  }

  for (let i = existingRounds; i < rounds; i++) {
    onProgress(`preparing round ${i + 1}/${rounds}…`);
    const ix = await programBase.methods
      .createRound(channelId, i)
      .accountsPartial({
        host: host.publicKey,
        channel: channelPk,
        round: roundPda(channelPk, i),
      })
      .instruction();
    await sendBase(host, ix);
    await sleep(250);
  }
  return { channelPk };
}

/// go_live, then delegate Channel + every Member + every Round to the ER —
/// mirrors host-demo.ts lines 140–163 (skipPreflight, 250ms pacing, ~3s settle).
/// Private channels delegate to the TEE validator instead, pre-funding each
/// PDA (permission rent) before delegation, then create the read-gate
/// permissions ON the TEE: channel = host + all members, member = host +
/// that member, round = HOST ONLY (the blind bet).
export async function goLiveAndDelegate(
  host: Keypair,
  channel: ChannelAccount,
  onProgress: (msg: string) => void
): Promise<void> {
  const channelPk = channel.pubkey;
  const channelId = channel.channelId;
  const isPrivate = channel.visibility === 1;
  const validator = isPrivate ? TEE_VALIDATOR : null;

  onProgress("going live…");
  await sendBase(
    host,
    await programBase.methods
      .goLive()
      .accountsPartial({ host: host.publicKey, channel: channelPk })
      .instruction()
  );

  const members = await channelMembers(baseConn, channelPk);

  if (isPrivate) {
    // Pre-fund every PDA with its ephemeral-permission rent BEFORE
    // delegation — delegated accounts carry their lamports onto the ER and
    // pay their own permission rent there (host key isn't ER-writable).
    onProgress("funding privacy rent…");
    const targets: PublicKey[] = [
      channelPk,
      ...members.map((m: any) => m.publicKey as PublicKey),
      ...Array.from({ length: channel.roundCount }, (_, i) =>
        roundPda(channelPk, i)
      ),
    ];
    for (let i = 0; i < targets.length; i += 10) {
      await send(
        baseConn,
        host,
        targets.slice(i, i + 10).map((toPubkey) =>
          SystemProgram.transfer({
            fromPubkey: host.publicKey,
            toPubkey,
            lamports: PERMISSION_RENT_LAMPORTS,
          })
        )
      );
      await sleep(250);
    }
  }

  onProgress("delegating channel…");
  await sendBase(
    host,
    await programBase.methods
      .delegateChannel(channelId, validator)
      .accountsPartial({ payer: host.publicKey, channel: channelPk })
      .instruction()
  );

  for (let i = 0; i < members.length; i++) {
    onProgress(`delegating player ${i + 1}/${members.length}…`);
    await sendBase(
      host,
      await programBase.methods
        .delegateMember(channelId, members[i].account.user, validator)
        .accountsPartial({
          payer: host.publicKey,
          channel: channelPk,
          member: members[i].publicKey,
        })
        .instruction()
    );
    await sleep(250);
  }

  for (let i = 0; i < channel.roundCount; i++) {
    onProgress(`delegating round ${i + 1}/${channel.roundCount}…`);
    await sendBase(
      host,
      await programBase.methods
        .delegateRound(channelId, i, validator)
        .accountsPartial({
          payer: host.publicKey,
          channel: channelPk,
          round: roundPda(channelPk, i),
        })
        .instruction()
    );
    await sleep(250);
  }

  onProgress("waiting for the rollup…");
  await sleep(3000);

  if (isPrivate) {
    await createPermissions(host, channel, members, onProgress);
  }
}

/// The PER read-gate burst, sent to the token-authenticated TEE connection
/// right after delegation. Each instruction CPIs CreateEphemeralPermission
/// with the delegated PDA signing (and paying) via its seeds.
async function createPermissions(
  host: Keypair,
  channel: ChannelAccount,
  members: any[],
  onProgress: (msg: string) => void
): Promise<void> {
  const channelPk = channel.pubkey;
  const channelId = channel.channelId;
  const tee = await getTeeConnection(host);
  const commonAccounts = {
    host: host.publicKey,
    vault: EPHEMERAL_VAULT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
    permissionProgram: PERMISSION_PROGRAM_ID,
  };

  onProgress("locking the room (channel gate)…");
  await send(
    tee,
    host,
    await programER.methods
      .createChannelPermission(channelId)
      .accountsPartial({
        ...commonAccounts,
        channel: channelPk,
        permission: permissionPda(channelPk),
      })
      .remainingAccounts(
        members.map((m: any) => ({
          pubkey: m.publicKey as PublicKey,
          isWritable: false,
          isSigner: false,
        }))
      )
      .instruction()
  );

  for (let i = 0; i < members.length; i++) {
    onProgress(`sealing player ${i + 1}/${members.length}…`);
    const user = members[i].account.user as PublicKey;
    await send(
      tee,
      host,
      await programER.methods
        .createMemberPermission(channelId, user)
        .accountsPartial({
          ...commonAccounts,
          channel: channelPk,
          member: memberPda(channelPk, user),
          permission: permissionPda(memberPda(channelPk, user)),
        })
        .instruction()
    );
  }

  for (let i = 0; i < channel.roundCount; i++) {
    onProgress(`sealing round ${i + 1}/${channel.roundCount}…`);
    await send(
      tee,
      host,
      await programER.methods
        .createRoundPermission(channelId, i)
        .accountsPartial({
          ...commonAccounts,
          channel: channelPk,
          round: roundPda(channelPk, i),
          permission: permissionPda(roundPda(channelPk, i)),
        })
        .instruction()
    );
  }
}

/// open_round on the ER + best-effort schedule_lock_crank (the crank locks
/// the round at locks_at; resolve accepts staking-past-locks_at as backstop).
/// Returns the number of ER transactions sent.
export async function openRoundOnEr(
  host: Keypair,
  channelPk: PublicKey,
  roundIndex: number,
  question: string,
  windowSecs: number,
  er: Connection = erConn
): Promise<number> {
  const round = roundPda(channelPk, roundIndex);
  const locksAt = Math.floor(Date.now() / 1000) + windowSecs;
  let txs = 0;
  await send(
    er,
    host,
    await programER.methods
      .openRound(roundIndex, question, new BN(locksAt), new BN(locksAt + RESOLVE_GRACE_SECS))
      .accountsPartial({ host: host.publicKey, channel: channelPk, round })
      .instruction()
  );
  txs++;
  try {
    await send(
      er,
      host,
      await programER.methods
        .scheduleLockCrank(roundIndex, new BN(Date.now()), new BN(windowSecs * 1000))
        .accountsPartial({
          payer: host.publicKey,
          channel: channelPk,
          round,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .instruction()
    );
    txs++;
  } catch {
    // manual-lock fallback lives in resolve (accepts staking past locks_at)
  }
  return txs;
}

/// resolve_round on the ER, then a permissionless claim sweep for every
/// member with a position on this round (phones also auto-claim; double
/// claims no-op fail). Returns the number of ER transactions sent.
export async function resolveRoundOnEr(
  host: Keypair,
  channelPk: PublicKey,
  roundIndex: number,
  outcome: "yes" | "no",
  er: Connection = erConn
): Promise<number> {
  const round = roundPda(channelPk, roundIndex);
  let txs = 0;
  await send(
    er,
    host,
    await programER.methods
      .resolveRound(roundIndex, (outcome === "yes" ? { yes: {} } : { no: {} }) as never)
      .accountsPartial({ host: host.publicKey, channel: channelPk, round })
      .instruction()
  );
  txs++;

  const members = await channelMembers(er, channelPk).catch(() =>
    channelMembers(baseConn, channelPk).catch(() => [])
  );
  for (const m of members) {
    const pos = m.account.position;
    if (pos.amount.toNumber() > 0 && pos.roundIndex === roundIndex) {
      try {
        await send(
          er,
          host,
          await programER.methods
            .claimRound(roundIndex)
            .accountsPartial({ channel: channelPk, round, member: m.publicKey })
            .instruction()
        );
        txs++;
      } catch {}
    }
  }
  return txs;
}

/// Settle: sweep unclaimed positions, close_channel (commit + undelegate
/// channel/members), then commit ALL rounds in batches of 5 so nothing stays
/// delegated — host-demo settle(), lines 169–212. Returns ER tx count.
export async function closeChannelOnEr(
  host: Keypair,
  channelPk: PublicKey,
  roundCount: number,
  onProgress: (msg: string) => void,
  er: Connection = erConn
): Promise<number> {
  let txs = 0;
  onProgress("sweeping unclaimed winnings…");
  const members = await channelMembers(er, channelPk).catch(() =>
    channelMembers(baseConn, channelPk).catch(() => [])
  );
  for (let i = 0; i < members.length; i++) {
    const pos = members[i].account.position;
    if (pos.amount.toNumber() > 0) {
      onProgress(`claiming ${i + 1}/${members.length}…`);
      try {
        await send(
          er,
          host,
          await programER.methods
            .claimRound(pos.roundIndex)
            .accountsPartial({
              channel: channelPk,
              round: roundPda(channelPk, pos.roundIndex),
              member: members[i].publicKey,
            })
            .instruction()
        );
        txs++;
      } catch {}
    }
  }

  onProgress("settling to Solana…");
  await send(
    er,
    host,
    await programER.methods
      .closeChannel()
      .accountsPartial({
        host: host.publicKey,
        channel: channelPk,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .remainingAccounts(
        members.map((m: any) => ({
          pubkey: m.publicKey as PublicKey,
          isWritable: true,
          isSigner: false,
        }))
      )
      .instruction()
  );
  txs++;

  for (let i = 0; i < roundCount; i += 5) {
    onProgress(`committing rounds ${i + 1}–${Math.min(i + 5, roundCount)}…`);
    await send(
      er,
      host,
      await programER.methods
        .commitRounds()
        .accountsPartial({
          payer: host.publicKey,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        })
        .remainingAccounts(
          Array.from({ length: Math.min(5, roundCount - i) }, (_, k) => ({
            pubkey: roundPda(channelPk, i + k),
            isWritable: true,
            isSigner: false,
          }))
        )
        .instruction()
    );
    txs++;
  }
  return txs;
}
