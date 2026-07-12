# CLAUDE.md — Squawk

Walkie-talkie micro prediction markets on Solana + MagicBlock Ephemeral Rollups.
Built for **Solana Blitz V6** (mobile theme) — **submission deadline Sunday July 12, 2026** on
[Luma](https://luma.com/zsdnlbnt) (needs GitHub repo + short demo video). Devnet + mock tokens only.

## Document authority (highest first)

1. **MagicBlock AI Dev Skill** (installed in this repo — `/magicblock`) and the live docs index
   https://docs.magicblock.gg/llms.txt (append `.md` to any docs URL for raw markdown)
2. [docs/plan.md](docs/plan.md) — the full working spec (accounts, instructions, phases, design system)
3. [docs/decisions.md](docs/decisions.md) — deviations from docs/plan.md and resolved open questions. When docs
   and docs/plan.md disagree, the docs win; record the discrepancy in docs/decisions.md.

## Repo layout

```
squawk/
  Anchor.toml                 # anchor workspace (localnet default; devnet deploys explicit)
  programs/squawk/src/        # lib.rs, state.rs, errors.rs — single Anchor program
  tests/squawk.ts             # mocha tests (run via scripts/run-tests.js, NOT ts-mocha CLI)
  app/                        # Expo RN app from @solana-mobile/solana-mobile-expo-template
    src/screens|components/   # Discover, Channel, CreateChannel, Profile · the Channel screen
                              # is a walkie-talkie handset: HandsetFrame, FrequencyDisplay
                              # (Orbitron LCD; replaced RoundCard), SpeakerGrille, PTT,
                              # OddsCards (device buttons), LiveDot, HostPanel,
                              # BottomTabBar (five-tab, raised + opens CreateChannel)
    src/lib/                  # connections.ts, program.ts, session.ts, hostKey.ts,
                              # squawk.ts, host.ts (phone-side host actions)
    src/theme.ts              # §8 tokens per the approved mockup (hairlines, no gradients)
  scripts/                    # mint-mock-usdc.ts, seed-demo.ts, run-tests.js
  docs/                       # plan.md (working spec) + decisions.md (decision log)
```

## Toolchain (pinned — do not upgrade mid-hackathon)

- **Node 22** via nvm (`.nvmrc`; system Node 26 breaks the ts-mocha CLI — use the programmatic
  mocha runner `scripts/run-tests.js`). `source ~/.nvm/nvm.sh && nvm use` before Node work.
- **Anchor 0.32.1** (installed CLI matches). MagicBlock examples now target Anchor 1.0; **we copy
  patterns from `00-LEGACY_EXAMPLES/` only** (Anchor 0.32.1 implementations) in
  https://github.com/magicblock-labs/magicblock-engine-examples — key references:
  `anchor-counter` (delegate/undelegate), `rock-paper-scissor` (rounds/stakes/settlement),
  `session-keys`, `crank-counter`.
- **Rust crates:** `anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }`,
  `ephemeral-rollups-sdk = { version = "0.14.4", features = ["anchor-compat", "access-control"] }`
  (access-control = the PER ephemeral-permission CPIs), session-keys program crate `gpl_session` 3.1.0.
- **Android builds:** `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`
  (default java is 25 and will break Gradle) and `ANDROID_HOME=$HOME/Library/Android/sdk`.
  Emulator: `Medium_Phone_API_36.1`. **Expo Go does not work** (MWA needs native modules) — use
  `npx expo run:android` (local build; no EAS account needed).

## Commands

```bash
# program
anchor build                       # compile + IDL
node scripts/run-tests.js          # mocha tests (local validator via anchor test also works)
anchor deploy --provider.cluster devnet   # explicit devnet deploys only

# app (cd app; nvm use first)
yarn android                       # build + install + run on emulator/device (sets up dev client)
npx expo start --dev-client        # metro only, once dev build is installed
npx tsc --noEmit                   # typecheck

# ops (all default to rpc.magicblock.app/devnet — public RPC blocks gPA + rate-limits)
npx ts-node scripts/mint-mock-usdc.ts
npx ts-node scripts/fund-wallet.ts <address> [sol] [usdc]   # fund the app's Profile wallet
npx ts-node scripts/host-demo.ts [rounds] [--auto=<s>]      # drive a live demo channel
npx ts-node scripts/phase2-lifecycle.ts                     # delegation lifecycle proof
npx ts-node scripts/phase3-simulate.ts                      # 10-round bot simulation
npx ts-node scripts/phase-per-lifecycle.ts                  # PRIVATE-ER (TEE) blind-betting proof P1–P6
```

## Wallets (app)

Precedence **privy → mwa (Seeker) → local burner** via `app/src/providers/WalletProvider.tsx`;
session key is always a local burner. The **host key is a second local burner**
(`lib/hostKey.ts`) that owns channels created on-device via the "+" tab — it signs every host
instruction (base + ER) locally because Privy/MWA can't sign ER transactions; the main wallet
only funds it with one SOL transfer (docs/decisions.md 2026-07-12). Hosting is device-bound:
reinstall orphans live hosted channels. Privy needs `EXPO_PUBLIC_PRIVY_APP_ID/_CLIENT_ID` in
`app/.env` (empty ⇒ Privy disabled, burner+MWA only). Polyfill order in `polyfills.ts` is
load-bearing; never enable metro package exports globally (docs/decisions.md 2026-07-12).

## Architecture invariants (non-negotiable)

- **The vault (SPL token account) is NEVER delegated to the ER.** Real tokens live on base layer
  the whole session; the ER only mutates ledger numbers in `Member`/`Round` accounts. An ER bug
  must never be able to move tokens except through base-layer settlement checks.
- **Session keys may only call `stake` / `claim_round`** — never `withdraw`, `join_channel`, or
  host instructions.
- **`withdraw` is gated on channel status `Closed`** (state committed back to base layer).
- **Conservation of funds** (test this): at all times
  `total deposits == Σ Member.balance + Σ unresolved Round pools + Σ resolved-but-unclaimed pools`.
- **`claim_round` and `lock_round` are permissionless AND signerless** (crank-compatible).
  Clients auto-claim on resolution; the host loop claims for every member before
  `close_channel` so no winnings are stranded (ER txns are free). Rounds are released after
  close via batched `commit_rounds`.
- Delegation lifecycle: base layer `create_channel`/`join_channel` → `go_live` delegates
  Channel/Members/Rounds → ER runs `open_round`/`stake`/`lock_round`(crank)/`resolve`/`claim` →
  `close_channel` commits + undelegates → base layer `withdraw`.
- **Private channels (`Channel.visibility=1`) = blind betting on the TEE Private ER**
  (docs/decisions.md 2026-07-12): delegate instructions take `validator: Option<Pubkey>`
  (TEE `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, endpoint `devnet-tee.magicblock.app`);
  after delegation the host fires `create_channel_permission` / `create_member_permission` /
  `create_round_permission` (Round = **host-only readable** — permissions gate reads, not
  writes, so members still stake). Players follow the round via the Channel **board mirror**
  (`active_*`/`reveal_*`/`last_outcome` — written by open/lock/resolve unconditionally; keep
  `channel` writable in LockRound/ResolveRound and the crank metas). Every PDA is pre-funded
  0.0005 SOL before delegation to pay its own ephemeral-permission rent. Client reads on
  private channels need the per-identity token-authed TEE connection
  (`getTeeConnection` — session key for players, host key for hosts). Unlisted on Discover;
  joined via invite code / `squawk://channel/<pk>` deep link.
- **Any `channel.all()` needs a `dataSize` filter** (like Member): pre-visibility channels
  have a smaller layout that overruns the decoder.

## Demo logistics (bite-you-on-Sunday items)

- MWA needs a **wallet app installed on the emulator/device** (Phantom/Solflare/fakewallet) with
  devnet SOL — test this at the top of Phase 4, not during the demo.
- `seed-demo.ts` must fund demo wallets with **both devnet SOL and mock USDC** (faucet is
  rate-limited; fund early).
- Count ER transactions client-side; the closing shot is
  "N transactions · 1 settlement · $0.00 fees" + a devnet explorer link to the commitment.

## Phase tracker (docs/plan.md §9)

- [x] Phase 0 — repo bootstrap: docs, toolchain, Anchor + Expo scaffolds, MagicBlock dev skill
- [x] Phase 1 — program skeleton on localnet (accounts, instructions 1–3 + 10, tests)
- [x] Phase 2 — delegation integration on devnet (dual connections; lifecycle proven by
      `scripts/phase2-lifecycle.ts`; mock USDC mint + endpoints in docs/decisions.md)
- [x] Phase 3 — round engine in the ER (crank-locked rounds proven on devnet by
      `scripts/phase3-simulate.ts`: 93 ER txs · 1 settlement · conservation exact)
- [x] Phase 4 — mobile app core (burner session keys, three screens, live odds via ER
      polling+ws; full join→stake→claim→settle→collect loop verified on emulator.
      RN/Hermes gotchas are documented in docs/decisions.md — don't regress polyfills.ts)
- [x] Phase 5a — polish (haptics vocabulary, SettlementCard closing shot, skeletons/edge
      states, in-panel host errors) + **private channels: PER blind betting on the devnet TEE**
      (proven by `scripts/phase-per-lifecycle.ts`: 13 TEE txs · blind stake · crank · reveal ·
      1 settlement)
- [ ] Phase 5b — demo video + Luma submission (Sunday): MWA connect on a real device, second
      phone, README demo script, record + submit; in-app private-channel pass on the emulator

Keep this file, docs/plan.md, and docs/decisions.md in sync with any change to commands, layout, versions,
or architecture. AGENTS.md and GEMINI.md are symlinks to this file.
