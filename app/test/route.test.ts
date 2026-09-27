import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute, type Route } from "../src/lib/route";

const W = "2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik";

describe("hash router", () => {
  it("parses known routes", () => {
    expect(parseRoute("")).toEqual({ page: "sandbox" });
    expect(parseRoute("#/lab")).toEqual({ page: "lab" });
    expect(parseRoute("#/chain")).toEqual({ page: "chain" });
    expect(parseRoute("#/chain/lab")).toEqual({ page: "chain-lab" });
    expect(parseRoute(`#/chain/${W}/17`)).toEqual({ page: "chain", world: W, cell: 17 });
    expect(parseRoute("#/sandbox/root-0/5")).toEqual({ page: "sandbox", world: "root-0", cell: 5 });
  });
  it("degrades malformed / hostile input safely", () => {
    expect(parseRoute("#/chain/not-a-key")).toEqual({ page: "chain" });
    expect(parseRoute(`#/chain/${W}/64`)).toEqual({ page: "chain", world: W, cell: undefined });
    expect(parseRoute(`#/chain/${W}/-1`)).toEqual({ page: "chain", world: W, cell: undefined });
    expect(parseRoute("#/sandbox/<script>")).toEqual({ page: "sandbox" });
    expect(parseRoute("#/%E0%A4%A")).toEqual({ page: "sandbox" });
    expect(parseRoute("#/whatever")).toEqual({ page: "sandbox" });
  });
  it("format ∘ parse is identity for valid routes", () => {
    const rs: Route[] = [{ page: "sandbox" }, { page: "lab" }, { page: "chain" }, { page: "chain-lab" }, { page: "chain", world: W, cell: 0 }, { page: "sandbox", world: "child-3", cell: 63 }];
    for (const r of rs) expect(parseRoute(formatRoute(r))).toEqual({ ...r, ...(r.page === "chain" || r.page === "sandbox" ? { cell: (r as { cell?: number }).cell } : {}) });
  });
});
