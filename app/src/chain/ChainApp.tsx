// Lazy-loaded entry of live mode: the wallet adapter + web3 RPC stack is only
// downloaded when the player opens it (sandbox/lab stay light).
import "./polyfill";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { CONFIG } from "../lib/config";
import type { Route } from "../lib/route";
import { TxProvider } from "./tx";
import { ChainView } from "./ChainView";

export default function ChainApp({ route, go }: { route: Extract<Route, { page: "chain" | "chain-lab" }>; go: (r: Route, replace?: boolean) => void }) {
  // Wallet Standard auto-detects Phantom, Solflare, Backpack… — no per-wallet adapter packages (smaller supply-chain surface, #66).
  const wallets = useMemo(() => [], []);
  const config = useMemo(() => ({ commitment: "confirmed" as const, wsEndpoint: CONFIG.wsUrl, disableRetryOnRateLimit: false }), []);
  return (
    <ConnectionProvider endpoint={CONFIG.rpcUrl} config={config}>
      {/* autoConnect only re-connects a wallet the user explicitly chose before; never auto-approves anything (#79). */}
      <WalletProvider wallets={wallets} autoConnect localStorageKey="recursia:wallet">
        <WalletModalProvider>
          <TxProvider onConfirmed={() => window.dispatchEvent(new Event("recursia:tx"))}>
            <ChainView route={route} go={go} />
          </TxProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
