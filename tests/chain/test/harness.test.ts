/** Self-test of the harness (no program needed): the real SPL Token program accepts our mint / token accounts. */
import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ata } from "@recursia/sdk";
import { Chain, TOKEN_PROGRAM } from "./harness.js";

/** SPL Token TransferChecked (tag 12): source, mint, destination, owner. */
function transferChecked(src: PublicKey, mint: PublicKey, dst: PublicKey, owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amount, 1); data[9] = 6;
  return new TransactionInstruction({ programId: TOKEN_PROGRAM, data, keys: [
    { pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false },
  ] });
}

describe("LiteSVM harness", () => {
  it("SPL Token accepts the synthetic mint and token accounts; supply tracking is exact", () => {
    const c = new Chain({ program: false });
    const a = c.wallet(1_000n), b = c.wallet(5n);
    expect(c.supply).toBe(1_005n);
    c.send([transferChecked(ata(a.publicKey, c.mint), c.mint, ata(b.publicKey, c.mint), a.publicKey, 400n)], [a]);
    expect(c.skr(a.publicKey)).toBe(600n);
    expect(c.skr(b.publicKey)).toBe(405n);
    // wrong owner is rejected by the token program
    expect(() => c.send([transferChecked(ata(a.publicKey, c.mint), c.mint, ata(b.publicKey, c.mint), b.publicKey, 1n)], [b])).toThrow();
  });

  it("clock warps move slot and time", () => {
    const c = new Chain({ program: false });
    const s0 = c.slot, t0 = c.svm.getClock().unixTimestamp;
    c.warp(1_000n, 172_810n);
    expect(c.slot - s0).toBe(1_000n);
    expect(c.svm.getClock().unixTimestamp - t0).toBe(172_810n);
  });
});
