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
    src/screens|components/   # Discover, Channel, Profile · PTTButton, OddsCards, RoundCard
    src/lib/                  # connections.ts, program.ts, session.ts
    src/theme.ts              # design tokens (docs/plan.md §8)
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
  `ephemeral-rollups-sdk = { version = "0.14.4", features = ["anchor-compat"] }`,
  session-keys program crate `gpl_session` 3.1.0.
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

# ops
npx ts-node scripts/mint-mock-usdc.ts
npx ts-node scripts/seed-demo.ts   # demo channel + funds demo wallets (SOL AND mock USDC)
```

## Architecture invariants (non-negotiable)

- **The vault (SPL token account) is NEVER delegated to the ER.** Real tokens live on base layer
  the whole session; the ER only mutates ledger numbers in `Member`/`Round` accounts. An ER bug
  must never be able to move tokens except through base-layer settlement checks.
- **Session keys may only call `stake` / `claim_round`** — never `withdraw`, `join_channel`, or
  host instructions.
- **`withdraw` is gated on channel status `Closed`** (state committed back to base layer).
- **Conservation of funds** (test this): at all times
  `total deposits == Σ Member.balance + Σ unresolved Round pools + Σ resolved-but-unclaimed pools`.
- **`close_channel` force-claims all unclaimed positions before commit/undelegate** (ER txns are
  free) so no winnings are stranded when a client is offline at resolution.
- Delegation lifecycle: base layer `create_channel`/`join_channel` → `go_live` delegates
  Channel/Members/Rounds → ER runs `open_round`/`stake`/`lock_round`(crank)/`resolve`/`claim` →
  `close_channel` commits + undelegates → base layer `withdraw`.

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
- [ ] Phase 2 — delegation integration on devnet (**highest risk — before any UI**)
- [ ] Phase 3 — round engine in the ER (open/stake/lock/resolve/claim + crank + simulator)
- [ ] Phase 4 — mobile app core (MWA connect, session keys, three screens, live odds)
- [ ] Phase 5 — polish + demo video + Luma submission (Sunday)

Keep this file, docs/plan.md, and docs/decisions.md in sync with any change to commands, layout, versions,
or architecture. AGENTS.md and GEMINI.md are symlinks to this file.
