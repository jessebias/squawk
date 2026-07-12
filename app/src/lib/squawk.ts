// Squawk data layer: fetchers, transaction builders, and live subscriptions.
// Base layer = join/withdraw (main wallet); ER = stake/claim (session key).
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { baseConn, erConn } from "./connections";
import {
  channelPda,
  configPda,
  getProgram,
  memberPda,
  roundPda,
} from "./program";

export const USDC_DECIMALS = 1_000_000;
export const SESSION_FUND_LAMPORTS = 5_000_000; // 0.005 SOL fee envelope for the session key

export type ChannelAccount = {
  pubkey: PublicKey;
  host: PublicKey;
  channelId: BN;
  title: string;
  status: "open" | "live" | "settling" | "closed";
  roundCount: number;
  activeRound: number;
  totalPool: BN;
  userCount: number;
  endsAt: BN;
  /** 0 = public ER, 1 = private (TEE PER, blind betting + unlisted). */
  visibility: number;
  /** Board mirror — the active round's display data, readable by all channel
   * members even when the Round account itself is host-only (private ERs). */
  activeQuestion: string;
  activeLocksAt: BN;
  /** RoundStatus as u8: 0 pending, 1 staking, 2 locked, 3 yes, 4 no, 5 void. */
  activeRoundStatus: number;
  revealYes: BN;
  revealNo: BN;
  /** 0 none, 1 yes, 2 no, 3 voided. */
  lastOutcome: number;
};

export type RoundAccount = {
  question: string;
  status: "pending" | "staking" | "locked" | "resolvedYes" | "resolvedNo" | "voided";
  yesPool: BN;
  noPool: BN;
  opensAt: BN;
  locksAt: BN;
  roundIndex: number;
};

export type MemberAccount = {
  user: PublicKey;
  balance: BN;
  deposited: BN;
  sessionKey: PublicKey;
  position: { roundIndex: number; side: object; amount: BN };
};

const programBase = getProgram(baseConn);
const programER = getProgram(erConn);

const bytesToString = (bytes: number[] | Uint8Array): string =>
  Buffer.from(bytes).toString("utf8").replace(/\0+$/, "");

const statusKey = (statusObj: object): string => Object.keys(statusObj)[0];

export function decodeChannel(pubkey: PublicKey, raw: any): ChannelAccount {
  return {
    pubkey,
    host: raw.host,
    channelId: raw.channelId,
    title: bytesToString(raw.title),
    status: statusKey(raw.status) as ChannelAccount["status"],
    roundCount: raw.roundCount,
    activeRound: raw.activeRound,
    totalPool: raw.totalPool,
    userCount: raw.userCount,
    endsAt: raw.endsAt,
    visibility: raw.visibility,
    activeQuestion: bytesToString(raw.activeQuestion),
    activeLocksAt: raw.activeLocksAt,
    activeRoundStatus: raw.activeRoundStatus,
    revealYes: raw.revealYes,
    revealNo: raw.revealNo,
    lastOutcome: raw.lastOutcome,
  };
}

export function decodeRound(raw: any): RoundAccount {
  return {
    question: bytesToString(raw.question),
    status: statusKey(raw.status) as RoundAccount["status"],
    yesPool: raw.yesPool,
    noPool: raw.noPool,
    opensAt: raw.opensAt,
    locksAt: raw.locksAt,
    roundIndex: raw.roundIndex,
  };
}

export type LeaderboardEntry = {
  user: PublicKey;
  /// Lifetime staking volume: Σ deposited across all memberships, ×1000
  /// (deposited survives withdraw, so points never regress).
  points: number;
  chips: number;
  channels: number;
};

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  // dataSize filter skips pre-Phase-3 Member accounts (older, smaller layout
  // without `position`) that would overrun the decoder.
  const size = (programBase.account as any).member.size;
  const members = await (programBase.account as any).member.all([{ dataSize: size }]);
  const byUser = new Map<string, LeaderboardEntry>();
  for (const m of members) {
    const key = (m.account.user as PublicKey).toBase58();
    const entry =
      byUser.get(key) ?? { user: m.account.user, points: 0, chips: 0, channels: 0 };
    entry.points += Math.round((m.account.deposited.toNumber() / USDC_DECIMALS) * 1000);
    entry.chips += m.account.balance.toNumber() / USDC_DECIMALS;
    entry.channels += 1;
    byUser.set(key, entry);
  }
  return [...byUser.values()].sort((a, b) => b.points - a.points).slice(0, 50);
}

