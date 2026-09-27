import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildCsp, headersFile } from "./security.mjs";

// Checklist #50: strict CSP in production builds (dev server needs inline HMR).
// The same policy is emitted as real HTTP headers (dist/_headers) because
// frame-ancestors / HSTS only work as headers, not in <meta>.
const security = (env: Record<string, string>): Plugin => ({
  name: "recursia-security",
  apply: "build",
  transformIndexHtml(html) {
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${buildCsp(env, { meta: true })}" />`);
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "_headers", source: headersFile(env) });
  },
});

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("VITE_"))) } as Record<string, string>;
  return {
    plugins: [react(), security(env)],
    define: { "process.env": {}, global: "globalThis" },
    resolve: { alias: { buffer: "buffer/" } },
    server: { host: "0.0.0.0", port: 5173, allowedHosts: true, strictPort: true },
    preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
    build: {
      target: "es2022",
      sourcemap: false,
      // Budgets are enforced by scripts/check-bundle.mjs in CI; this is just the dev warning.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // long-term cacheable vendor chunk (changes rarely vs. game code)
          manualChunks(id: string) {
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
            return undefined;
          },
        },
      },
    },
  };
});
