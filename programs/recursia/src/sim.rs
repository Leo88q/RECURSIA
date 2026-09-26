//! Deterministic cellular-evolution engine.
//!
//! The universe of every world is a 64x64 torus stored as 64 rows of `u64`
//! (bit `x` of row `y` is the cell at column `x`, row `y`).  The rule is any
//! Life-like "B/S" rule encoded as two 9-bit masks (bit `n` set => a cell with
//! `n` live neighbours is born / survives).
//!
//! Neighbour counting is bit-sliced: all 64 cells of a row are processed in
//! parallel with a 4-bit ripple adder, so one generation costs a few thousand
//! ALU ops.  That is cheap enough to run *inside* the Solana program, which is
//! why RECURSIA computes the simulation on-chain instead of trusting an
//! off-chain sequencer (no fraud proofs, no data-availability problem).
//!
//! The exact same algorithm is mirrored in `packages/sdk/src/sim.ts`; shared
//! test vectors (`tests/vectors/sim.json`) guarantee bit-for-bit equality.

use crate::constants::{GRID, TERRITORIES, TERRITORY_SIDE};

pub type Grid = [u64; GRID];

/// Only bits 0..=8 are meaningful in a rule mask.
pub const RULE_MASK: u16 = 0x1FF;

#[inline(always)]
fn add_bit(s: &mut [u64; 4], a: u64) {
    // ripple-carry add of a 1-bit plane `a` into the 4-bit counter `s`
    let c0 = s[0] & a;
    s[0] ^= a;
    let c1 = s[1] & c0;
    s[1] ^= c0;
    let c2 = s[2] & c1;
    s[2] ^= c1;
    s[3] |= c2;
}

/// Quantum extension of a rule: neighbour counts in `q_birth` / `q_survive`
/// fire only where the per-cell random mask is 1 (probability 2^-amp).
/// `seed` comes from a scheduled slot hash (see `quantum_seed`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quantum {
    pub q_birth: u16,
    pub q_survive: u16,
    pub amp: u8,
    pub seed: [u64; 4],
}

impl Quantum {
    pub fn is_active(&self) -> bool {
        self.amp > 0 && (self.q_birth | self.q_survive) & RULE_MASK != 0
    }
}

/// SplitMix64 — tiny, well-distributed, identical in the TS mirror.
#[inline(always)]
pub fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Random mask for row `y` of absolute generation `gen`: AND of `amp` words,
/// so each bit is 1 with probability 2^-amp.
#[inline(always)]
pub fn quantum_mask(q: &Quantum, gen: u64, y: usize) -> u64 {
    let mut m = u64::MAX;
    for k in 0..(q.amp.min(3) as usize) {
        m &= splitmix64(q.seed[k] ^ (gen << 8) ^ (y as u64));
    }
    m
}

/// Advance the grid by one generation (classical rule).
pub fn step(grid: &Grid, birth: u16, survive: u16) -> Grid {
    step_core(grid, birth, survive, None, 0)
}

/// Advance one generation with an optional quantum extension.
/// `gen` is the absolute generation number being produced (for the mask).
pub fn step_core(grid: &Grid, birth: u16, survive: u16, q: Option<&Quantum>, gen: u64) -> Grid {
    let birth = birth & RULE_MASK;
    let survive = survive & RULE_MASK;
    let (qb, qs) = match q {
        Some(q) if q.is_active() => (q.q_birth & RULE_MASK & !birth, q.q_survive & RULE_MASK & !survive),
        _ => (0, 0),
    };
    let mut out = [0u64; GRID];
    for y in 0..GRID {
        let up = grid[(y + GRID - 1) % GRID];
        let mid = grid[y];
        let down = grid[(y + 1) % GRID];
        let mut s = [0u64; 4];
        // horizontal torus wrap is exactly a 64-bit rotate
        add_bit(&mut s, up.rotate_left(1));
        add_bit(&mut s, up);
        add_bit(&mut s, up.rotate_right(1));
        add_bit(&mut s, mid.rotate_left(1));
        add_bit(&mut s, mid.rotate_right(1));
        add_bit(&mut s, down.rotate_left(1));
        add_bit(&mut s, down);
        add_bit(&mut s, down.rotate_right(1));

        let mut born = 0u64;
        let mut keep = 0u64;
        let mut qborn = 0u64;
        let mut qkeep = 0u64;
        for n in 0..9u16 {
            let bn = (birth >> n) & 1 == 1;
            let sn = (survive >> n) & 1 == 1;
            let qbn = (qb >> n) & 1 == 1;
            let qsn = (qs >> n) & 1 == 1;
            if !bn && !sn && !qbn && !qsn {
                continue;
            }
            let eq = eq_count(&s, n);
            if bn {
                born |= eq;
            }
            if sn {
                keep |= eq;
            }
            if qbn {
                qborn |= eq;
            }
            if qsn {
                qkeep |= eq;
            }
        }
        if qborn | qkeep != 0 {
            if let Some(q) = q {
                let m = quantum_mask(q, gen, y);
                born |= qborn & m;
                keep |= qkeep & m;
            }
        }
        out[y] = (mid & keep) | (!mid & born);
    }
    out
}

