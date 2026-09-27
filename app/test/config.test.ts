import { describe, expect, it } from "vitest";
import { explorerUrl, readConfig } from "../src/lib/config";

describe("deploy config validation", () => {
  it("defaults to devnet public RPC", () => {
    const c = readConfig({});
    expect(c.cluster).toBe("devnet");
    expect(c.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(c.errors).toEqual([]);
  });
  it("rejects insecure / leaky / malformed settings", () => {
    expect(readConfig({ VITE_RPC_URL: "http://rpc.example.com" }).errors.join()).toMatch(/https/);
    expect(readConfig({ VITE_CLUSTER: "localnet", VITE_RPC_URL: "http://127.0.0.1:8899" }).errors).toEqual([]);
    expect(readConfig({ VITE_RPC_URL: "https://user:pass@rpc.example.com" }).errors.join()).toMatch(/логин/);
    expect(readConfig({ VITE_CLUSTER: "moon" }).errors.length).toBe(1);
    expect(readConfig({ VITE_PROGRAM_ID: "0OIl" }).errors.join()).toMatch(/PROGRAM_ID/);
    expect(readConfig({ VITE_MAX_PRIORITY_FEE: "-1" }).errors.join()).toMatch(/PRIORITY/);
  });
  it("explorer links per cluster", () => {
    expect(explorerUrl("tx", "sig", { cluster: "mainnet-beta", rpcUrl: "" })).toBe("https://explorer.solana.com/tx/sig");
    expect(explorerUrl("address", "a", { cluster: "devnet", rpcUrl: "" })).toBe("https://explorer.solana.com/address/a?cluster=devnet");
    expect(explorerUrl("tx", "s", { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899" })).toContain("customUrl=http%3A%2F%2F127.0.0.1%3A8899");
  });
});
