// Lazy-loaded entry of live mode: the wallet adapter + web3 RPC stack is only
// downloaded when the player opens it (sandbox/lab stay light).
import "./polyfill";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Connection } from "@solana/web3.js";
import { CONFIG, CLUSTER_LABEL, rpcFallback } from "../lib/config";
import type { Route } from "../lib/route";
import { TxProvider } from "./tx";
import { ChainView } from "./ChainView";
import { useToast } from "../ui/Toast";

const PROBE_MS = 30_000;
const FAILS_TO_FALLBACK = 3; // ~90 с недоступности первичного RPC

export default function ChainApp({ route, go }: { route: Extract<Route, { page: "chain" | "chain-lab" }>; go: (r: Route, replace?: boolean) => void }) {
  // Wallet Standard auto-detects Phantom, Solflare, Backpack… — no per-wallet adapter packages (smaller supply-chain surface, #66).
  const wallets = useMemo(() => [], []);
  const toast = useToast();
  // Запасной RPC (чек-лист 8.4): при недоступности настроенного endpoint
  // переключаемся на публичный эндпоинт того же кластера (всегда в CSP-белом
  // списке), каждые PROBE_MS пробуем вернуться на первичный. ConnectionProvider
  // пересоздаёт Connection при смене endpoint; подписки в data.ts зависят от
  // connection и переподключаются. wsEndpoint — только для первичного
  // (у публичного эндпоинта ws совпадает с его адресом).
  const fallback = useMemo(() => rpcFallback(CONFIG.rpcUrl, CONFIG.cluster), []);
  const [endpoint, setEndpoint] = useState(CONFIG.rpcUrl);
  const config = useMemo(
    () => ({ commitment: "confirmed" as const, wsEndpoint: endpoint === CONFIG.rpcUrl ? CONFIG.wsUrl : undefined, disableRetryOnRateLimit: false }),
    [endpoint],
  );
  const fails = useRef(0);
  useEffect(() => {
    const isPrimary = endpoint === CONFIG.rpcUrl;
    if (!isPrimary && !fallback) return;
    const probe = new Connection(endpoint, "confirmed");
    const id = window.setInterval(async () => {
      try {
        await probe.getSlot("confirmed");
        fails.current = 0;
        if (!isPrimary) {
          // на фолбэке: пробуем вернуть первичный
          try {
            await new Connection(CONFIG.rpcUrl, "confirmed").getSlot("confirmed");
            setEndpoint(CONFIG.rpcUrl);
            toast.push({ kind: "ok", title: "Основной RPC снова доступен" });
          } catch { /* остаёмся на запасном */ }
        }
      } catch {
        fails.current += 1;
        if (isPrimary && fallback && fails.current >= FAILS_TO_FALLBACK) {
          setEndpoint(fallback);
          toast.push({ kind: "info", title: `Основной RPC недоступен — переключились на публичный ${CLUSTER_LABEL[CONFIG.cluster]}-эндпоинт` });
        }
      }
    }, PROBE_MS);
    return () => window.clearInterval(id);
  }, [endpoint, fallback, toast]);
  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
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
