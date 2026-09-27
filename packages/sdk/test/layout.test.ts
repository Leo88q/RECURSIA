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
    expect(ix.tick(k, k, k).keys).toHaveLength(14);
    expect(ix.quantumCommit(k, k, 1, new Uint8Array(32).fill(1)).keys).toHaveLength(14);
    expect(ix.quantumObserve(k, k, 1).keys).toHaveLength(10);
    expect(ix.quantumCollapse(k, k, 1, 1n, 2n, 5000, new Uint8Array(32)).keys).toHaveLength(11);
    expect(ix.quantumDecohere(k, k, 1, k).keys).toHaveLength(10);
    expect(ix.plant(k, k, 1, 1n).keys).toHaveLength(9);
    expect(ix.fundRewardPool(k, 1n).keys).toHaveLength(6);
    expect(ix.acquire(k, k, 1, null, 1n, 1n, 1n).keys).toHaveLength(12);
    // the game currency is the official SKR mint, read-only (nothing is minted or burned)
    const mintMeta = ix.plant(k, k, 1, 1n).keys[2];
    expect(mintMeta.pubkey.toBase58()).toBe("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
    expect(mintMeta.isWritable).toBe(false);
    // player spends route to the studio treasury + player reward pool PDAs
    const pl = ix.plant(k, k, 1, 1n).keys;
    expect(pl[6].pubkey.equals(ix.pda.treasury())).toBe(true);
    expect(pl[7].pubkey.equals(ix.pda.rewardPool())).toBe(true);
    // devnet / localnet: a test mint can be injected
    expect(new RecursiaIx(undefined, k).plant(k, k, 1, 1n).keys[2].pubkey.equals(k)).toBe(true);
    // None optional account encoded as program id
    expect(ix.tick(k, k, k).keys[9].pubkey.equals(ix.programId)).toBe(true);
  });
  it("pdas are deterministic", () => {
    const p = new Pdas();
    expect(p.rootWorld(0).equals(p.rootWorld(0n))).toBe(true);
    // child worlds use a 1-byte territory index → never collide with root worlds (8-byte index)
    expect(p.childWorld(PublicKey.default, 3).equals(p.rootWorld(3))).toBe(false);
  });
});
