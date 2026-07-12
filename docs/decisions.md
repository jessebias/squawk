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

## 2026-07-12 — Privy social login + MWA connect

- **Wallet precedence: privy → mwa → local burner**, implemented in
  `app/src/providers/WalletProvider.tsx`; `useWallet` keeps its old surface so no screen changed.
  The SESSION key stays the local burner in every mode — ER staking untouched.
- **Privy Expo SDK (@privy-io/expo 0.70) is headless on mobile** — the daremarket-style modal is
  custom (`components/LoginModal.tsx`) using `useLoginWithEmail` (OTP state machine) +
  `useLoginWithOAuth`. **Login methods: email + X (twitter) + Telegram** (user's choice). Telegram
  is a valid `OAuthProviderID` in Privy, so it works through the same `useLoginWithOAuth` hook as
  X — no separate flow needed (verified live: modal renders all three against real credentials).
  Embedded Solana wallets are NOT auto-created —
  `WalletProvider` calls `solana.create()` on first login. Signing:
  `wallets[0].getProvider().request({ method: "signAndSendTransaction", params: { transaction,
  connection } })`.
- **Credentials via env**: `EXPO_PUBLIC_PRIVY_APP_ID/_CLIENT_ID` in `app/.env` (gitignored).
  Empty env ⇒ `privyEnabled=false` ⇒ PrivyProvider skipped entirely; burner+MWA still work
  (verified). Dashboard needs a mobile app client: package `com.squawk.app`,
  URL scheme `squawk` (added to app.json).
- **Package renamed `com.solana.mobile.expo.template` → `com.squawk.app`** (display name → Squawk)
  via `app.json` + `expo prebuild --clean`. Done BEFORE Privy dashboard config so the client is
  registered against the real package. New package = fresh secure-store ⇒ new burner wallet
  (old install orphaned). Old package uninstalled from the emulator.
- **Integration gotchas (each cost a debug cycle)**:
  1. **Polyfill order**: `react-native-get-random-values` MUST come before
     `@ethersproject/shims`, else the shim injects a broken `getRandomValues` and
     `Keypair.generate()` dies with "seed expected Uint8Array of length 32".
  2. Do NOT set `unstable_enablePackageExports` globally in metro — it reroutes web3.js's
     crypto deps to incompatible builds. Privy resolves fine without it…
  3. …but Metro's resolver cache must be FRESH after installing the Privy deps: restart with
     `expo start --clear` or you get phantom "Unable to resolve ./client/Privy.js" errors.
  4. `viem` and `react-native-get-random-values` are undeclared-but-required peers.
- MWA: existing template utils reused; `signAndSendTransaction` needs `minContextSlot` (from
  `baseConn.getSlot()`); connect errors surface a friendly "is a wallet installed?" alert.
- **VERIFIED end-to-end on real credentials (email login):** Profile shows PRIVY chip + email +
  the auto-created embedded Solana wallet as the active `publicKey`; funded it via
  `fund-wallet.ts`; joined a live channel (10 USDC deposit + session funding signed by the PRIVY
  wallet — real base-layer gas spend), staked across 8 rounds via the session key, settled back
  (balance 100 → 98.58). Package `com.squawk.app`; login methods email + X + Telegram all render.

## 2026-07-12 — Persistent demo channels + Discover feature feed

- **Channel visibility is now the on-chain `ends_at`** (open|live AND not expired) — replaces the
  client-side "channel_id older than 2h" heuristic that made seeded channels vanish mid-demo.
  `seed-demo.ts` seeds 7 channels across categories with staggered 18h–7d lifetimes (optional
  argv hours override), so Discover stays populated for the whole hackathon and the channels
  remain genuinely joinable.
- **Feature feed under the category tiles** (ALOT reference): `FeatureCard` = big cover, tag
  chips, countdown chip ("2 days"/"17h" from real ends_at), green pool. Discover is one FlatList
  (header = search/carousel/tiles). **Category tiles now actually filter the feed** via
  `demoContent.ts` — a client-side keyword map from seeded titles → curated Unsplash cover +
  tags + category (real channel state, decorated presentation; unknown titles fall back to the
  emoji cover). Emoji always renders under the remote image as a loading/failure placeholder.
  Gotcha: keep keyword regexes word-bounded — `/ath/` matched "hack**ath**on" and put a Bitcoin
  cover on the Hackathon finals card.
- Shared `emojiOf/plainTitle/avatarOf/countdownLabel` consolidated into `demoContent.ts`
  (were duplicated across Discover/Profile/Leaderboard).
- **Retired demo titles hidden client-side** (`RETIRED_TITLES` in `fetchChannels`): removing a
  seeded channel from Discover can only be done by title filter — the program has no
  cancel/delete instruction and `extend_channel` only moves `ends_at` forward, so already-seeded
  channels persist on-chain until they expire. Also removed from `seed-demo.ts` (kept Madrid vs
  Inter + Lakers vs Celtics).

## 2026-07-12 — In-app channel creation + phone hosting (the "+" tab)

- **The channel host is a second local burner** (`lib/hostKey.ts`, secure-store key
  `squawk_host_key_v1`) — NOT the active wallet and NOT the session key. Rationale: host
  instructions (`open_round`/`resolve_round`/`close_channel`) run on the ER and `has_one = host`
  requires the host's signature there; Privy exposes only `signAndSendTransaction` (base RPC)
  and MWA submits via the wallet app's own RPC, so neither can sign ER transactions without a
  popup per action. With a local host key, every host tx — base and ER — signs via `sendLocal`.
  The session key was deliberately NOT reused: "session keys may only call stake/claim_round"
  is a CLAUDE.md invariant. The active wallet's only involvement is one SOL transfer funding
  the host key (`ensureHostFunded`, same shape as the session funding in `buildJoinTx`).
- **Caveat:** hosting is device-bound — reinstalling the app orphans a live hosted channel (it
  can never be resolved/closed; it drops off Discover at `ends_at`). Devnet-acceptable.
- New: `lib/host.ts` (transliteration of `scripts/host-demo.ts`: create+rounds, go_live+
  delegation with 250ms pacing, open_round + best-effort `schedule_lock_crank`, resolve + claim
  sweep, close + `commit_rounds` over **all** rounds in batches of 5 so nothing stays
  delegated), `screens/CreateChannelScreen.tsx` (the "+" tab: title with **byte** counter — the
  program checks bytes, emoji are 4+ — duration/rounds pills, rent estimate vs gas balance,
  resumable retry reusing the same `channelId` since `create_round` is strictly sequential),
  `components/HostPanel.tsx` (GO LIVE → question composer → YES/NO resolve → end & settle,
  gated on `channel.host == hostKey.publicKey` in ChannelScreen; host ER txs feed the footer
  counter). No manual `lock_round` in-app: the crank locks, and `resolve_round` accepts
  staking-past-`locks_at` as the backstop.
- Skipped `GetCommitmentSignature` on the phone (untested in Hermes); the base status poll
  already proves settlement.
- Every host send retries transient RPC failures (429/blockhash/timeout) with backoff and a
  fresh blockhash, treating "already been processed" as success — a single 429 in the go-live
  delegate burst (public magicblock RPC rate-limits) no longer aborts the whole flow. Host-panel
  and create-screen errors render via `describeError()` (Error → RPC object → JSON) instead of
  `String(e)`, which was surfacing non-Error throws as "[object Object]".
- Rent estimate: `0.01 + rounds × 0.004` SOL (10 rounds ≈ 0.05 SOL). Host key fundable
  manually via `scripts/fund-wallet.ts <hostKey> 0.1 0` if the in-app transfer misbehaves;
  laptop `host-demo.ts` remains the demo fallback (untouched).

## 2026-07-12 — Private channels: blind betting on the TEE Private ER (accepted on devnet)

- **Private channels (Channel.visibility=1) run on MagicBlock's Private ER** — delegated to the
  TEE validator (`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, `devnet-tee.magicblock.app`) via
  the new `validator: Option<Pubkey>` arg on all three delegate instructions. Public channels
  pass `null` and are byte-for-byte unchanged (phase3-simulate re-accepted post-redeploy:
  94 ER txs, exact conservation).
- **Read gates are ephemeral permissions created ON the ER** (`CreateEphemeralPermissionCpi`,
  sdk feature `access-control`) by three new host-only instructions:
  `create_channel_permission` (host + every member's wallet + session key, members from
  remaining_accounts), `create_member_permission` (host + that member only),
  `create_round_permission` (**host only — this is the blind bet**). Client-side permission
  creation is impossible: the permissioned PDA must sign, so only program CPI works.
- **The permissioned PDA pays its own ephemeral rent** (quickstart pattern), pre-funded with
  0.0005 SOL per PDA on base before delegation — the host key isn't ER-writable so it can't
  pay. (Deviation from the plan's host-pays idea.)
- **TEE permissions gate READS, not tx submission** (proven, not assumed): members stake into a
  Round they cannot fetch. `scripts/phase-per-lifecycle.ts` is the acceptance proof — P1 anon
  reads blocked, P2 member matrix (channel ✓ / own member ✓ / other member ✗ / round ✗),
  P3 blind stake lands, P4 **crank fires on the TEE**, P5 mirror reveal, P6 settlement +
  withdraw (commitment `4x2Kt2…GEz3`, 13 TEE txs).
- **Blind-round UX rides a "board mirror" on Channel** (`active_question/locks_at/round_status`,
  `reveal_yes/no`, `last_outcome`, +155 bytes): open/lock/resolve write it unconditionally, so
  private players follow the round (and see the resolve-time reveal) without Round access.
  Consequence: `channel` became `mut` in LockRound/ResolveRound/ScheduleLockCrank and both
  crank `AccountMeta`s went writable — a crank-fired lock writes the mirror too.
- **Reads/writes on private channels use per-identity token-authed connections**
  (`getTeeConnection` in app/src/lib/connections.ts): SDK `getAuthToken` challenge signed by a
  LOCAL keypair — session key for players, host key for hosts (Privy/MWA can't sign popup-free).
  Tokens cached until expiry; URL form `devnet-tee.magicblock.app?token=…`.
- **Unlisted + invite-only**: Discover filters `visibility !== 0`; joining goes through a paste
  code (channel pubkey) modal on Discover or the `squawk://channel/<pk>` deep link
  (`linking` config in AppNavigator), landing on a new JOIN button in ChannelScreen (base-layer
  snapshot of a private channel stays publicly readable, so the join screen works pre-live).
- **Channel layout changed → dataSize filters everywhere `channel.all()` is called**
  (fetchChannels, seed-demo) — pre-visibility channels overrun the decoder exactly like the
  old Member gotcha; demo channels reseeded. On-chain IDL had to be closed + re-inited
  (6016 → 6025 bytes; `anchor idl upgrade` can't grow the account).

## 2026-07-12 — Phase 5 polish (non-demo)

- **Haptics vocabulary in `lib/haptics.ts`** (success/error/warning/tap, all fire-and-forget):
  join success/fail (Discover + ChannelScreen JOIN), collect all (Profile), host actions
  (HostPanel run()), and a differentiated resolve outcome at the auto-claim trigger
  (win=Success / loss=Error / void=Warning). PTTButton's accumulator ticks untouched.
- **SettlementCard is the closing shot** (plan §6): replaces the "channel settled" text with
  "N ER transactions · 1 settlement · $0.00 fees" + an explorer link from
  `getSignaturesForAddress(channel, limit 1)` (Hermes-safe; GetCommitmentSignature stays
  laptop-only).
- **Edge states**: OddsCards explicit "no stakes yet" zero-pool state + `hidden` blind mode
  ("?" + "hidden until the call"); pulse `Skeleton` on Discover/Channel first load; HostPanel
  errors render in-panel (describeError) instead of Alert.alert — the End-channel confirm
  alert stays.

## 2026-07-12 — Channel screen restyled as a walkie-talkie handset

- **Full device chrome in the Squawk palette** (near-black body `#0E0E12`, bezel `#2E2E38`, no
  yellow plastic): `HandsetFrame` (antenna nub + vent strip + live/private LED) wraps the whole
  live view; `FrequencyDisplay` (inset black LCD, **Orbitron** digits via
  `@expo-google-fonts/orbitron` — Metro-bundled, no native rebuild) **replaces RoundCard**:
  CH #### / RND n/m / signal bars, a pseudo-frequency line derived from the channel id
  (`400 + id % 100000 / 1000` MHz), a giant glowing countdown with an `8:88` ghost-segment
  layer, the question, and the drain bar. `SpeakerGrille` = dot columns with an animated
  brightness wave (slow shimmer while staking, fast **orange ripple while transmitting**).
- **The device reacts to real state only** (no fake controls): `PTTButton` gained
  `onHoldChange` so holding drives the grille ripple, the LCD `TX ●` tag + glow border, and
  the "● N connected · TRANSMITTING / no transmission" readout. PTT restyled as a bezeled
  hardware button ("PUSH TO TALK"); OddsCards became raised device buttons with a lit LED on
  the selected side; status/pool/conn lines use the Orbitron LCD voice. All data wiring
  (blind mode, TEE conns, auto-claim, HostPanel, SettlementCard, JOIN) untouched.
- **Gotcha:** RN `interpolate` requires a monotonic inputRange — the grille's
  `[r-1.5, r, r+1.5, ROWS]` crashed on the last row (`r+1.5 > ROWS`); the trailing `ROWS` stop
  is redundant with `extrapolate:"clamp"`.
- Discover's join alert now uses `describeError` (was `String(e)` → "[object Object]").
- E2E on emulator + devnet: joined via deep link + the in-channel JOIN button, live round
  countdown ticked, PTT hold showed TX state, release staked 1.77 (1 ER tx) and moved the
  odds against the bot.

## 2026-07-12 — Hold-to-stake PTT + walkie flavor app-wide

- **PTT relabeled to the game's actual verb**: idle face is mic + "HOLD TO STAKE"; while held
  the face swaps to a **large Orbitron amount growing live under the thumb** ("1.14" + USDC
  tag) — the accumulator was already there, now it's the hero. Mechanics untouched.
- **LCD voice extended to shared chrome, real data only**: Discover's marquee is a
  radio-scanner strip (LCD black, Orbitron orange, fixed "● SCAN" status cap over the left
  edge); the AppHeader balance pill is an LCD readout (kept the green $ and gradient + chips);
  copy retuned — "Scan frequencies", "no signal — tap + to open a frequency",
  CreateChannel = "Open a frequency". Deliberately skipped: tab bar (already reads as the
  hardware row), Leaderboard signal bars / Profile callsigns (kitsch risk).
- E2E on emulator + devnet: funded the drained burner (fund-wallet.ts), joined via deep link
  + JOIN button, held → face showed 1.14 USDC growing + TX state, released → staked 1.89
  (1 ER tx, ticker "+1.89 on YES"). Header pill honestly showed 0.00 when the wallet was
  actually broke — the "transient" reading was real data.

## 2026-07-12 — AppHeader antenna experiment reverted

- Tried styling the header's right side as the radio's top corner (antenna + signal arcs +
  LED on the balance pill, bell in a knob). Two iterations still read cluttered at header
  scale — reverted to the plain LCD pill + bell. The walkie motif stays where it has room:
  the Channel handset and the scanner ticker. (Kept for reuse: per-side border colors +
  borderRadius silently don't render on Android — use `react-native-svg` for arcs.)

## 2026-07-12 — Wallet connect folded into the login modal

- **One auth entry point**: the LoginModal now carries a "Connect Wallet" row (MWA, via a new
  `onConnectWallet` prop — the modal itself stays Privy-hook-only) under email/X/Telegram, and
  Profile's separate connect button is gone. Errors surface in-modal. When Privy is disabled
  (`privyEnabled=false`, modal can't mount without the provider) a standalone Connect Wallet
  button remains as the fallback. All "Seeker" labels renamed to "Wallet" (mode chip
  SEEKER → WALLET; it's MWA, not Seeker-specific).

## Open questions (Phase 5)

- MWA connect flow on a physical device (Solflare/Phantom) as the flagship join path for the
  demo video; emulator stays on the local wallet.
- Second physical device for the two-phones demo shot.
- In-app private-channel E2E on the emulator (protocol proven by phase-per-lifecycle.ts; the
  RN runtime path — token fetch under Hermes, blind UI states — still needs a device pass).
