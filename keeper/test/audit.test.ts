import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { ConfigAccount, PlayerAccount, TournamentAccount, WorldAccount } from "@recursia/sdk";
import { audit, type AuditInput } from "../src/audit.js";

const key = () => Keypair.generate().publicKey;
const admin = key(), upgrader = key();

function healthy(): AuditInput {
  const config = {
    admin, paused: false, pending: { kind: "None" }, pendingEta: 0n, pendingNonce: 0n,
    totalSunk: 500n, totalEmitted: 200n, totalSponsored: 10n, totalSeasonFunded: 90n, totalSeasonPaid: 40n, treasurySeen: 70n,
  } as unknown as ConfigAccount;
  const world = { energy: 100n, rewardsReserved: 30n, deposits: 20n, architectAccrued: 5n, quantumEscrow: 15n, territoryPending: [10n, 20n, ...new Array(62).fill(0n)] } as unknown as WorldAccount;
  return {
    config,
    bal: { rewardPool: 1_300n, sponsorPool: 90n, seasonPool: 50n, tournamentPool: 25n, claims: 60n, treasury: 80n }, // funded implied: 1000 / 100
    worlds: [{ key: key(), acc: world, vault: 170n }],
    players: [{ claimable: 40n } as PlayerAccount, { claimable: 20n } as PlayerAccount],
    tournaments: [{ pot: 25n } as TournamentAccount, { pot: 0n } as TournamentAccount],
    upgradeAuthority: upgrader,
  };
}

describe("live invariant audit", () => {
  it("a consistent state raises nothing", () => {
    const r = audit(healthy());
    expect(r.violations).toEqual([]);
    expect(r.state.rewardFundedImplied).toBe(1_000n);
    expect(audit(healthy(), r.state).violations).toEqual([]);
  });
  it("every broken ledger is reported", () => {
    const cases: [string, (x: AuditInput) => void, RegExp][] = [
      ["season", (x) => { x.bal.seasonPool -= 1n; }, /season pool/],
      ["tournament", (x) => { x.bal.tournamentPool += 1n; }, /tournament pool/],
      ["claims", (x) => { x.bal.claims = 59n; }, /claims vault insolvent/],
      ["world vault", (x) => { x.worlds[0].vault = 169n; }, /vault insolvent/],
      ["pending", (x) => { x.worlds[0].acc.territoryPending[5] = 1n; }, /Σ pending/],
      ["treasury", (x) => { x.bal.treasury = 69n; }, /treasury_seen/],
      ["reward ledger", (x) => { x.bal.rewardPool = 250n; }, /reward pool below its ledger/],
    ];
    for (const [name, mutate, re] of cases) {
      const x = healthy(); mutate(x);
      const r = audit(x);
      expect(r.violations, name).toHaveLength(1);
      expect(r.violations[0], name).toMatch(re);
    }
  });
  it("money leaving the reward / sponsor pool outside the ledger is caught between rounds", () => {
    const s0 = audit(healthy()).state;
    const drained = healthy(); drained.bal.rewardPool -= 7n; drained.bal.sponsorPool -= 3n;
    const r = audit(drained, s0);
    expect(r.violations.some((v) => /reward pool lost/.test(v))).toBe(true);
    expect(r.violations.some((v) => /sponsor pool lost/.test(v))).toBe(true);
    // legit flows move the ledger together with the pool: emission out, sink in
    const flows = healthy(); flows.bal.rewardPool += 50n - 30n; flows.config.totalSunk += 50n; flows.config.totalEmitted += 30n;
    expect(audit(flows, s0).violations).toEqual([]);
  });
  it("governance: proposal (once), its end, admin / pause / upgrade authority changes", () => {
    const s0 = audit(healthy()).state;
    const p = healthy();
    p.config.pending = { kind: "TreasurySpend", amount: 5_000_000n, recipient: key() };
    p.config.pendingNonce = 1n; p.config.pendingEta = 1_000n + 48n * 3600n;
    const r1 = audit(p, s0, 1_000n);
    expect(r1.notices).toEqual([expect.stringMatching(/PROPOSAL #1: TreasurySpend 5 SKR .* executable in 48 h 0 min/)]);
    expect(audit(p, r1.state, 2_000n).notices).toEqual([]); // announced once
    const done = healthy(); done.config.pendingNonce = 1n;
    expect(audit(done, r1.state).notices).toEqual(["proposal #1 executed or cancelled"]);
    const x = healthy(); x.config.admin = key(); x.config.paused = true; x.upgradeAuthority = null;
    const n = audit(x, s0).notices.join("\n");
    expect(n).toMatch(/ADMIN CHANGED/); expect(n).toMatch(/PROGRAM PAUSED/); expect(n).toMatch(/UPGRADE AUTHORITY CHANGED: .* none \(immutable\)/);
    expect(PublicKey.isOnCurve(admin.toBytes())).toBe(true);
  });
});
