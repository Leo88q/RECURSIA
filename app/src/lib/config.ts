// Build-time configuration (Vite env). Validated once; the UI shows a
// readable error screen instead of crashing on a bad deploy config.
import { PROGRAM_ID_STR, SKR_MINT_STR } from "@recursia/sdk";

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";
const CLUSTERS: Cluster[] = ["devnet", "testnet", "mainnet-beta", "localnet"];

export const DEFAULT_RPC: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  localnet: "http://127.0.0.1:8899",
};

/**
 * Запасной RPC (чек-лист 8.4 «недоступный RPC»): публичный эндпоинт кластера.
 * Клиент переключается на него, только если настроенный RPC недоступен
 * (ChainApp). Публичные эндпоинты всегда в CSP-белом списке (security.mjs),
 * поэтому политика не ломается. localnet — без фолбэка (публичного нет,
 * http://127.0.0.1 в connect-src не входит).
 */
export function rpcFallback(rpcUrl: string, cluster: Cluster): string | undefined {
  if (cluster === "localnet") return undefined;
  const pub = DEFAULT_RPC[cluster];
  return pub && pub !== rpcUrl ? pub : undefined;
}

export interface AppConfig {
  cluster: Cluster;
  rpcUrl: string;
  wsUrl?: string;
  programId: string;
  /** Game currency mint: always the official SKR on mainnet; a test mint on devnet/localnet. */
  mint: string;
  /** µ-lamports per CU hard cap for priority fees. */
  maxPriorityFee: number;
  errors: string[];
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const errors: string[] = [];
  const cluster = (env.VITE_CLUSTER ?? "devnet") as Cluster;
  if (!CLUSTERS.includes(cluster)) errors.push(`VITE_CLUSTER="${env.VITE_CLUSTER}" — ожидается одно из ${CLUSTERS.join(", ")}`);
  const rpcUrl = env.VITE_RPC_URL || DEFAULT_RPC[CLUSTERS.includes(cluster) ? cluster : "devnet"];
  try {
    const u = new URL(rpcUrl);
    if (u.protocol !== "https:" && !(cluster === "localnet" && u.protocol === "http:")) errors.push("VITE_RPC_URL должен быть https:// (http допустим только для localnet)");
    if (u.username || u.password) errors.push("VITE_RPC_URL не должен содержать логин/пароль — ключи RPC в клиентском бандле видны всем");
  } catch { errors.push(`VITE_RPC_URL="${rpcUrl}" — некорректный URL`); }
  const wsUrl = env.VITE_WS_URL || undefined;
  if (wsUrl) { try { if (!/^wss?:$/.test(new URL(wsUrl).protocol)) errors.push("VITE_WS_URL должен быть ws(s)://"); } catch { errors.push("VITE_WS_URL — некорректный URL"); } }
  const programId = env.VITE_PROGRAM_ID || PROGRAM_ID_STR;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) errors.push("VITE_PROGRAM_ID — некорректный base58-адрес");
  const mint = env.VITE_MINT || SKR_MINT_STR;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) errors.push("VITE_MINT — некорректный base58-адрес");
  // anti-counterfeit: tokens called "SKR" exist on other mints — mainnet accepts only the official one
  if (cluster === "mainnet-beta" && mint !== SKR_MINT_STR) errors.push(`VITE_MINT: в мейннете допустим только официальный SKR (${SKR_MINT_STR})`);
  const maxPriorityFee = Number(env.VITE_MAX_PRIORITY_FEE ?? 500_000);
  if (!Number.isFinite(maxPriorityFee) || maxPriorityFee < 0 || maxPriorityFee > 50_000_000) errors.push("VITE_MAX_PRIORITY_FEE вне диапазона 0..50 000 000 µ-lamports/CU");
  return { cluster: CLUSTERS.includes(cluster) ? cluster : "devnet", rpcUrl, wsUrl, programId, mint, maxPriorityFee, errors };
}

export const CONFIG: AppConfig = readConfig(import.meta.env as unknown as Record<string, string | undefined>);

export const CLUSTER_LABEL: Record<Cluster, string> = { devnet: "Devnet", testnet: "Testnet", "mainnet-beta": "Mainnet", localnet: "Localnet" };

export function explorerUrl(kind: "tx" | "address", id: string, cfg: Pick<AppConfig, "cluster" | "rpcUrl"> = CONFIG): string {
  const base = `https://explorer.solana.com/${kind}/${id}`;
  if (cfg.cluster === "mainnet-beta") return base;
  if (cfg.cluster === "localnet") return `${base}?cluster=custom&customUrl=${encodeURIComponent(cfg.rpcUrl)}`;
  return `${base}?cluster=${cfg.cluster}`;
}
