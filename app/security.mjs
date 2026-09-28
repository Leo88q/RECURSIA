// Single source of truth for the client's security headers (checklist #50
// CSP / #71 DNS-hijack & injected-script mitigation). Used by:
//   • vite build  → <meta http-equiv="Content-Security-Policy"> + dist/_headers
//   • app/deploy/vercel.json, app/deploy/nginx.conf (verified equal in tests)
// Plain JS so both Vite config and node scripts/tests can import it.

const DEFAULT_RPC_ORIGINS = [
  "https://api.devnet.solana.com", "wss://api.devnet.solana.com",
  "https://api.testnet.solana.com", "wss://api.testnet.solana.com",
  "https://api.mainnet-beta.solana.com", "wss://api.mainnet-beta.solana.com",
  "https://*.helius-rpc.com", "wss://*.helius-rpc.com",
];

/** Origins (http + ws) a custom RPC / WS URL needs in connect-src. */
export function rpcOrigins(env = {}) {
  const out = [];
  for (const raw of [env.VITE_RPC_URL, env.VITE_WS_URL]) {
    if (!raw) continue;
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") out.push(u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
    else out.push(`${u.protocol}//${u.host}`, `${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`);
  }
  return out;
}

/**
 * @param {Record<string,string|undefined>} env build env
 * @param {{ meta?: boolean }} opts meta=true drops directives browsers ignore in <meta>
 */
export function buildCsp(env = {}, opts = {}) {
  const connect = [...new Set(["'self'", ...DEFAULT_RPC_ORIGINS, ...rpcOrigins(env)])];
  const d = [
    "default-src 'self'",
    "script-src 'self'",
    // wallet-adapter-react-ui injects inline style attributes
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", // all art is self-hosted; wallet icons are data: URIs (Wallet Standard)
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ];
  if (!opts.meta) d.push("frame-ancestors 'none'", "upgrade-insecure-requests");
  return d.join("; ");
}

/** Full header set for static hosting. */
export function securityHeaders(env = {}) {
  return {
    "Content-Security-Policy": buildCsp(env),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/** Netlify / Cloudflare Pages `_headers` file body. */
export function headersFile(env = {}) {
  const h = securityHeaders(env);
  const lines = ["/*", ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`), "", "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "", "/index.html", "  Cache-Control: no-cache", ""];
  return lines.join("\n");
}
