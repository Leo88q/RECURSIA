import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANCHOR_ERROR_OFFSET, PROGRAM_ERRORS, explainTxError, programErrorByCode } from "../src/errors.js";

const rust = readFileSync(fileURLToPath(new URL("../../../programs/recursia/src/errors.rs", import.meta.url)), "utf8");
const rustNames = [...rust.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*),\s*$/gm)].map((m) => m[1]);

describe("program error table", () => {
  it("matches enum RecursiaError 1:1 and in order (codes 6000+i)", () => {
    expect(rustNames.length).toBeGreaterThan(40);
    expect(PROGRAM_ERRORS.map(([n]) => n)).toEqual(rustNames);
  });

  it("every message is non-empty Russian text", () => {
    for (const [, ru] of PROGRAM_ERRORS) expect(ru).toMatch(/[а-яё]/i);
  });

  it("decodes Anchor logs, custom codes, wallet and RPC failures", () => {
    const nh = ANCHOR_ERROR_OFFSET + rustNames.indexOf("NotHolder");
    expect(explainTxError(null, [`Program log: AnchorError occurred. Error Code: NotHolder. Error Number: ${nh}. Error Message: x.`])).toMatch(/не принадлежит/);
    expect(explainTxError({ InstructionError: [1, { Custom: ANCHOR_ERROR_OFFSET + rustNames.indexOf("PriceSlippage") }] })).toMatch(/фронтраннинга/);
    expect(explainTxError({ InstructionError: [0, { Custom: 3012 }] })).toMatch(/не создан/);
    expect(explainTxError(new Error("User rejected the request."))).toMatch(/отклонили/);
    expect(explainTxError(new Error("block height exceeded"))).toMatch(/устарела/);
    expect(explainTxError(new Error("failed to send: custom program error: 0x1771"))).toBe(programErrorByCode(0x1771)!.message);
    expect(explainTxError(null, ["Program log: Error: insufficient funds"])).toMatch(/Недостаточно RCR/);
    expect(explainTxError("InsufficientFundsForFee")).toMatch(/SOL/);
    expect(explainTxError(new Error("x".repeat(400))).length).toBeLessThanOrEqual(180);
  });
});
