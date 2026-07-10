import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { Squawk } from "../target/types/squawk";

const USDC = (n: number) => new anchor.BN(n * 1_000_000); // 6 decimals

describe("squawk — phase 1: config, channel, join, withdraw", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Squawk as Program<Squawk>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const CHANNEL_ID = new anchor.BN(1);
  const channelIdBuf = CHANNEL_ID.toArrayLike(Buffer, "le", 8);

  const user2 = Keypair.generate();
  const sessionKey1 = Keypair.generate().publicKey;
  const sessionKey2 = Keypair.generate().publicKey;

  let usdcMint: PublicKey;
  let user1Ata: PublicKey;
  let user2Ata: PublicKey;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [channelPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("channel"), channelIdBuf],
    program.programId
  );
  const memberPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("member"), channelPda.toBuffer(), user.toBuffer()],
      program.programId
    )[0];
  let vault: PublicKey;

  const vaultBalance = async () =>
    Number((await getAccount(provider.connection, vault)).amount);
  const ataBalance = async (ata: PublicKey) =>
    Number((await getAccount(provider.connection, ata)).amount);

  const expectAnchorError = async (p: Promise<unknown>, code: string) => {
    try {
      await p;
      expect.fail(`expected ${code}, but transaction succeeded`);
    } catch (e) {
      expect((e as anchor.AnchorError).error?.errorCode?.code).to.equal(code);
    }
  };

  before(async () => {
    // fund user2 and set up the mock USDC mint + user ATAs
    const sig = await provider.connection.requestAirdrop(
      user2.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    usdcMint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    user1Ata = (
      await getOrCreateAssociatedTokenAccount(provider.connection, payer, usdcMint, payer.publicKey)
    ).address;
    user2Ata = (
      await getOrCreateAssociatedTokenAccount(provider.connection, payer, usdcMint, user2.publicKey)
    ).address;
    await mintTo(provider.connection, payer, usdcMint, user1Ata, payer, 1_000_000_000); // 1000 USDC
    await mintTo(provider.connection, payer, usdcMint, user2Ata, payer, 1_000_000_000);

    vault = getAssociatedTokenAddressSync(usdcMint, channelPda, true);
  });

  it("initializes config", async () => {
    await program.methods
      .initializeConfig()
      .accountsPartial({ admin: payer.publicKey, config: configPda, usdcMint })
      .rpc();
    const config = await program.account.config.fetch(configPda);
    expect(config.admin.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(config.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
  });

  it("creates a channel with an empty vault", async () => {
    const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    await program.methods
      .createChannel(CHANNEL_ID, "Demo Channel", endsAt)
      .accountsPartial({
        host: payer.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        vault,
      })
      .rpc();

    const channel = await program.account.channel.fetch(channelPda);
    expect(channel.host.toBase58()).to.equal(payer.publicKey.toBase58());
    expect(channel.status).to.deep.equal({ open: {} });
    expect(channel.totalPool.toNumber()).to.equal(0);
    expect(channel.userCount).to.equal(0);
    expect(Buffer.from(channel.title).toString("utf8").replace(/\0+$/, "")).to.equal(
      "Demo Channel"
    );
    expect(await vaultBalance()).to.equal(0);
  });

  it("rejects a title longer than 64 bytes", async () => {
    const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const id = new anchor.BN(99);
    const [ch] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await expectAnchorError(
      program.methods
        .createChannel(id, "x".repeat(65), endsAt)
        .accountsPartial({
          host: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: ch,
          vault: getAssociatedTokenAddressSync(usdcMint, ch, true),
        })
        .rpc(),
      "TitleTooLong"
    );
  });

  it("rejects ends_at in the past", async () => {
    const id = new anchor.BN(98);
    const [ch] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await expectAnchorError(
      program.methods
        .createChannel(id, "Too late", new anchor.BN(1))
        .accountsPartial({
          host: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: ch,
          vault: getAssociatedTokenAddressSync(usdcMint, ch, true),
        })
        .rpc(),
      "InvalidEndsAt"
    );
  });

  it("user1 joins with 100 USDC", async () => {
    await program.methods
      .joinChannel(USDC(100), sessionKey1)
      .accountsPartial({
        user: payer.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(payer.publicKey),
        userTokenAccount: user1Ata,
        vault,
      })
      .rpc();

    const member = await program.account.member.fetch(memberPda(payer.publicKey));
    expect(member.deposited.toNumber()).to.equal(100_000_000);
    expect(member.balance.toNumber()).to.equal(100_000_000);
    expect(member.sessionKey.toBase58()).to.equal(sessionKey1.toBase58());

    const channel = await program.account.channel.fetch(channelPda);
    expect(channel.totalPool.toNumber()).to.equal(100_000_000);
    expect(channel.userCount).to.equal(1);
    expect(await vaultBalance()).to.equal(100_000_000);
  });

  it("rejects joining with zero amount", async () => {
    await expectAnchorError(
      program.methods
        .joinChannel(new anchor.BN(0), sessionKey2)
        .accountsPartial({
          user: user2.publicKey,
          config: configPda,
          usdcMint,
          channel: channelPda,
          member: memberPda(user2.publicKey),
          userTokenAccount: user2Ata,
          vault,
        })
        .signers([user2])
        .rpc(),
      "InvalidAmount"
    );
  });

  it("rejects a duplicate join from the same user", async () => {
    try {
      await program.methods
        .joinChannel(USDC(1), sessionKey1)
        .accountsPartial({
          user: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channelPda,
          member: memberPda(payer.publicKey),
          userTokenAccount: user1Ata,
          vault,
        })
        .rpc();
      expect.fail("duplicate join should fail (member account already exists)");
    } catch (e) {
      expect(String(e)).to.match(/already in use|custom program error/i);
    }
  });

  it("user2 joins with 50 USDC", async () => {
    await program.methods
      .joinChannel(USDC(50), sessionKey2)
      .accountsPartial({
        user: user2.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(user2.publicKey),
        userTokenAccount: user2Ata,
        vault,
      })
      .signers([user2])
      .rpc();

    const channel = await program.account.channel.fetch(channelPda);
    expect(channel.totalPool.toNumber()).to.equal(150_000_000);
    expect(channel.userCount).to.equal(2);
    expect(await vaultBalance()).to.equal(150_000_000);
  });

  it("conserves funds: vault == total_pool == Σ member balances", async () => {
    const channel = await program.account.channel.fetch(channelPda);
    const members = await program.account.member.all();
    const ledgerSum = members
      .filter((m) => m.account.channel.equals(channelPda))
      .reduce((s, m) => s + m.account.balance.toNumber(), 0);
    expect(await vaultBalance()).to.equal(channel.totalPool.toNumber());
    expect(ledgerSum).to.equal(channel.totalPool.toNumber());
  });

  it("user1 withdraws — funds round-trip", async () => {
    const before = await ataBalance(user1Ata);
    await program.methods
      .withdraw()
      .accountsPartial({
        user: payer.publicKey,
        config: configPda,
        usdcMint,
        channel: channelPda,
        member: memberPda(payer.publicKey),
        userTokenAccount: user1Ata,
        vault,
      })
      .rpc();

    expect(await ataBalance(user1Ata)).to.equal(before + 100_000_000);
    const member = await program.account.member.fetch(memberPda(payer.publicKey));
    expect(member.balance.toNumber()).to.equal(0);
    expect(member.deposited.toNumber()).to.equal(100_000_000); // history preserved

    const channel = await program.account.channel.fetch(channelPda);
    expect(channel.totalPool.toNumber()).to.equal(50_000_000);
    expect(await vaultBalance()).to.equal(50_000_000);
  });

  it("rejects withdrawing twice", async () => {
    await expectAnchorError(
      program.methods
        .withdraw()
        .accountsPartial({
          user: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channelPda,
          member: memberPda(payer.publicKey),
          userTokenAccount: user1Ata,
          vault,
        })
        .rpc(),
      "NothingToWithdraw"
    );
  });

  describe("go_live / live-channel gates (channel 2)", () => {
    const ID2 = new anchor.BN(2);
    const [channel2] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), ID2.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const member2 = (user: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("member"), channel2.toBuffer(), user.toBuffer()],
        program.programId
      )[0];
    let vault2: PublicKey;
    let endsAt: anchor.BN;

    before(async () => {
      vault2 = getAssociatedTokenAddressSync(usdcMint, channel2, true);
      endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      await program.methods
        .createChannel(ID2, "Live Channel", endsAt)
        .accountsPartial({
          host: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channel2,
          vault: vault2,
        })
        .rpc();
      await program.methods
        .joinChannel(USDC(10), sessionKey1)
        .accountsPartial({
          user: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channel2,
          member: member2(payer.publicKey),
          userTokenAccount: user1Ata,
          vault: vault2,
        })
        .rpc();
    });

    it("extend_channel works pre-live and rejects non-host", async () => {
      endsAt = endsAt.addn(600);
      await program.methods
        .extendChannel(endsAt)
        .accountsPartial({ host: payer.publicKey, channel: channel2 })
        .rpc();
      const ch = await program.account.channel.fetch(channel2);
      expect(ch.endsAt.toNumber()).to.equal(endsAt.toNumber());

      await expectAnchorError(
        program.methods
          .extendChannel(endsAt.addn(600))
          .accountsPartial({ host: user2.publicKey, channel: channel2 })
          .signers([user2])
          .rpc(),
        "Unauthorized"
      );
    });

    it("go_live flips Open → Live and rejects non-host / double call", async () => {
      await expectAnchorError(
        program.methods
          .goLive()
          .accountsPartial({ host: user2.publicKey, channel: channel2 })
          .signers([user2])
          .rpc(),
        "Unauthorized"
      );

      await program.methods
        .goLive()
        .accountsPartial({ host: payer.publicKey, channel: channel2 })
        .rpc();
      const ch = await program.account.channel.fetch(channel2);
      expect(ch.status).to.deep.equal({ live: {} });

      await expectAnchorError(
        program.methods
          .goLive()
          .accountsPartial({ host: payer.publicKey, channel: channel2 })
          .rpc(),
        "ChannelNotOpen"
      );
    });

    it("rejects join and withdraw while Live", async () => {
      await expectAnchorError(
        program.methods
          .joinChannel(USDC(5), sessionKey2)
          .accountsPartial({
            user: user2.publicKey,
            config: configPda,
            usdcMint,
            channel: channel2,
            member: member2(user2.publicKey),
            userTokenAccount: user2Ata,
            vault: vault2,
          })
          .signers([user2])
          .rpc(),
        "ChannelNotOpen"
      );

      await expectAnchorError(
        program.methods
          .withdraw()
          .accountsPartial({
            user: payer.publicKey,
            config: configPda,
            usdcMint,
            channel: channel2,
            member: member2(payer.publicKey),
            userTokenAccount: user1Ata,
            vault: vault2,
          })
          .rpc(),
        "WithdrawLocked"
      );
    });
  });

  describe("round engine (channel 3 — no delegation needed on localnet)", () => {
    const ID3 = new anchor.BN(3);
    const [channel3] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), ID3.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const member3 = (user: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("member"), channel3.toBuffer(), user.toBuffer()],
        program.programId
      )[0];
    const roundPda = (i: number) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(i);
      return PublicKey.findProgramAddressSync(
        [Buffer.from("round"), channel3.toBuffer(), b],
        program.programId
      )[0];
    };
    const sessionSigner = Keypair.generate();
    let vault3: PublicKey;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const stakeAs = (
      signer: Keypair | null,
      roundIndex: number,
      side: object,
      amount: anchor.BN,
      member: PublicKey
    ) => {
      const builder = program.methods
        .stake(roundIndex, side as never, amount)
        .accountsPartial({
          signer: signer ? signer.publicKey : payer.publicKey,
          channel: channel3,
          round: roundPda(roundIndex),
          member,
        });
      return signer ? builder.signers([signer]).rpc() : builder.rpc();
    };

    const conservation = async () => {
      const ch = await program.account.channel.fetch(channel3);
      const members = (await program.account.member.all()).filter((m) =>
        m.account.channel.equals(channel3)
      );
      const balances = members.reduce((s, m) => s + m.account.balance.toNumber(), 0);
      let pools = 0;
      for (let i = 0; i < ch.roundCount; i++) {
        const r = await program.account.round.fetch(roundPda(i));
        pools += r.yesPool.toNumber() + r.noPool.toNumber();
      }
      expect(balances + pools).to.equal(ch.totalPool.toNumber());
      expect(Number((await getAccount(provider.connection, vault3)).amount)).to.equal(
        ch.totalPool.toNumber()
      );
    };

    before(async () => {
      vault3 = getAssociatedTokenAddressSync(usdcMint, channel3, true);
      const endsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      await program.methods
        .createChannel(ID3, "Round Engine", endsAt)
        .accountsPartial({
          host: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channel3,
          vault: vault3,
        })
        .rpc();
      // user1 registers a real session keypair; user2 uses their own wallet
      await program.methods
        .joinChannel(USDC(100), sessionSigner.publicKey)
        .accountsPartial({
          user: payer.publicKey,
          config: configPda,
          usdcMint,
          channel: channel3,
          member: member3(payer.publicKey),
          userTokenAccount: user1Ata,
          vault: vault3,
        })
        .rpc();
      await program.methods
        .joinChannel(USDC(50), user2.publicKey)
        .accountsPartial({
          user: user2.publicKey,
          config: configPda,
          usdcMint,
          channel: channel3,
          member: member3(user2.publicKey),
          userTokenAccount: user2Ata,
          vault: vault3,
        })
        .signers([user2])
        .rpc();
    });

    it("pre-creates rounds sequentially while Open", async () => {
      for (let i = 0; i < 3; i++) {
        await program.methods
          .createRound(ID3, i)
          .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(i) })
          .rpc();
      }
      const ch = await program.account.channel.fetch(channel3);
      expect(ch.roundCount).to.equal(3);

      await expectAnchorError(
        program.methods
          .createRound(ID3, 5)
          .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(5) })
          .rpc(),
        "RoundOutOfOrder"
      );
    });

    it("runs a full round: open → stakes → lock → resolve → claims", async () => {
      await program.methods
        .goLive()
        .accountsPartial({ host: payer.publicKey, channel: channel3 })
        .rpc();

      const locksAt = new anchor.BN(Math.floor(Date.now() / 1000) + 8);
      const resolvesBy = locksAt.addn(60);
      await program.methods
        .openRound(0, "Will it work?", locksAt, resolvesBy)
        .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(0) })
        .rpc();
      const ch = await program.account.channel.fetch(channel3);
      expect(ch.activeRound).to.equal(0);

      // user1 stakes YES 30 via SESSION KEY, then adds 10 more
      await stakeAs(sessionSigner, 0, { yes: {} }, USDC(30), member3(payer.publicKey));
      await stakeAs(sessionSigner, 0, { yes: {} }, USDC(10), member3(payer.publicKey));
      // opposite side rejected
      await expectAnchorError(
        stakeAs(sessionSigner, 0, { no: {} }, USDC(5), member3(payer.publicKey)),
        "OppositeSide"
      );
      // user2 stakes NO 20 with their own wallet
      await stakeAs(user2, 0, { no: {} }, USDC(20), member3(user2.publicKey));
      // overdraw rejected
      await expectAnchorError(
        stakeAs(user2, 0, { no: {} }, USDC(100), member3(user2.publicKey)),
        "InsufficientBalance"
      );
      // stranger signer rejected
      await expectAnchorError(
        stakeAs(Keypair.generate(), 0, { yes: {} }, USDC(1), member3(user2.publicKey)),
        "SessionKeyInvalid"
      );

      const round = await program.account.round.fetch(roundPda(0));
      expect(round.yesPool.toNumber()).to.equal(40_000_000);
      expect(round.noPool.toNumber()).to.equal(20_000_000);
      await conservation();

      // locking early is rejected; after locks_at it's permissionless+signerless
      await expectAnchorError(
        program.methods
          .lockRound(0)
          .accountsPartial({ channel: channel3, round: roundPda(0) })
          .rpc(),
        "RoundNotLockable"
      );
      await sleep(9000);
      await program.methods
        .lockRound(0)
        .accountsPartial({ channel: channel3, round: roundPda(0) })
        .rpc();
      await expectAnchorError(
        stakeAs(user2, 0, { no: {} }, USDC(1), member3(user2.publicKey)),
        "RoundNotStaking"
      );

      // host resolves YES; snapshots taken
      await program.methods
        .resolveRound(0, { yes: {} })
        .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(0) })
        .rpc();
      const resolved = await program.account.round.fetch(roundPda(0));
      expect(resolved.status).to.deep.equal({ resolvedYes: {} });
      expect(resolved.snapYes.toNumber()).to.equal(40_000_000);

      // claims are permissionless: winner gets stake + pro-rata losing pool
      await program.methods
        .claimRound(0)
        .accountsPartial({ channel: channel3, round: roundPda(0), member: member3(payer.publicKey) })
        .rpc();
      const m1 = await program.account.member.fetch(member3(payer.publicKey));
      // 100 - 40 staked + (40 + 40*20/40 = 60) = 120
      expect(m1.balance.toNumber()).to.equal(120_000_000);
      expect(m1.position.amount.toNumber()).to.equal(0);

      await program.methods
        .claimRound(0)
        .accountsPartial({ channel: channel3, round: roundPda(0), member: member3(user2.publicKey) })
        .rpc();
      const m2 = await program.account.member.fetch(member3(user2.publicKey));
      expect(m2.balance.toNumber()).to.equal(30_000_000); // loser: stake gone

      const drained = await program.account.round.fetch(roundPda(0));
      expect(drained.yesPool.toNumber()).to.equal(0);
      expect(drained.noPool.toNumber()).to.equal(0);
      await conservation();

      await expectAnchorError(
        program.methods
          .claimRound(0)
          .accountsPartial({ channel: channel3, round: roundPda(0), member: member3(payer.publicKey) })
          .rpc(),
        "NothingToClaim"
      );
    });

    it("voids a round whose winning side is empty and refunds via claim", async () => {
      const locksAt = new anchor.BN(Math.floor(Date.now() / 1000) + 6);
      await program.methods
        .openRound(1, "Anyone home?", locksAt, locksAt.addn(60))
        .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(1) })
        .rpc();
      await stakeAs(user2, 1, { no: {} }, USDC(10), member3(user2.publicKey));
      await sleep(7000);

      // resolve straight from Staking past locks_at (missed-crank fallback path)
      await program.methods
        .resolveRound(1, { yes: {} })
        .accountsPartial({ host: payer.publicKey, channel: channel3, round: roundPda(1) })
        .rpc();
      const r = await program.account.round.fetch(roundPda(1));
      expect(r.status).to.deep.equal({ voided: {} });

      await program.methods
        .claimRound(1)
        .accountsPartial({ channel: channel3, round: roundPda(1), member: member3(user2.publicKey) })
        .rpc();
      const m2 = await program.account.member.fetch(member3(user2.publicKey));
      expect(m2.balance.toNumber()).to.equal(30_000_000); // refunded
      await conservation();
    });

    it("rejects staking a Pending round", async () => {
      await expectAnchorError(
        stakeAs(user2, 2, { yes: {} }, USDC(1), member3(user2.publicKey)),
        "RoundNotStaking"
      );
    });
  });

});