#[inline(always)]
fn eq_count(s: &[u64; 4], n: u16) -> u64 {
    let pick = |bit: u16, plane: u64| if (n >> bit) & 1 == 1 { plane } else { !plane };
    pick(0, s[0]) & pick(1, s[1]) & pick(2, s[2]) & pick(3, s[3])
}

/// Advance `gens` generations.
pub fn step_n(grid: &Grid, birth: u16, survive: u16, gens: u8) -> Grid {
    let mut g = *grid;
    for _ in 0..gens {
        g = step(&g, birth, survive);
    }
    g
}

/// Advance `gens` generations; generation numbers `gen0+1 ..= gen0+gens`.
pub fn step_n_q(grid: &Grid, birth: u16, survive: u16, q: &Quantum, gen0: u64, gens: u8) -> Grid {
    let mut g = *grid;
    for i in 0..gens as u64 {
        g = step_core(&g, birth, survive, Some(q), gen0 + i + 1);
    }
    g
}

/// Live cells per 8x8 territory. Territory index = (y/8)*8 + (x/8).
pub fn territory_counts(grid: &Grid) -> [u16; TERRITORIES] {
    let mut counts = [0u16; TERRITORIES];
    for (y, row) in grid.iter().enumerate() {
        let ty = y / TERRITORY_SIDE;
        for tx in 0..8 {
            let byte = (row >> (tx * 8)) & 0xFF;
            counts[ty * 8 + tx] += byte.count_ones() as u16;
        }
    }
    counts
}

pub fn population(grid: &Grid) -> u32 {
    grid.iter().map(|r| r.count_ones()).sum()
}

/// Overwrite the 8x8 block of territory `idx` with `pattern`
/// (byte `r` of `pattern` = row `r` of the block, bit `c` = column `c`).
pub fn write_block(grid: &mut Grid, idx: u8, pattern: u64) {
    let idx = idx as usize % TERRITORIES;
    let tx = idx % 8;
    let ty = idx / 8;
    let shift = tx * 8;
    let clear = !(0xFFu64 << shift);
    for r in 0..8 {
        let y = ty * 8 + r;
        let byte = (pattern >> (r * 8)) & 0xFF;
        grid[y] = (grid[y] & clear) | (byte << shift);
    }
}

/// OR `pattern` into the block of territory `idx` (used by "breach").
pub fn or_block(grid: &mut Grid, idx: u8, pattern: u64) {
    let idx = idx as usize % TERRITORIES;
    let tx = idx % 8;
    let ty = idx / 8;
    let shift = tx * 8;
    for r in 0..8 {
        let y = ty * 8 + r;
        let byte = (pattern >> (r * 8)) & 0xFF;
        grid[y] |= byte << shift;
    }
}

/// Serialize rows little-endian (canonical byte form used for hashing).
pub fn to_bytes(grid: &Grid) -> [u8; GRID * 8] {
    let mut out = [0u8; GRID * 8];
    for (i, row) in grid.iter().enumerate() {
        out[i * 8..i * 8 + 8].copy_from_slice(&row.to_le_bytes());
    }
    out
}

/// Build the initial "big bang" grid from 64 hash-derived words.
/// `words` are 32 32-byte digests; rows = (a & b) giving ~25% density.
pub fn bigbang_from_digests(digests: &[[u8; 32]; 32]) -> Grid {
    let mut a = [0u64; GRID];
    let mut b = [0u64; GRID];
    for (i, d) in digests.iter().enumerate() {
        for j in 0..4 {
            let mut w = [0u8; 8];
            w.copy_from_slice(&d[j * 8..j * 8 + 8]);
            let v = u64::from_le_bytes(w);
            let slot = i * 4 + j; // 0..128
            if slot < GRID {
                a[slot] = v;
            } else {
                b[slot - GRID] = v;
            }
        }
    }
    let mut g = [0u64; GRID];
    for y in 0..GRID {
        g[y] = a[y] & b[y];
    }
    g
}

