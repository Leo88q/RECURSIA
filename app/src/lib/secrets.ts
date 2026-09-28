// Superposition secrets: the commit preimage never leaves the browser.
// Saved BEFORE the commit is signed, so a crash between signing and saving
// cannot lose it (losing it = the stake decoheres and goes to the reward pool). Export/import
// as a file lets the player move devices.

export interface Secret { a: bigint; b: bigint; w: number; salt: Uint8Array }
interface Stored { v: 1; a: string; b: string; w: number; salt: string; world: string; idx: number; owner: string }

const key = (world: string, idx: number, owner: string) => `recursia:psi:${world}:${idx}:${owner}`;
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

function valid(s: unknown): s is Stored {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return typeof o.a === "string" && /^\d{1,20}$/.test(o.a) && typeof o.b === "string" && /^\d{1,20}$/.test(o.b)
    && typeof o.w === "number" && Number.isInteger(o.w) && o.w >= 0 && o.w <= 10_000
    && typeof o.salt === "string" && /^[0-9a-f]{64}$/.test(o.salt);
}

export function saveSecret(world: string, idx: number, owner: string, s: Secret, storage: Storage = localStorage) {
  const v: Stored = { v: 1, a: s.a.toString(), b: s.b.toString(), w: s.w, salt: toHex(s.salt), world, idx, owner };
  storage.setItem(key(world, idx, owner), JSON.stringify(v));
}

export function loadSecret(world: string, idx: number, owner: string, storage: Storage = localStorage): Secret | null {
  try {
    const s: unknown = JSON.parse(storage.getItem(key(world, idx, owner)) ?? "null");
    return valid(s) ? { a: BigInt(s.a), b: BigInt(s.b), w: s.w, salt: fromHex(s.salt) } : null;
  } catch { return null; }
}

export function removeSecret(world: string, idx: number, owner: string, storage: Storage = localStorage) {
  storage.removeItem(key(world, idx, owner));
}

export function exportSecret(world: string, idx: number, owner: string, storage: Storage = localStorage): boolean {
  const raw = storage.getItem(key(world, idx, owner));
  if (!raw) return false;
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `recursia-psi-${world.slice(0, 6)}-${idx}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Imports a secret file; only accepted if it belongs to this world/cell/owner. */
export function importSecret(text: string, world: string, idx: number, owner: string, storage: Storage = localStorage): string | null {
  let s: unknown;
  try { s = JSON.parse(text); } catch { return "файл не является JSON"; }
  if (!valid(s)) return "неверный формат файла секрета";
  if (s.world !== world || s.idx !== idx || s.owner !== owner) return "секрет принадлежит другой клетке или кошельку";
  storage.setItem(key(world, idx, owner), JSON.stringify(s));
  return null;
}
