import { describe, expect, it } from "vitest";
import { importSecret, loadSecret, removeSecret, saveSecret } from "../src/lib/secrets";

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe("superposition secrets", () => {
  const salt = Uint8Array.from({ length: 32 }, (_, i) => i);
  it("save → load round trip, remove", () => {
    const s = new Mem();
    saveSecret("W", 3, "O", { a: 7n, b: 9n, w: 2500, salt }, s);
    expect(loadSecret("W", 3, "O", s)).toEqual({ a: 7n, b: 9n, w: 2500, salt });
    expect(loadSecret("W", 4, "O", s)).toBeNull();
    removeSecret("W", 3, "O", s);
    expect(loadSecret("W", 3, "O", s)).toBeNull();
  });
  it("import validates format and ownership", () => {
    const src = new Mem(); saveSecret("W", 3, "O", { a: 1n, b: 2n, w: 10, salt }, src);
    const file = src.getItem("recursia:psi:W:3:O")!;
    const dst = new Mem();
    expect(importSecret("{", "W", 3, "O", dst)).toMatch(/JSON/);
    expect(importSecret(JSON.stringify({ a: "x" }), "W", 3, "O", dst)).toMatch(/формат/);
    expect(importSecret(file, "W", 5, "O", dst)).toMatch(/другой/);
    expect(importSecret(file, "W", 3, "O", dst)).toBeNull();
    expect(loadSecret("W", 3, "O", dst)?.a).toBe(1n);
  });
  it("corrupted storage never throws", () => {
    const s = new Mem(); s.setItem("recursia:psi:W:1:O", "{not json");
    expect(loadSecret("W", 1, "O", s)).toBeNull();
    s.setItem("recursia:psi:W:1:O", JSON.stringify({ a: "1", b: "2", w: 99999, salt: "00" }));
    expect(loadSecret("W", 1, "O", s)).toBeNull();
  });
});
