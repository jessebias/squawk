// Seeds the demo: creates a channel, funds demo wallets with BOTH devnet SOL and
// mock USDC (faucet is rate-limited — run early), and can drive host actions
// (open/resolve rounds) from the laptop during the live demo. docs/plan.md §9 Phase 5.
async function main(): Promise<void> {
  throw new Error("TODO(Phase 3): implement channel seeding + wallet funding + host driver");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
