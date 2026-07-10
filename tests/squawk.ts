import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Squawk } from "../target/types/squawk";

describe("squawk", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Squawk as Program<Squawk>;

  it("pings the deployed program", async () => {
    const sig = await program.methods.ping().rpc();
    expect(sig).to.be.a("string");
  });
});
