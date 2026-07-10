SQUAWK 🎙️

**Walkie-talkie prediction markets. Ephemeral moments, permanent money.**

Squawk is a mobile app for betting on the next 60 seconds. Join a live channel tied to a moment — a football match, a stream, a hackathon demo — and rapid-fire micro-questions drop every couple of minutes ("Shot on goal in the next 2 minutes?"). Hold the push-to-talk button to stake: the longer you hold, the bigger your stake; release to lock it in on YES or NO. Odds move live as everyone on the channel piles in.

Under the hood, every hold is a real Solana transaction. When a channel goes live, its state is delegated to a [MagicBlock Ephemeral Rollup](https://docs.magicblock.gg), where thousands of stakes, odds updates, and round resolutions execute in ~10ms with zero fees. When the channel closes, everything settles back to Solana in a single commitment — the channel was ephemeral, the winnings are real.

Built for [Solana Blitz V6](https://hackathon.magicblock.app/) (mobile theme) with Expo / React Native, Solana Mobile Wallet Adapter, Anchor, and MagicBlock Ephemeral Rollups.

> ⚠️ Hackathon build — runs on devnet with mock tokens.
