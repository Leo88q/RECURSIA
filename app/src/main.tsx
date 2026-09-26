import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";
import { App } from "./App";

const RPC = import.meta.env.VITE_RPC_URL ?? "https://api.devnet.solana.com";

function Root() {
  // Wallet Standard auto-detects Phantom, Solflare, Backpack… — no extra adapter packages (smaller supply-chain surface, #66).
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
