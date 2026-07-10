// Creates the mock USDC mint on devnet (6 decimals) and prints its address.
// Phase 1 wires this into initialize_config; docs/plan.md §0 — all money is mock SPL.
async function main(): Promise<void> {
  throw new Error("TODO(Phase 1): create mint with @solana/spl-token and print address");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
