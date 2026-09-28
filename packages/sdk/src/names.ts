// 32-byte on-chain names. Dependency-free (safe for light client bundles).
export const decodeName = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, b.indexOf(0) === -1 ? 32 : b.indexOf(0)));
export function encodeName(s: string): Uint8Array {
  // strip invisible / control chars before encoding (#76)
  const clean = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "");
  const b = new TextEncoder().encode(clean);
  if (b.length === 0 || b.length > 32) throw new Error("name must be 1..32 bytes");
  const out = new Uint8Array(32); out.set(b); return out;
}
