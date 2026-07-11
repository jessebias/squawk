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

## 2026-07-11 — Phase 2 (delegation lifecycle, accepted on devnet)

- **Dual connections, not the Magic Router** (resolves docs/plan.md §3/§7.4). The MagicBlock
  skill's best-practices list explicitly recommends dual connections; the router is used only for
  `getDelegationStatus`. Endpoints: base `https://api.devnet.solana.com`, ER
  `https://devnet-as.magicblock.app/`, router `https://devnet-router.magicblock.app/`.
- **Lazy Position creation on the ER is confirmed viable** (resolves the §4.2/§5.2 pre-allocation
  question). The Ephemeral Accounts doc: `#[ephemeral_accounts]` + generated
  `init_if_needed_ephemeral_*` supports lazy creation during ER transactions at 32 lamports/byte
  (~109× cheaper than base rent). Constraints: `AccountInfo` fields, one pre-delegated sponsor
  account with lamports, manual serialization. Positions will be ER-native in Phase 3; whether
  Rounds are pre-created+delegated or also ER-native is a Phase 3 decision.
- **`Settling` status is unused.** `close_channel` runs on the ER, sets `Closed`, and bundles
  commit+undelegate; the base layer only ever observes `Closed` after the commit lands, so the
  withdraw gate is inherently safe without an intermediate state.
- **Delegation is split into per-account instructions** (`delegate_channel`, `delegate_member`)
  composed by the client after `go_live`, each host-only + Live-only (validated by manual
  deserialization since delegate contexts use `AccountInfo`).
- **`extend_channel` added** (host extends `ends_at`): real utility, and it doubles as the
  lifecycle proof op — after delegation it fails on base (`AccountOwnedByWrongProgram`) and
  succeeds on the ER.
- **Devnet deployment record:** program `4NT1YGUK1YWboAq9pyKLqGsHUQaRwDAi7kpATd6Ynuii`, mock USDC
  mint `BxSQ6kJ3tSwP8vkYberm2oyozxyy4RgfCfidDKdnTQPp` (held in the on-chain config), IDL account
  `6Y57FeacYsDDsCqtphxVQPDvrnhUiuYCoYfnwGe5D262`. Proof run: 2 ER txs, 1 settlement commitment
  (`3rDKLQ…m8wG`), verified via `scripts/phase2-lifecycle.ts`.

## 2026-07-11 — Phase 3 (round engine, accepted on devnet)

- **Position embedded in Member, no standalone Position PDAs** (deviation from docs/plan.md
  §5.1). Rounds are sequential, so one open position per member suffices:
  `Member.position {round_index, side, amount}`; `amount == 0` = none. Staking a new round
  requires claiming the old one (clients auto-claim; `PositionPending` guards). Eliminates all
  account creation on the ER — neither pre-allocation (800 PDAs) nor `#[ephemeral_accounts]`
  integration was needed.
- **Rounds are pre-created (base, while Open) + delegated after go_live** — they must exist on
  base for settlement anyway; ~10–40 small PDAs is cheap. `create_round` is sequential
  (`RoundOutOfOrder`).
- **`lock_round` and `claim_round` are signerless + permissionless** so the MagicBlock crank can
  fire them and any client can fall back. Claims can only ever credit the position's own member.
- **The crank works**: `schedule_lock_crank` (one-shot ScheduleTask CPI to the Magic program) —
  in the 10-round devnet simulation **all 10 locks fired by crank**, 0 manual fallbacks. API
  drift note: `ScheduleTaskArgs.task_id`/`execution_interval_millis` are `i64`, not the `u64`
  shown in the skill doc.
- **Payout math uses resolve-time snapshots** (`snap_yes/snap_no`) so claim order can't change
  shares; pools decrement on claim; division dust stays in the round pools and is counted by the
  conservation invariant (`vault == total_pool == Σ balances + Σ pools`). Simulation settled with
  zero dust and exact conservation.
- **`resolve_round` accepts Staking-past-locks_at** so a missed crank can't wedge a round; a
  round whose winning side is empty becomes `Voided` and claims refund.
- **`commit_rounds`** (permissionless, `#[commit]`) releases round PDAs in batches after
  `close_channel` keeps the settlement bundle small (channel + members).
- **Base RPC for scripts: `https://rpc.magicblock.app/devnet`** — `api.devnet.solana.com`
  rate-limits (429) the round-creation burst; scripts also pace base-layer txs ~250ms.
- **ER clock behaved**: 6-second `locks_at` windows locked on time by the crank; no extra
  tolerance needed at demo timescales.
- Devnet simulation record: 3 bots × 15 USDC, 10 rounds, 93 ER txs, 1 settlement commitment
  (`g2PeGc…W5XE`), withdrawals 16.1/7.7/21.2 USDC.

## 2026-07-11 — Phase 4 (mobile app, accepted on emulator + devnet ER)

- **Session keys: burner keypair in expo-secure-store**, registered as `Member.session_key` at
  join (resolves the §7.3 question). The program's own signer check (`user || session_key`) made
  the external `gpl_session` program unnecessary; the official SDK's React hooks were never
  needed. Every ER interaction (stake/claim) is signed popup-free by this key; join funds it
  with 0.005 SOL as a fee envelope (ER fees are $0 but the fee payer account must exist).
