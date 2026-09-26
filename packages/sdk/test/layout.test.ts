import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ixDiscriminator, accountDiscriminator, encodeName, decodeName, RecursiaIx, Pdas, DEFAULT_PARAMS } from "../src/index.js";

describe("layout & instructions", () => {
  it("discriminators are anchor-compatible", () => {
    // sha256("global:initialize")[0..8] = afaf6d1f0d989bed (well-known Anchor value)
    expect(Buffer.from(ixDiscriminator("initialize")).toString("hex")).toBe("afaf6d1f0d989bed");
    expect(accountDiscriminator("World")).toHaveLength(8);
  });
  it("names strip invisible unicode", () => {
    expect(decodeName(encodeName("Ge\u200bne\u202esis"))).toBe("Genesis");
    expect(() => encodeName("\u200b")).toThrow();
  });
  it("builds instructions with expected account counts", () => {
    const ix = new RecursiaIx();
    const k = Keypair.generate().publicKey;
    expect(ix.initialize(k, k, DEFAULT_PARAMS).keys).toHaveLength(11);
    expect(ix.tick(k, k, k).keys).toHaveLength(12);
    expect(ix.acquire(k, k, 1, null, 1n, 1n, 1n).keys).toHaveLength(12);
    // None optional account encoded as program id
    expect(ix.tick(k, k, k).keys[9].pubkey.equals(ix.programId)).toBe(true);
  });
  it("pdas are deterministic", () => {
    const p = new Pdas();
    expect(p.rootWorld(0).equals(p.rootWorld(0n))).toBe(true);
    expect(p.childWorld(PublicKey.default, 3).equals(p.rootWorld(3))).toBe(true); // same seed scheme by design
  });
});