export async function fetchUsdcBalance(user: PublicKey): Promise<number> {
  try {
    const mint = await getUsdcMint();
    const ata = getAssociatedTokenAddressSync(mint, user);
    const acc = await getAccount(baseConn, ata);
    return Number(acc.amount) / USDC_DECIMALS;
  } catch {
    return 0;
  }
}

// Retired demo titles: still on-chain (no cancel instruction; they linger
// until ends_at) but hidden from Discover. Emoji-stripped, lowercased.
const RETIRED_TITLES = new Set([
  "ranked duo stream",
  "blitz demos live",
  "sol hits 300 this week",
  "btc breaks ath",
  "hackathon finals",
  "muay thai title fight",
]);
const normalizeTitle = (t: string) =>
  t.replace(/\p{Extended_Pictographic}/gu, "").trim().toLowerCase();

export async function fetchChannels(): Promise<ChannelAccount[]> {
  // dataSize filter skips pre-visibility Channel accounts (older, smaller
  // layout) that would overrun the decoder — same class of gotcha as Member.
  const size = (programBase.account as any).channel.size;
  const all = await (programBase.account as any).channel.all([{ dataSize: size }]);
  // Discover shows: open|live AND not past ends_at, PUBLIC only (private
  // channels are unlisted — reached via invite code / deep link), minus any
  // retired demo titles.
  const now = Math.floor(Date.now() / 1000);
  return all
    .map((c: any) => decodeChannel(c.publicKey, c.account))
    .filter(
      (c: ChannelAccount) =>
        (c.status === "open" || c.status === "live") &&
        c.endsAt.toNumber() > now &&
        c.visibility === 0 &&
        !RETIRED_TITLES.has(normalizeTitle(c.title))
    )
    .sort((a: ChannelAccount, b: ChannelAccount) => b.channelId.cmp(a.channelId));
}

/// Fetch one channel by pubkey from the base layer — the invite-code / deep
/// link entry point for unlisted private channels (the base-layer snapshot
/// stays publicly readable, so the join screen works pre-join).
export async function fetchChannelByPk(
  pubkey: PublicKey
): Promise<ChannelAccount | null> {
  try {
    const raw = await (programBase.account as any).channel.fetch(pubkey);
    return decodeChannel(pubkey, raw);
  } catch {
    return null;
  }
}

export async function fetchMemberships(user: PublicKey): Promise<
  { channel: ChannelAccount; member: MemberAccount }[]
> {
  const members = await (programBase.account as any).member.all([
    { dataSize: (programBase.account as any).member.size }, // skip old-layout members
    { memcmp: { offset: 8 + 32, bytes: user.toBase58() } }, // Member.user
  ]);
  const out: { channel: ChannelAccount; member: MemberAccount }[] = [];
  for (const m of members) {
    const ch = await (programBase.account as any).channel.fetch(m.account.channel);
    out.push({
      channel: decodeChannel(m.account.channel, ch),
      member: m.account as MemberAccount,
    });
  }
  return out;
}

export async function fetchMemberOnEr(
  channel: PublicKey,
  user: PublicKey,
  conn: Connection = erConn
): Promise<MemberAccount | null> {
  try {
    return (await (getProgram(conn).account as any).member.fetch(
      memberPda(channel, user)
    )) as MemberAccount;
  } catch {
    return null;
  }
}

