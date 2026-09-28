import { PublicKey } from "@solana/web3.js";
import { CONFIG } from "../lib/config";

/** Game currency (SKR). Module-level constant: hooks can depend on it safely. */
export const MINT = new PublicKey(CONFIG.mint);
