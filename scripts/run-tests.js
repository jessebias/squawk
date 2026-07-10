#!/usr/bin/env node
// Programmatic mocha runner — the ts-mocha CLI crashes on Node >= 23.
// `anchor test` invokes this via [scripts] test in Anchor.toml with
// ANCHOR_PROVIDER_URL / ANCHOR_WALLET already set and a local validator running.
const path = require("path");

require("ts-node/register");

const Mocha = require("mocha");
const mocha = new Mocha({ timeout: 120_000 });
mocha.addFile(path.join(__dirname, "..", "tests", "squawk.ts"));
mocha.run((failures) => process.exit(failures ? 1 : 0));