- **Local burner wallet is the app's default identity** (secure-store; join/withdraw signed
  locally). The template's MWA plumbing (`useMobileWallet`/`useAuthorization`) is retained for
  wiring a real wallet app on demo devices as Phase 5 polish — the §11 "burner-wallet-only
  fallback" is thus the default rather than the fallback. `scripts/fund-wallet.ts <address>`
  funds the wallet shown on the Profile screen.
- **Live updates: 1–3s polling is the workhorse, ER websocket is a bonus.** RN's ER websocket
  delivery proved unreliable (no events on account clone at delegation; often none at all), so:
  channel 3s poll (ER→base fallback), active round 1s poll, member 2s poll — each plus a ws sub
  for sub-second odds when it works.
- **RN/Hermes gotchas fixed in `app/src/polyfills.ts` + `lib/program.ts`** (all three cost real
  debugging time — do not regress):
  1. `Buffer.prototype.subarray` loses Buffer methods under Hermes → re-attach prototype
     (breaks anchor account decoding with `readUIntLE is not a function` otherwise);
  2. Hermes lacks `structuredClone` → JSON round-trip polyfill (anchor clones the IDL);
  3. anchor's `Wallet` class is Node-only (undefined in RN) → stub the wallet interface for the
     read-only provider.
- **App RPC: `rpc.magicblock.app/devnet`** — the public devnet RPC blocks `getProgramAccounts`
  (Discover's channel list) and rate-limits.
- **`scripts/host-demo.ts`** drives live demos: create → pre-create rounds → bot joins → wait
  for phones (`--auto=<s>` or ENTER) → go_live + delegate all → rounds on a 15s cadence with
  crank locks + bot stakes → Ctrl+C settles (claim sweep, close, commit_rounds).
- **Crank race is benign but real**: a manual `lock_round` fallback can lose the race to the
  crank and hit `RoundNotStaking` — host scripts treat that error as "crank won".
- E2E proof on emulator: join 10 USDC → PTT hold staked 1.05 via session key (1 ER tx, $0.00)
  → bot's stake moved the pool live in-app → auto-claim on resolve → channel settled →
  Profile COLLECT returned the USDC on base layer.

## 2026-07-11 — Phase 5 (UI overhaul to the approved mockup)

- **App restyled to the two-screen mockup** (`squawk_clean_ui_two_screens.html`, faithful to
  docs/plan.md §8): hairline borders, balance pill + bell header, search, trending pair cards
  with blinking LIVE dot, category chips, five-tab bottom nav with the raised orange mic,
  in-screen Channel header (back + CH id + LIVE·count), "Round N of M" + draining progress
  bar, compact odds cards, feed row, mic-icon PTT that scales with the held amount. Icons via
  Feather (@expo/vector-icons, bundled with Expo).
- **Discover hides stale channels**: host scripts use `Date.now()` as channel_id and sessions
  run ≤2h, so channels older than 2h (dead runs) are filtered client-side — crashed-run debris
  was stealing joins on Discover.
- Categories/chips and the bell are cosmetic for the hackathon; search filters by title.
- **Premium pass (ALOT-style reference)**: near-black canvas (`#060608`) with higher-contrast
  cards + `cardElevated` tier; orange→amber gradient (`#FF6B2C→#FFB03A`) on all primary CTAs
  (PTT, tab-bar mic, balance "+" chip, COLLECT, active category tile) via `expo-linear-gradient`
  (native module — required a rebuild); icon-tile category tabs; emoji cover/avatar tiles derived
  from channel titles; timer pill + thicker progress bar; Profile rebuilt as Balance card
  (Available / In channels) + Fund/Session/Address action tiles + gradient COLLECT per channel.
  PTT glow uses colored elevation shadows (Android API 28+). Active bottom-nav tabs render the
  icon+label through a gradient mask (`@react-native-masked-view/masked-view`, native module).
  Trending is a snap-scrolling horizontal carousel (up to 6 channels, 148px cards, green pool
  amounts) inside an elevated panel with a gradient glow line along its bottom edge.
  `scripts/seed-demo.ts` is now real: seeds N open display channels with funded bot joins so
  Discover/the carousel look alive for demos.
- **Profile is the ALOT layout**: shared `AppHeader` (dual `available / total` balance pill) on
  all tabs; Analytics card with a green area sparkline (`react-native-svg`, native module —
  decorative curve, real winnings number); Balance + Gas card pair with corner token badges;
  "available winnings" strip whose gradient **Collect** withdraws ALL settled channels
  sequentially; Recent activity rows derived from memberships (collectible/in-play/settled).
- **Running on the Seeker** (Solana Mobile device) over USB Metro (`adb reverse`); each device
  generates its own local wallet + session key — fund via `scripts/fund-wallet.ts <address>`.
- **Leaderboard tab replaces the Activity placeholder** ("Top Squawkers"): ranks all wallets by
  lifetime staking volume — points = Σ `Member.deposited` × 1000 across memberships (`deposited`
  survives withdraw, so points never regress); deterministic emoji avatars from the pubkey;
  caller's row highlighted; search filters by address. **Gotcha: `member.all()` must carry a
  `dataSize` filter** — Member accounts created by pre-Phase-3 deploys have the old (smaller,
  no-`position`) layout and overrun the decoder ("Trying to access beyond buffer length").

## Open questions (Phase 5)

- MWA connect flow on a physical device (Solflare/Phantom) as the flagship join path for the
  demo video; emulator stays on the local wallet.
- Second physical device for the two-phones demo shot.
