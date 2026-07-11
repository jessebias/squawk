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

export async function fetchChannels(): Promise<ChannelAccount[]> {
  const all = await (programBase.account as any).channel.all();
  // Hide stale devnet debris: host scripts use Date.now() as channel_id and
  // channels run ~2h max, so anything older is a dead channel from a crashed
  // run, not a joinable room.
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  return all
    .map((c: any) => decodeChannel(c.publicKey, c.account))
    .filter(
      (c: ChannelAccount) =>
        (c.status === "open" || c.status === "live") &&
        c.channelId.toNumber() > cutoff
    )
    .sort((a: ChannelAccount, b: ChannelAccount) => b.channelId.cmp(a.channelId));
}

export async function fetchMemberships(user: PublicKey): Promise<
  { channel: ChannelAccount; member: MemberAccount }[]
> {
  const members = await (programBase.account as any).member.all([
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
  user: PublicKey
): Promise<MemberAccount | null> {
  try {
    return (await (programER.account as any).member.fetch(
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
export async function stakeOnEr(
  session: Keypair,
  user: PublicKey,
  channel: PublicKey,
  roundIndex: number,
  side: "yes" | "no",
  amountUsdc: number
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
  tx.recentBlockhash = (await erConn.getLatestBlockhash()).blockhash;
  return sendLocal(erConn, tx, [session]);
}

/// Claim a resolved position on the ER (permissionless; session key pays $0).
export async function claimOnEr(
  session: Keypair,
  user: PublicKey,
  channel: PublicKey,
  roundIndex: number
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
  tx.recentBlockhash = (await erConn.getLatestBlockhash()).blockhash;
  return sendLocal(erConn, tx, [session]);
}

/// Live subscription to a delegated account over the ER websocket.
/// Account names match the IDL structs (PascalCase).
export function subscribeEr(
  pubkey: PublicKey,
  accountType: "Channel" | "Round" | "Member",
  cb: (decoded: any) => void
): () => void {
  const id = erConn.onAccountChange(
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
    erConn.removeAccountChangeListener(id).catch(() => {});
  };
}

export { channelPda, memberPda, roundPda, baseConn, erConn };
