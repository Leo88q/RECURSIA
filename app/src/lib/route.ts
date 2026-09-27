// Tiny hash router: static hosting friendly (no server rewrites needed, works
// on IPFS/Arweave mirrors too) and shareable deep links.
//   #/                        → sandbox
//   #/sandbox/<worldId>/<cell>
//   #/lab
//   #/chain                   → on-chain worlds list
//   #/chain/<worldPubkey>/<cell>
//   #/chain/lab
import { useCallback, useEffect, useState } from "react";

export type Route =
  | { page: "sandbox"; world?: string; cell?: number }
  | { page: "lab" }
  | { page: "chain"; world?: string; cell?: number }
  | { page: "chain-lab" };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function cellOf(s: string | undefined): number | undefined {
  if (s === undefined || !/^\d{1,2}$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 0 && n < 64 ? n : undefined;
}

/** Never throws; unknown / malformed input degrades to the closest valid route. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ""; } });
  const [head, a, b] = parts;
  if (head === "lab") return { page: "lab" };
  if (head === "chain") {
    if (a === "lab") return { page: "chain-lab" };
    if (a && BASE58.test(a)) return { page: "chain", world: a, cell: cellOf(b) };
    return { page: "chain" };
  }
  if (head === "sandbox" && a && SAFE_ID.test(a)) return { page: "sandbox", world: a, cell: cellOf(b) };
  return { page: "sandbox" };
}

export function formatRoute(r: Route): string {
  switch (r.page) {
    case "lab": return "#/lab";
    case "chain-lab": return "#/chain/lab";
    case "chain": return r.world ? `#/chain/${r.world}${r.cell !== undefined ? `/${r.cell}` : ""}` : "#/chain";
    case "sandbox": return r.world ? `#/sandbox/${encodeURIComponent(r.world)}${r.cell !== undefined ? `/${r.cell}` : ""}` : "#/";
  }
}

export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route, replace = false) => {
    const h = formatRoute(r);
    if (h === window.location.hash || (h === "#/" && window.location.hash === "")) { setRoute(r); return; }
    if (replace) { window.history.replaceState(null, "", h); setRoute(r); } else window.location.hash = h;
  }, []);
  return [route, go];
}