/// A glider, placed in an 8x8 block (used by the breach mechanic).
pub const GLIDER: u64 = 0x0000_0000_0007_0402; // rows: .#. / ..# / ###  (shifted)

#[cfg(test)]
mod tests {
    use super::*;

    const LIFE_B: u16 = 1 << 3;
    const LIFE_S: u16 = (1 << 2) | (1 << 3);

    fn set(g: &mut Grid, x: usize, y: usize) {
        g[y % GRID] |= 1u64 << (x % GRID);
    }
    fn get(g: &Grid, x: usize, y: usize) -> bool {
        (g[y % GRID] >> (x % GRID)) & 1 == 1
    }

    /// Naive reference implementation to cross-check the bit-sliced one.
    fn naive_step(g: &Grid, b: u16, s: u16) -> Grid {
        let mut o = [0u64; GRID];
        for y in 0..GRID {
            for x in 0..GRID {
                let mut n = 0u16;
                for dy in [GRID - 1, 0, 1] {
                    for dx in [GRID - 1, 0, 1] {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        if get(g, x + dx, y + dy) {
                            n += 1;
                        }
                    }
                }
                let alive = get(g, x, y);
                let next = if alive { (s >> n) & 1 == 1 } else { (b >> n) & 1 == 1 };
                if next {
                    set(&mut o, x, y);
                }
            }
        }
        o
    }

    fn xorshift(seed: &mut u64) -> u64 {
        let mut x = *seed;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *seed = x;
        x
    }

    #[test]
    fn blinker_oscillates() {
        let mut g = [0u64; GRID];
        set(&mut g, 10, 10);
        set(&mut g, 11, 10);
        set(&mut g, 12, 10);
        let g1 = step(&g, LIFE_B, LIFE_S);
        assert!(get(&g1, 11, 9) && get(&g1, 11, 10) && get(&g1, 11, 11));
        assert_eq!(population(&g1), 3);
        assert_eq!(step(&g1, LIFE_B, LIFE_S), g);
    }

    #[test]
    fn wraps_around_torus() {
        let mut g = [0u64; GRID];
        set(&mut g, 63, 0);
        set(&mut g, 0, 0);
        set(&mut g, 1, 0);
        let g1 = step(&g, LIFE_B, LIFE_S);
        assert!(get(&g1, 0, 63) && get(&g1, 0, 0) && get(&g1, 0, 1));
    }

    #[test]
    fn matches_naive_for_many_rules() {
        let mut seed = 0x9E37_79B9_7F4A_7C15u64;
        for _ in 0..24 {
            let mut g = [0u64; GRID];
            for r in g.iter_mut() {
                *r = xorshift(&mut seed) & xorshift(&mut seed);
            }
            let b = (xorshift(&mut seed) as u16) & RULE_MASK & !1; // no B0
            let s = (xorshift(&mut seed) as u16) & RULE_MASK;
            assert_eq!(step(&g, b, s), naive_step(&g, b, s));
        }
    }

    /// Naive per-cell quantum reference: same mask bits, scalar logic.
    fn naive_step_q(g: &Grid, b: u16, s: u16, q: &Quantum, gen: u64) -> Grid {
        let classical = naive_step(g, b, s);
        let mut o = classical;
        for y in 0..GRID {
            let m = quantum_mask(q, gen, y);
            for x in 0..GRID {
                let mut n = 0u16;
                for dy in [GRID - 1, 0, 1] {
                    for dx in [GRID - 1, 0, 1] {
                        if (dx != 0 || dy != 0) && get(g, x + dx, y + dy) {
                            n += 1;
                        }
                    }
                }
                let alive = get(g, x, y);
                let lucky = (m >> x) & 1 == 1;
                let q_fire = if alive {
                    (s >> n) & 1 == 0 && (q.q_survive >> n) & 1 == 1
                } else {
                    (b >> n) & 1 == 0 && (q.q_birth >> n) & 1 == 1
                };
                if q_fire && lucky {
                    set(&mut o, x, y);
                }
            }
        }
        o
    }

