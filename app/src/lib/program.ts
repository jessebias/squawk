// Anchor client for the squawk program — docs/plan.md §4.
// The Program instance is used for instruction building and account decoding
// only; signing/sending is done explicitly per connection (base vs ER).
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "./idl/squawk.json";

export const SQUAWK_PROGRAM_ID = new PublicKey(
  "4NT1YGUK1YWboAq9pyKLqGsHUQaRwDAi7kpATd6Ynuii"
);
export const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
export const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);

// Read-only provider: never signs — transactions are assembled and signed by
// the local wallet / session key / MWA explicitly. anchor's `Wallet` class is
// Node-only (undefined in the RN bundle), so we stub the interface.
const readOnlyWallet = (() => {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
})();

export function getProgram(connection: Connection): Program {
  const provider = new AnchorProvider(connection, readOnlyWallet, {
    commitment: "confirmed",
  });
  return new Program(idl as never, provider);
}

export const configPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], SQUAWK_PROGRAM_ID)[0];

export const channelPda = (channelId: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelId.toArrayLike(Buffer, "le", 8)],
    SQUAWK_PROGRAM_ID
  )[0];

export const memberPda = (channel: PublicKey, user: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("member"), channel.toBuffer(), user.toBuffer()],
    SQUAWK_PROGRAM_ID
  )[0];

export const roundPda = (channel: PublicKey, roundIndex: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(roundIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round"), channel.toBuffer(), b],
    SQUAWK_PROGRAM_ID
  )[0];
};
