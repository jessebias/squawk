# Squawk — Implementation Plan

Walkie-talkie micro prediction markets on Solana, built for MagicBlock Solana Blitz V6 (mobile theme, July 10–12, 2026). This document is the working spec for the build. Read it fully before writing code.

## 0. How to use this plan (instructions for the coding agent)

- **First action, before any code:** fetch and follow MagicBlock's AI Dev Skill, written specifically for AI coding agents building on Ephemeral Rollups: https://docs.magicblock.gg/pages/overview/additional-information/ai-dev-skill.md — it covers delegation patterns, Magic Actions, cranks, VRF, lamports top-up, commit sponsorship, and dual-connection architecture. Treat it as authoritative over this plan for MagicBlock-specific APIs.
- **Second action:** fetch https://docs.magicblock.gg/llms.txt — the full machine-readable index of MagicBlock docs. Every docs page is available as clean markdown by appending `.md` to its URL. Use this index to pull exact pages on demand instead of guessing APIs.
- Work through the phases in Section 8 in order. Each phase has acceptance criteria; do not move on until they pass.
- Verify all SDK APIs (MagicBlock and Solana Mobile) against the live docs in Section 1 before use. When this plan and the docs disagree, the docs win. Note discrepancies in `docs/decisions.md`.
- Prioritize the demo path over completeness. This is a 48-hour hackathon build. Anything marked **[stretch]** is skippable.
- All money in the MVP is devnet USDC or a mock SPL token we mint ourselves. No mainnet funds.

## 1. Reference index (all verified URLs)

### Hackathon — Solana Blitz V6
- Hackathon page (rules, judging, submission info): https://hackathon.magicblock.app/
- Register + submit (Luma, deadline Sunday; needs GitHub repo + short demo video or live link): https://luma.com/zsdnlbnt
- Telegram (questions, team finding, MagicBlock engineer support): https://t.me/+oLOcE79hoqo3OWJi
- WorkAdventure coworking space: https://play.workadventu.re/@/blitz/blitz/small-office
- Official RFP idea board: https://www.notion.so/24fc5a1ab4d68034988ae014fed28600?v=24fc5a1ab4d680b7b11d000c877544ec
- Judging criteria (from the page): creativity, technical depth, meaningful use of Ephemeral Rollup infrastructure; every submission must integrate MagicBlock's ER.

### MagicBlock docs (append `.md` to any page URL for raw markdown)
Core Ephemeral Rollups:
- Products overview: https://docs.magicblock.gg/pages/overview/products
- Why ERs / intro: https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/why
- Delegation, commitment and undelegation (the core lifecycle): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup
- ER quickstart: https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart
- Anchor example walkthrough (delegate + increment counter): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/anchor
- Local development (local ER stack / Surfpool / local VRF): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development
- Ephemeral accounts (accounts living entirely on the ER — read before finalizing the pre-allocation strategy in 4.2): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-accounts
- Magic Router (auto-routes transactions to base layer vs ER): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/magic-router
- Router API (getDelegationStatus, getRoutes): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/api-reference/er/introduction
- Magic Actions (trigger base-layer actions while delegated — evaluate for settlement): https://docs.magicblock.gg/pages/ephemeral-rollups-ers/magic-actions/overview
- ER FAQ: https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/faq

Tools we will use:
- Session Keys intro: https://docs.magicblock.gg/pages/tools/session-keys/introduction
- Session Keys installation: https://docs.magicblock.gg/pages/tools/session-keys/installation
- Session Keys program integration: https://docs.magicblock.gg/pages/tools/session-keys/integrating-sessions-in-your-program
- Session Keys React hook (useSessionKeyManager + SessionWalletProvider): https://docs.magicblock.gg/pages/tools/session-keys/use-sessionkey-manager
- Crank (time-based on-chain execution — use for lock_round): https://docs.magicblock.gg/pages/tools/crank/introduction and /pages/tools/crank/implementation
- VRF quickstart **[stretch]**: https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart
- VRF best practices **[stretch]**: https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/best-practices
- Private ERs **[stretch]**: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart
- Wallets and onramp overview: https://docs.magicblock.gg/pages/tools/wallets-and-onramp/overview