    #[test]
    fn quantum_matches_naive_and_reduces_to_classical() {
        let mut seed = 0xDEAD_BEEF_1234_5678u64;
        for amp in 0..=3u8 {
            for _ in 0..6 {
                let mut g = [0u64; GRID];
                for r in g.iter_mut() {
                    *r = xorshift(&mut seed) & xorshift(&mut seed);
                }
                let b = LIFE_B;
                let s = LIFE_S;
                let q = Quantum {
                    q_birth: if amp == 0 { 0 } else { 1 << 6 },
                    q_survive: if amp == 0 { 0 } else { (1 << 1) | (1 << 4) },
                    amp,
                    seed: [xorshift(&mut seed), xorshift(&mut seed), xorshift(&mut seed), xorshift(&mut seed)],
                };
                let gen = xorshift(&mut seed) % 1_000_000;
                let fast = step_core(&g, b, s, Some(&q), gen);
                assert_eq!(fast, naive_step_q(&g, b, s, &q, gen), "amp {amp}");
                if amp == 0 {
                    assert_eq!(fast, step(&g, b, s));
                }
            }
        }
    }

    #[test]
    fn quantum_mask_density_follows_amplitude() {
        let q = |amp| Quantum { q_birth: 1 << 6, q_survive: 0, amp, seed: [1, 2, 3, 4] };
        for (amp, expect) in [(1u8, 0.5f64), (2, 0.25), (3, 0.125)] {
            let mut ones = 0u32;
            for gen in 0..64u64 {
                for y in 0..GRID {
                    ones += quantum_mask(&q(amp), gen, y).count_ones();
                }
            }
            let p = ones as f64 / (64.0 * 64.0 * 64.0);
            assert!((p - expect).abs() < 0.01, "amp {amp}: {p}");
        }
    }

    #[test]
    fn counts_sum_to_population() {
        let mut seed = 42u64;
        let mut g = [0u64; GRID];
        for r in g.iter_mut() {
            *r = xorshift(&mut seed);
        }
        let c = territory_counts(&g);
        assert_eq!(c.iter().map(|&v| v as u32).sum::<u32>(), population(&g));
        assert!(c.iter().all(|&v| v <= 64));
    }

    #[test]
    fn write_block_is_local() {
        let mut g = [u64::MAX; GRID];
        write_block(&mut g, 9, 0);
        let c = territory_counts(&g);
        assert_eq!(c[9], 0);
        assert_eq!(c.iter().filter(|&&v| v == 64).count(), 63);
        write_block(&mut g, 9, GLIDER);
        assert_eq!(territory_counts(&g)[9], 5);
    }

    /// Cross-implementation vectors produced by the TS engine.
    #[test]
    fn shared_vectors() {
        let raw = include_str!("../../../tests/vectors/sim.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in v["cases"].as_array().unwrap() {
            let parse = |k: &str| -> Grid {
                let arr = case[k].as_array().unwrap();
                let mut g = [0u64; GRID];
                for (i, s) in arr.iter().enumerate() {
                    g[i] = u64::from_str_radix(s.as_str().unwrap(), 16).unwrap();
                }
                g
            };
            let input = parse("input");
            let expected = parse("output");
            let b = case["birth"].as_u64().unwrap() as u16;
            let s = case["survive"].as_u64().unwrap() as u16;
            let gens = case["gens"].as_u64().unwrap() as u8;
            let out = if let Some(amp) = case.get("amp").and_then(|a| a.as_u64()) {
                let seed: Vec<u64> = case["seed"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| u64::from_str_radix(x.as_str().unwrap(), 16).unwrap())
                    .collect();
                let q = Quantum {
                    q_birth: case["qBirth"].as_u64().unwrap() as u16,
                    q_survive: case["qSurvive"].as_u64().unwrap() as u16,
                    amp: amp as u8,
                    seed: [seed[0], seed[1], seed[2], seed[3]],
                };
                step_n_q(&input, b, s, &q, case["gen0"].as_u64().unwrap(), gens)
            } else {
                step_n(&input, b, s, gens)
            };
            assert_eq!(out, expected, "case {}", case["name"]);
            let counts: Vec<u64> = case["counts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_u64().unwrap())
                .collect();
            let got: Vec<u64> = territory_counts(&out).iter().map(|&x| x as u64).collect();
            assert_eq!(got, counts);
        }
    }
}