export async function getUsdcMint(): Promise<PublicKey> {
  const cfg = await (programBase.account as any).config.fetch(configPda());
  return cfg.usdcMint as PublicKey;
}

/// Join: deposit USDC, register the session key, and fund its fee envelope —
/// one base-layer transaction signed by the main wallet.
export async function buildJoinTx(
  user: PublicKey,
  sessionKey: PublicKey,
  channel: ChannelAccount,
  amountUsdc: number
): Promise<Transaction> {
  const usdcMint = await getUsdcMint();
  const ix = await programBase.methods
    .joinChannel(new BN(amountUsdc * USDC_DECIMALS), sessionKey)
    .accountsPartial({
      user,
      config: configPda(),
      usdcMint,
      channel: channel.pubkey,
      member: memberPda(channel.pubkey, user),
      userTokenAccount: getAssociatedTokenAddressSync(usdcMint, user),
      vault: getAssociatedTokenAddressSync(usdcMint, channel.pubkey, true),
    })
    .instruction();
  const tx = new Transaction().add(ix).add(
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: sessionKey,
      lamports: SESSION_FUND_LAMPORTS,
    })
  );
  tx.feePayer = user;
  tx.recentBlockhash = (await baseConn.getLatestBlockhash()).blockhash;
  return tx;
}

export async function buildWithdrawTx(
  user: PublicKey,
  channel: ChannelAccount
): Promise<Transaction> {
  const usdcMint = await getUsdcMint();
  const ix = await programBase.methods
    .withdraw()
    .accountsPartial({
      user,
      config: configPda(),
      usdcMint,
      channel: channel.pubkey,
      member: memberPda(channel.pubkey, user),
      userTokenAccount: getAssociatedTokenAddressSync(usdcMint, user),
      vault: getAssociatedTokenAddressSync(usdcMint, channel.pubkey, true),
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = user;
  tx.recentBlockhash = (await baseConn.getLatestBlockhash()).blockhash;
  return tx;
}

export async function sendLocal(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[]
): Promise<string> {
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/// Stake on the ER, signed + paid by the session key. ~10ms, $0.00.
/// Private channels pass their token-authenticated TEE connection.
export async function stakeOnEr(
  session: Keypair,
  user: PublicKey,
  channel: PublicKey,
  roundIndex: number,
  side: "yes" | "no",
  amountUsdc: number,
  conn: Connection = erConn
): Promise<string> {
  const ix = await programER.methods
    .stake(
      roundIndex,
      (side === "yes" ? { yes: {} } : { no: {} }) as never,
      new BN(Math.round(amountUsdc * USDC_DECIMALS))
    )
    .accountsPartial({
      signer: session.publicKey,
      channel,
      round: roundPda(channel, roundIndex),
      member: memberPda(channel, user),
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = session.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return sendLocal(conn, tx, [session]);
}

/// Claim a resolved position on the ER (permissionless; session key pays $0).
export async function claimOnEr(
  session: Keypair,
  user: PublicKey,
  channel: PublicKey,
  roundIndex: number,
  conn: Connection = erConn
): Promise<string> {
  const ix = await programER.methods
    .claimRound(roundIndex)
    .accountsPartial({
      channel,
      round: roundPda(channel, roundIndex),
      member: memberPda(channel, user),
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = session.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return sendLocal(conn, tx, [session]);
}

/// Live subscription to a delegated account over the ER websocket.
/// Account names match the IDL structs (PascalCase).
export function subscribeEr(
  pubkey: PublicKey,
  accountType: "Channel" | "Round" | "Member",
  cb: (decoded: any) => void,
  conn: Connection = erConn
): () => void {
  const id = conn.onAccountChange(
    pubkey,
    (info) => {
      try {
        cb(programER.coder.accounts.decode(accountType, info.data));
      } catch {
        /* account may be mid-undelegation */
      }
    },
    "processed"
  );
  return () => {
    conn.removeAccountChangeListener(id).catch(() => {});
  };
}

export { channelPda, memberPda, roundPda, baseConn, erConn };
