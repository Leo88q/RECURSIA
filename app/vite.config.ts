import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Checklist #50: strict CSP in production builds (dev server needs inline HMR).
const csp = (): Plugin => ({
  name: "recursia-csp",
  apply: "build",
  transformIndexHtml(html) {
    // A custom RPC (VITE_RPC_URL) must be whitelisted explicitly, otherwise CSP blocks it.
    const extra: string[] = [];
    const rpc = process.env.VITE_RPC_URL;
    if (rpc) {
      const u = new URL(rpc);
      extra.push(u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
    }
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.devnet.solana.com wss://api.devnet.solana.com https://api.mainnet-beta.solana.com wss://api.mainnet-beta.solana.com https://*.helius-rpc.com wss://*.helius-rpc.com" + (extra.length ? " " + extra.join(" ") : ""),
      "frame-ancestors 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
});

export default defineConfig({
  plugins: [react(), csp()],
  define: { "process.env": {}, global: "globalThis" },
  resolve: { alias: { buffer: "buffer/" } },
  server: { host: "0.0.0.0", port: 5173, allowedHosts: true, strictPort: true },
  preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 2000 },
});
