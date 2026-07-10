# SQUAWK 🎙️

**Walkie-talkie prediction markets. Ephemeral moments, permanent money.**

Squawk is a mobile app for betting on the next 60 seconds. Join a live channel tied to a moment — a football match, a stream, a hackathon demo — and rapid-fire micro-questions drop every couple of minutes ("Shot on goal in the next 2 minutes?"). Hold the push-to-talk button to stake: the longer you hold, the bigger your stake; release to lock it in on YES or NO. Odds move live as everyone on the channel piles in.

Built for [Solana Blitz V6](https://hackathon.magicblock.app/) (mobile theme) with Expo / React Native, Solana Mobile Wallet Adapter, Anchor, and [MagicBlock Ephemeral Rollups](https://docs.magicblock.gg).

> ⚠️ Hackathon build — runs on devnet with mock tokens.

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

## Status

- [x] Phase 0 — repo bootstrap (Anchor + Expo scaffolds verified end to end)
- [ ] Phase 1 — program skeleton: channels, deposits, withdrawals
- [ ] Phase 2 — ER delegation lifecycle on devnet
- [ ] Phase 3 — round engine: stake / lock (crank) / resolve / claim
- [ ] Phase 4 — mobile app: MWA, session keys, live odds
- [ ] Phase 5 — polish, demo video, submission

## Demo (2 minutes)

Two phones side by side, both holding the PTT — odds visibly react to each other. Every hold is a real Solana transaction on the ER. Channel closes on camera: **"N transactions · 1 settlement · $0.00 fees"**, with a devnet explorer link proving the commitment landed. Ephemeral moments, permanent money.
