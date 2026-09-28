import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildCsp, headersFile, securityHeaders } from "../security.mjs";

describe("security headers", () => {
  it("strict CSP: no inline/eval scripts, no framing, no plugins", () => {
    const csp = buildCsp({});
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
  it("meta variant omits header-only directives", () => {
    expect(buildCsp({}, { meta: true })).not.toContain("frame-ancestors");
  });
  it("custom RPC + WS are whitelisted (https→wss)", () => {
    const csp = buildCsp({ VITE_RPC_URL: "https://rpc.example.com/?k=1", VITE_WS_URL: "wss://ws.example.com" });
    expect(csp).toContain("https://rpc.example.com wss://rpc.example.com");
    expect(csp).toContain("wss://ws.example.com https://ws.example.com");
  });
  it("full header set incl. HSTS / XFO / Referrer / Permissions", () => {
    const h = securityHeaders();
    for (const k of ["Strict-Transport-Security", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "X-Content-Type-Options", "Cross-Origin-Opener-Policy"]) expect(h[k]).toBeTruthy();
    expect(headersFile()).toMatch(/^\/\*\n {2}Content-Security-Policy: /);
  });
  it("committed vercel.json / nginx.conf are in sync with security.mjs", () => {
    const script = fileURLToPath(new URL("../scripts/gen-deploy.mjs", import.meta.url));
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe", env: {} })).not.toThrow();
  });
});
