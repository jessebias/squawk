# SQUAWK 

**Walkie-talkie prediction markets. Ephemeral moments, permanent money.**

Squawk is a mobile app for betting on the next 60 seconds. Join a live channel tied to a moment — a football match, a stream, a hackathon demo — and rapid-fire micro-questions drop every couple of minutes ("Shot on goal in the next 2 minutes?"). Hold the push-to-talk button to stake: the longer you hold, the bigger your stake; release to lock it in on YES or NO. Odds move live as everyone on the channel piles in.

Built for [Solana Blitz V6](https://hackathon.magicblock.app/) (mobile theme) with Expo / React Native, Solana Mobile Wallet Adapter, Anchor, and [MagicBlock Ephemeral Rollups](https://docs.magicblock.gg).

> ⚠️ Hackathon build — runs on devnet with mock tokens.

## 📲 Try it — download the APK

**[⬇ Download Squawk.apk (latest release)](https://github.com/jessebias/squawk/releases/latest/download/Squawk.apk)**

Sideload on any Android 7.0+ phone (enable *Install unknown apps* for your browser, then open the file). Universal APK, debug-signed — no Play Store or keystore needed. See the [release notes](https://github.com/jessebias/squawk/releases/latest) for the SHA-256 and a walkthrough.

## Why Ephemeral Rollups

A 90-minute channel with 20 users and 40 rounds generates thousands of tiny state changes — stakes, odds updates, locks, resolutions. On base Solana that's per-transaction fees and ~400ms latency, which kills the live feel. Instead, the channel's accounts are **delegated to a MagicBlock Ephemeral Rollup for the session** (near-instant, zero-fee transactions) and committed back to Solana in a single settlement when the channel closes:

```
BASE LAYER (devnet)                    EPHEMERAL ROLLUP
create_channel ──► join_channel(×N)
        │
     go_live ── delegate(Channel, Members, Rounds) ──► accounts now writable only in ER
        │                                              open_round / stake / lock (crank) /
        │                                              resolve / claim  (~10ms, $0)
  close_channel ◄── commit_and_undelegate ────────────┘
        │
    withdraw (real USDC leaves the vault)
```

The key safety decision: **the token vault is never delegated.** Real tokens stay on the base layer the entire session — the ER only moves ledger numbers inside `Member`/`Round` accounts, so a bug in ER logic can never move tokens without passing through base-layer settlement checks. Session keys make staking popup-free: the main wallet signs only join/deposit and withdraw.

### Private channels: blind betting on a TEE (Private Ephemeral Rollups)

Public channels have a herding problem — you can watch the pools and follow the crowd. **Private channels** run on MagicBlock's TEE-backed **Private ER** instead: the round's pools are readable *only by the host* (ephemeral permission accounts gate reads at the TEE), each player's stakes are visible only to them, and everyone follows the round through a "board mirror" on the channel account. Pools and outcome reveal at the host's call — true blind betting, enforced by hardware attestation rather than promises. Unlisted by design: share the invite code or `squawk://channel/<pubkey>` deep link. Proven end to end on the devnet TEE by `scripts/phase-per-lifecycle.ts` (unauthenticated reads blocked → member read matrix → blind stake lands → crank lock → reveal → settlement + withdraw).

## Repo layout

```
programs/squawk/     Anchor program (base layer + ER — same bytecode)
tests/               mocha test suite (conservation-of-funds invariants)
app/                 Expo React Native app (Solana Mobile, Android)
scripts/             devnet ops: mock USDC mint, demo seeding, test runner
docs/plan.md         full working spec
docs/decisions.md    decision log
```

## Running it

Prerequisites: Rust + **Anchor 0.32.1**, Solana CLI, **Node 22** (`nvm use`), and for the app **JDK 17** + Android SDK with an emulator or device (Expo Go doesn't work — Mobile Wallet Adapter needs a custom dev build).

```bash
# program
anchor build
anchor test                      # spins a local validator; runs tests/squawk.ts

# app
cd app && yarn install
export JAVA_HOME=<jdk-17> ANDROID_HOME=~/Library/Android/sdk
npx expo run:android             # builds + installs the dev client, starts Metro
```

## What's built

The full lifecycle runs on devnet — not just a happy path in a slide:

- **Program** — the complete channel lifecycle (create → join → delegate → open / stake / lock / resolve / claim → commit + undelegate → withdraw), covered by 20 localnet tests including conservation-of-funds invariants.
- **Ephemeral Rollup** — delegation and single-commit settlement proven against the real MagicBlock devnet ER: `scripts/phase3-simulate.ts` runs a 10-round channel end to end — **94 ER transactions → 1 settlement → exact conservation**.
- **Private channels** — blind betting on the TEE-backed Private ER, proven by `scripts/phase-per-lifecycle.ts` (reads gated at the TEE → blind stakes land → crank lock → reveal → settlement + withdraw).
- **Trustless price rounds** — a round can resolve against a **Pyth Lazer feed the program reads on-chain, live on the Ephemeral Rollup** — no host referee, no oracle authority, permissionless (`open_price_round` / `resolve_price_round`, feeds whitelisted in-program). `scripts/phase-oracle-lifecycle.ts` proves it on devnet: the program read SOL/USD on the ER and settled the round from the on-chain price. Moment/sports questions ("shot on goal?") use a disclosed host referee since they aren't oracle-resolvable.
- **Mobile app** — the walkie-talkie UI with hold-to-stake, live odds, session-key signing, in-app hosting, and Privy / Mobile Wallet Adapter login.


