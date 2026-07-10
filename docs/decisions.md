# DECISIONS.md

Running log of decisions, deviations from docs/plan.md, and resolved open questions.
Newest at the bottom. Format: date · decision · why.

## 2026-07-11 — Bootstrap

- **Anchor 0.32.1, not 1.0.** `magicblock-engine-examples` now targets Anchor 1.0 with legacy
  0.32.1 implementations kept in `00-LEGACY_EXAMPLES/`. The installed CLI is 0.32.1 and it matches
  prior project experience; upgrading toolchains mid-hackathon is unjustifiable risk. All example
  patterns are copied from `00-LEGACY_EXAMPLES/` (anchor-counter, rock-paper-scissor,
  session-keys, crank-counter).
- **Crate pins from the legacy counter example:** `anchor-lang 0.32.1` (`init-if-needed`),
  `ephemeral-rollups-sdk 0.14.4` (`anchor-compat`). Session-keys program crate: `gpl_session 3.1.0`.
- **Local Android builds over EAS cloud.** Android Studio SDK + emulator (`Medium_Phone_API_36.1`)
  and JDK 17 (temurin) already exist on this machine; `npx expo run:android` avoids the EAS queue
  and account setup entirely. `eas.json` from the template is kept for emergencies.
- **Node 22 via nvm** (`.nvmrc`). System Node is 26; the ts-mocha CLI is broken on Node ≥ 23, so
  tests run through the programmatic mocha runner `scripts/run-tests.js`.
- **Official Solana Mobile Expo template** (`@solana-mobile/solana-mobile-expo-template`) as the
  `app/` base instead of hand-assembling deps/polyfills — it ships MWA + web3.js + polyfills
  pre-configured.
- **`close_channel` force-claims all unclaimed positions before undelegating** (deviation from
  docs/plan.md §5.2, which relied on clients auto-firing `claim_round`). A phone asleep at resolution
  would otherwise strand winnings in round pools at settlement. ER transactions are free, so the
  host/crank looping permissionless claims costs nothing. Base-layer claim remains a backstop.
- **Conservation invariant restated** (docs/plan.md §5.3 was imprecise between resolve and claim):
  `deposits == Σ Member.balance + Σ unresolved pools + Σ resolved-but-unclaimed pools`.
- **Leaning lazy Position creation on the ER** instead of pre-allocating 20×40=800 Position
  accounts (≈2 devnet SOL rent + multi-transaction delegation batches in `go_live`). Final call in
  Phase 2 after reading the Ephemeral Accounts doc; pre-create only Rounds + Members (~60 accounts).

## 2026-07-11 — Phase 1 (program skeleton)

- **`withdraw` is allowed while the channel is `Open`, not only `Closed`** (deviation from
  docs/plan.md §5.2/§5.3). Before `go_live` nothing is delegated and `balance == deposited`, so
  letting a user back out is safe and it gives Phase 1 its deposit→withdraw round-trip test.
  Withdrawals remain impossible while Live/Settling (`WithdrawLocked`).
- **Session key registered as a plain `Pubkey` arg on `join_channel`** and stored on `Member`.
  Whether to adopt the `gpl_session` program's token/validation macros instead is a Phase 4
  (client) decision; the stored-key check is sufficient for the ER-side `stake`/`claim` gate.
- **`#[ephemeral]` is already on the program module** (costless now, required for Phase 2), so
  delegation work only adds instructions, not program-shell changes.
- `Member.deposited` is lifetime history and survives withdraw; only `balance` is zeroed.
- `Channel.total_pool` = sum of deposits currently in the vault; conservation test asserts
  `vault.amount == total_pool == Σ member balances` (extends to round pools in Phase 3).

## Open questions (resolve in Phase 2)

- Magic Router single connection vs dual base+ER connections (docs/plan.md §3/§7.4).
- ER clock semantics for `locks_at`/`resolves_by` — verify against docs, add tolerance.
- Official Session Keys SDK React hooks in React Native vs burner-keypair fallback (docs/plan.md §7.3).
- Which MWA wallet app on the demo devices (Phantom / Solflare / fakewallet).