Starter templates and examples (fork, don't start from scratch):
- Example repos (all patterns live here): https://github.com/magicblock-labs/magicblock-engine-examples
- Counter template (minimal delegate/undelegate — Phase 2 reference): https://docs.magicblock.gg/pages/templates/counter
- Rock Paper Scissors template (closest to Squawk: multi-player rounds, stakes, resolution, settlement — primary game-pattern reference): https://docs.magicblock.gg/pages/templates/rock-paper-scissors
- Onchain Dice template (VRF + stake pattern): https://docs.magicblock.gg/pages/templates/onchain-dice
- Gachapon template: https://docs.magicblock.gg/pages/templates/gachapon
- Private Payments template **[stretch]**: https://docs.magicblock.gg/pages/templates/private-payments
- Real-Time Price Feed template (websocket/live-update pattern for the odds UI): https://docs.magicblock.gg/pages/templates/real-time-price-feed

### Solana Mobile docs (this is an Expo React Native project for Solana Mobile)
- Docs home: https://docs.solanamobile.com/
- Environment setup (Expo is the officially recommended framework; Android emulator or device — no Seeker hardware required): https://docs.solanamobile.com/react-native/setup
- Expo dApp setup (dependencies, polyfills, custom development build — READ IN FULL before Phase 4): https://docs.solanamobile.com/react-native/expo
- Mobile Wallet Adapter spec + reference implementations: https://github.com/solana-mobile/mobile-wallet-adapter
- Blueshift Solana Mobile Mastery course (the hackathon's recommended orientation): https://learn.blueshift.gg/en/paths/solana-mobile-mastery
- Supplemental walkthrough (Expo + MWA end to end): https://www.quicknode.com/guides/solana-development/dapps/build-a-solana-mobile-app-on-android-with-react-native

Critical Expo constraints (from the Solana Mobile docs — plan around these from the start):
- **Expo Go does not work.** MWA needs native modules, so use a custom development build via `eas build` (or `--local` with Android Studio + JDK 17). Budget the first EAS build early in Phase 4; it is slow.
- Required deps: `@solana/web3.js`, `@solana-mobile/mobile-wallet-adapter-protocol`, `@solana-mobile/mobile-wallet-adapter-protocol-web3js`, plus polyfills `react-native-get-random-values` (or `expo-crypto`), `buffer`.
- MWA is Android-first. Demo on Android device/emulator; iOS is out of scope for the weekend.

## 2. Product summary

Squawk is a mobile app where users join ephemeral "channels" tied to live moments (a football match, a stream, a hackathon demo). Inside a channel, rapid-fire micro prediction rounds appear (~every 1–2 minutes, e.g. "Shot on goal in the next 2 minutes?"). Users hold a push-to-talk-style button to stake: hold duration grows the stake, release locks it on the currently selected side (YES/NO). Odds update live for everyone. When the channel closes, all balances settle in a single commitment to Solana (devnet for the hackathon).

Why MagicBlock is essential, not decorative: a 90-minute channel with 20 users and 40 rounds generates thousands of tiny state changes (stakes, odds updates, locks, resolutions). On base Solana that is per-transaction fees and ~400ms latency, which kills the live feel. Instead, the channel's accounts are delegated to an Ephemeral Rollup for the session (near-instant, zero-fee transactions) and undelegated/committed back to Solana at settlement. One-line pitch for judges: "ephemeral moments run on ephemeral rollups; permanent money settles on Solana."

## 3. Tech stack

- **On-chain program:** Rust + Anchor (match the version pinned in `magicblock-engine-examples`). One program serves both the base layer and the ER (same bytecode; the ER runs the identical program against delegated accounts).
- **MagicBlock:** `ephemeral-rollups-sdk` (Rust) for delegation hooks; `@magicblock-labs/ephemeral-rollups-sdk` (TS) on the client; MagicBlock **Session Keys SDK** for popup-free staking (Section 7.3); **Crank** for round locking; VRF **[stretch]**.
- **Mobile app:** Expo (React Native, custom development build — see Section 1 constraints) + TypeScript + Mobile Wallet Adapter on Android.
- **RPC routing:** default plan is two `Connection`s (devnet + ER endpoint from the quickstart docs) with explicit routing per instruction. **Evaluate the Magic Router first** (Section 1): if the router endpoint + `getDelegationStatus` handles routing transparently, use a single router connection and delete the manual routing code — simpler and it demos MagicBlock's own infra. Decide in Phase 2 and record in `docs/decisions.md`.
- **Real-time UI:** websocket `onAccountChange` subscriptions against the ER endpoint for delegated accounts (round state, odds) and devnet for base-layer accounts (vault). The Real-Time Price Feed template shows the pattern.
- **Repo tooling:** Anchor workspace + `app/` Expo project in one monorepo; npm scripts or a Justfile for common commands.

## 4. Repository layout

```
squawk/
  Anchor.toml
  programs/squawk/src/lib.rs        # single Anchor program
  programs/squawk/src/state.rs      # account structs
  programs/squawk/src/errors.rs
  tests/squawk.ts                   # anchor tests (localnet + devnet)
  app/                              # Expo React Native app (custom dev build, not Expo Go)
    src/screens/                    # Discover, Channel, Profile
    src/components/                 # PTTButton, OddsCards, RoundCard, Ticker
    src/lib/connections.ts          # routing: Magic Router OR base+ER dual connection
    src/lib/program.ts              # anchor client, IDL
    src/lib/session.ts              # MagicBlock session keys integration
    src/theme.ts                    # design tokens (Section 8)
  scripts/                          # devnet setup: mint mock USDC, seed a demo channel, bot simulator
  docs/
    plan.md                         # this document
    decisions.md                    # decision log / deviations from the plan
  README.md                        # includes demo script + architecture diagram
```

## 5. On-chain program design

### 5.1 Accounts (PDAs)

**Config** — seeds `["config"]`. Global admin, fee settings (fees = 0 for hackathon), mock USDC mint address.

**Channel** — seeds `["channel", channel_id: u64]`. The room. Fields: `host: Pubkey`, `channel_id: u64`, `title: [u8; 64]`, `status: enum {Open, Live, Settling, Closed}`, `round_count: u16`, `active_round: u16`, `total_pool: u64`, `user_count: u16`, `created_at`, `ends_at`. **Delegated to the ER while Live.**

**Round** — seeds `["round", channel_key, round_index: u16]`. One micro-question. Fields: `question: [u8; 128]`, `status: enum {Staking, Locked, ResolvedYes, ResolvedNo, Voided}`, `yes_pool: u64`, `no_pool: u64`, `opens_at: i64`, `locks_at: i64`, `resolves_by: i64`. **Delegated while Live.**

**Position** — seeds `["position", round_key, user_pubkey]`. Fields: `side: enum {Yes, No}`, `amount: u64`, `claimed: bool`. **Delegated while Live.** (Simplification: one position per user per round; a second stake on the same side adds to `amount`; staking the opposite side is rejected.)

**Member** — seeds `["member", channel_key, user_pubkey]`. Per-user channel ledger: `deposited: u64`, `balance: u64` (updated in the ER as rounds resolve), `session_key: Pubkey`. **Delegated while Live.**

**Vault** — an SPL token account (ATA owned by a channel PDA authority) holding all deposited USDC. **Never delegated.** Real tokens stay on the base layer the entire time; the ER only moves ledger numbers inside `Member`/`Round` accounts. This is the key architectural safety decision: the ER manipulates bookkeeping, not tokens, so a bug in ER logic can never move tokens without passing through base-layer settlement checks.

### 5.2 Instructions

Base layer (devnet), before the session:
1. `initialize_config(admin, usdc_mint)`
2. `create_channel(channel_id, title, ends_at)` — host creates channel + vault.
3. `join_channel(amount)` — user transfers USDC into the vault, creates `Member` with `balance = amount`, registers a session key (per the Session Keys program-integration doc; use their macros/validation if provided rather than hand-rolling).
4. `go_live()` — host-only. Sets status Live, then **delegates** `Channel`, all `Member` accounts, and pre-created `Round` accounts to the ER via the delegation CPI from `ephemeral-rollups-sdk` (copy the exact pattern from the counter/RPS examples). Pre-create a fixed array of N rounds (e.g. 40) at `go_live` so no account creation is needed inside the ER — but first read the Ephemeral Accounts doc (Section 1); if ER-native account creation is now well supported, Positions may be created lazily on the ER instead. Decide in Phase 2, record in `docs/decisions.md`.

Ephemeral rollup (during the session — same program, delegated accounts, zero fees):
5. `open_round(round_index, question, locks_at, resolves_by)` — host session key activates the next pre-created round.
6. `stake(round_index, side, amount)` — signed by the user's **session key**; validates session key against `Member`, `Round.status == Staking`, `now < locks_at`, `amount <= Member.balance`. Moves `amount` from `Member.balance` into `yes_pool`/`no_pool` and upserts `Position`.
7. `lock_round(round_index)` — fired automatically at `locks_at` via a MagicBlock **Crank** (see Section 1 crank docs); keep it permissionless so the client can also call it as fallback.
8. `resolve_round(round_index, outcome)` — host-only for MVP (host is the referee, disclosed in UI). Winners are paid pro-rata via per-user `claim_round(round_index)` (free on the ER, so per-user claims cost nothing — the client auto-fires it on resolution): winning positions receive `amount + amount * losing_pool / winning_pool` credited to `Member.balance`. Empty pool on one side → void and refund.
9. `close_channel()` — host-only. Sets status Settling, then **commits and undelegates** all delegated accounts back to base layer via the SDK's commit/undelegate CPI. Evaluate **Magic Actions** (Section 1) as an alternative for triggering base-layer settlement while delegated.

Base layer, after the session:
10. `withdraw()` — user redeems `Member.balance` from the vault as real USDC. Validates channel status Closed. Zeroes the Member ledger.

**[stretch]** `request_question()` — VRF-picked question from an on-chain question bank via MagicBlock VRF, to demo provable fairness.

### 5.3 Invariants to enforce (write tests for these)

- Sum of all `Member.balance` + sum of open `Round` pools == total vault deposits at all times (conservation of funds in the ledger).
- `stake` impossible after `locks_at`; `resolve` impossible before `locks_at`.
- `withdraw` impossible unless channel is Closed (state has been committed back to base layer).
- Session key can only call `stake`/`claim_round`, never `withdraw` or `join_channel`.

## 6. Delegation lifecycle (the judging centerpiece)

```
BASE LAYER (devnet)                    EPHEMERAL ROLLUP
create_channel ──► join_channel(×N)
        │
     go_live ── delegate(Channel, Members, Rounds) ──► accounts now writable only in ER
        │                                              open_round / stake / lock (crank) /
        │                                              resolve / claim  (~10ms, $0)
        │                                              [periodic commits optional]
  close_channel ◄── commit_and_undelegate ────────────┘
        │
    withdraw (real USDC leaves the vault)
```

Instrument this: count ER transactions client-side and display "N transactions · 1 settlement · $0.00 fees" on the channel-close screen. This single stat is the demo's closing shot.

## 7. Client architecture

### 7.1 Screens
- **Discover:** trending channels (`getProgramAccounts` on base layer for Open channels, ER for Live ones), category chips, join flow (deposit modal → `join_channel` signed via Mobile Wallet Adapter).
- **Channel (live):** round card with countdown, YES/NO stat cards with live percentages, single-line activity ticker, PTT button, pool/fees footer. Subscribes to delegated `Round` + `Channel` accounts over the ER websocket.
- **Profile/Settle:** balance, per-channel history, the "Collect" moment → `withdraw` on base layer after channel close.

### 7.2 PTT interaction spec
- `onPressIn`: start stake accumulator (0 → grows ~0.03/50ms, cap 2.00), animate button scale, haptic ticks every 0.25 increment (`expo-haptics`).
- `onPressOut`: if stake > 0.02, submit `stake(round, side, amount)` to the ER signed by the session key; optimistic UI update; reconcile from the websocket account update.
- Side selection via YES/NO cards; default YES; the hint line always states what release will do.

### 7.3 Session keys (critical for UX)
Users must not approve a wallet popup per stake. Use the **official MagicBlock Session Keys SDK** (docs in Section 1): `SessionWalletProvider` + `useSessionKeyManager` on the client, and the corresponding program-side session validation in the Anchor program. The main wallet (Mobile Wallet Adapter) signs only join/deposit and withdraw. If the SDK's React hooks fight React Native, fall back to a hand-rolled burner keypair in `expo-secure-store` registered in `Member.session_key` — but try the official SDK first and record the outcome in `docs/decisions.md`. Check the AI Dev Skill's "lamports top-up" guidance for funding session-key transaction envelopes.

### 7.4 Connection routing
Preferred: single Magic Router connection (Section 3) — the router decides base layer vs ER per transaction, and `getDelegationStatus` tells the client where an account currently lives. Fallback: `connections.ts` exports `baseConn` and `erConn`; instructions 1–4 and 10 → `baseConn`, 5–9 → `erConn`; after `go_live` flip delegated-account subscriptions to `erConn`, after `close_channel` flip back.

## 8. Design system (match the approved mockups)

Background `#0D0D10`; card `#17171C`; hairline border `#26262E`; text `#FFFFFF` / secondary `#9A9AA5` / muted `#6E6E78`; accent orange `#FF6B2C` (used only for: wordmark shadow, live indicators, active chip, timer, PTT); YES green `#1D9E75` on tint `#0F2A20`; NO red `#A34040`/`#F09595` on tint `#2A1414`. Wordmark: "SQUAWK" in Bungee (Google Fonts, via expo-font), white with orange hard-offset shadow — the only display font; all UI text is the system sans. Cards radius 16–20, chips are full pills, five-tab bottom nav with raised center orange mic button. No gradients.

## 9. Build phases

**Phase 1 — Program skeleton on localnet (Fri evening).** Anchor workspace, accounts + instructions 1–3 and 10 with tests, mock USDC mint script. ✅ Accept: `anchor test` green; deposit → withdraw round-trips funds.

**Phase 2 — Delegation integration (Sat morning).** Add `go_live`/`close_channel` with delegate + commit/undelegate CPIs copied from the counter/RPS examples; deploy to devnet; run the full lifecycle against the real ER devnet endpoint from a TS script; decide Magic Router vs dual connection and the account pre-allocation strategy. ✅ Accept: script proves an account is writable on the ER while delegated, rejected on base layer, and state committed back after undelegate. **Highest-risk phase; do it before any UI.**

**Phase 3 — Round engine in the ER (Sat afternoon).** Instructions 5–8 + claim; crank for `lock_round`; conservation-of-funds tests; a CLI "simulate a channel" script (host opens rounds, N bots stake). ✅ Accept: simulated 10-round channel settles with balances summing correctly after undelegation.

**Phase 4 — Mobile app core (Sat evening → Sun morning).** Expo custom development build (kick off the first `eas build` immediately — it's slow), polyfills per the Solana Mobile Expo doc, MWA connect + deposit, session keys, connection routing, three screens per Section 8, live websocket odds. ✅ Accept: two Android devices (or device + emulator) in the same channel see each other's stakes move the odds in under ~1s.

**Phase 5 — Polish + demo (Sun).** Haptics, tx counter stat, empty/edge states, seed script for a demo channel, record the demo video, submit on Luma (repo + video) before the Sunday deadline. **[stretch]:** VRF question picker; Private-ER private stakes.

## 10. Demo script (2 minutes)

1. Cold open: two phones side by side, both holding the PTT — odds visibly react to each other. (5s hook.)
2. "Every one of those holds is a Solana transaction." Show the running tx counter.
3. 30-second explanation over the delegation diagram: channel opens → delegate → play → one commit → withdraw real USDC.
4. Close channel on camera; show "412 transactions · 1 settlement · $0.00 fees," then a devnet explorer link proving the commitment landed.
5. End card: SQUAWK wordmark + "ephemeral moments, permanent money."

## 11. Risks and fallbacks

- **Delegation API drift:** the single biggest risk; mitigated by the AI Dev Skill + llms.txt being read first, Phase 2 coming before any UI, and copying the example repos verbatim before customizing.
- **Expo build friction:** Expo Go won't work with MWA; the custom dev build via EAS is slow the first time. Mitigate by starting the first build at the top of Phase 4 and by keeping a laptop-driven host script so phones only ever need Discover → Channel → PTT.
- **Account creation inside the ER:** resolve via the Ephemeral Accounts doc in Phase 2; pre-allocation at `go_live` (20 users × 40 rounds = 800 small accounts on devnet) remains the safe fallback.
- **Session Keys SDK incompatibility with React Native:** fall back to a hand-rolled burner keypair per Section 7.3.
- **Mobile wallet friction:** MWA is Android-first; demo on Android only. If MWA misbehaves on the demo device, fall back to burner-wallet-only mode with a QR to fund it.
- **Time overrun:** degrade to a single hardcoded channel with host controls run from a laptop script.
- **Compliance note:** demo uses devnet/mock tokens only; framed as such in the README and video.
