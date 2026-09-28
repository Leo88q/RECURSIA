//! Quantum layer — pure functions (no accounts), mirrored in
//! `packages/sdk/src/quantum.ts` and cross-checked by shared vectors.
//!
//! Entropy sources:
//!  * Measurements with money at stake (superposition collapse, SWAP) use the
//!    ORAO VRF (checklist #21): the request seed is fixed when the position is
//!    opened and includes the latest slot hash at that moment, so nobody can
//!    pre-request randomness for a seed and open the position only if it is
//!    favourable; a block leader can't reroll by skipping a slot either.
//!  * Quantum *ticks* (physics noise, no single tick carries a stake) use the
//!    `SlotHashes` entry of a slot FIXED IN ADVANCE by the tick schedule.

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::hash::hashv;

use crate::constants::SLOT_HASHES_MAX;
use crate::sim::Quantum;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotHashLookup {
    /// First produced slot at or after the target, and the target is inside the window.
    Found { slot: u64, hash: [u8; 32] },
    /// The target already fell out of the 512-entry window. `oldest` is the oldest entry.
    Expired { oldest: [u8; 32] },
    /// No produced slot ≥ target yet. `newest` is the most recent entry.
    NotYet { newest: [u8; 32] },
}

fn entry(data: &[u8], i: usize) -> Option<(u64, [u8; 32])> {
    let off = 8usize.checked_add(i.checked_mul(40)?)?;
    let e = data.get(off..off + 40)?;
    let mut s = [0u8; 8];
    s.copy_from_slice(&e[..8]);
    let mut h = [0u8; 32];
    h.copy_from_slice(&e[8..40]);
    Some((u64::from_le_bytes(s), h))
}

/// Binary search the raw `SlotHashes` sysvar data (bincode `Vec<(u64, [u8;32])>`,
/// sorted by slot DESCENDING) for the smallest slot ≥ `target`. O(log 512).
pub fn slot_hash_lookup(data: &[u8], target: u64) -> Option<SlotHashLookup> {
    let mut l = [0u8; 8];
    l.copy_from_slice(data.get(..8)?);
    let len = (u64::from_le_bytes(l) as usize).min(SLOT_HASHES_MAX);
    if len == 0 {
        return None;
    }
    let (s0, h0) = entry(data, 0)?;
    if s0 < target {
        return Some(SlotHashLookup::NotYet { newest: h0 });
    }
    let (sl, hl) = entry(data, len - 1)?;
    if sl >= target {
        // A young cluster (len < 512) still holds every produced slot.
        return Some(if sl == target || len < SLOT_HASHES_MAX {
            SlotHashLookup::Found { slot: sl, hash: hl }
        } else {
            SlotHashLookup::Expired { oldest: hl }
        });
    }
    // invariant: slot[lo] >= target > slot[hi]
    let (mut lo, mut hi) = (0usize, len - 1);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if entry(data, mid)?.0 >= target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let (s, h) = entry(data, lo)?;
    Some(SlotHashLookup::Found { slot: s, hash: h })
}

// ------------------------------------------------------------------ ORAO VRF

/// ORAO VRF program (same id on mainnet-beta and devnet).
pub const ORAO_VRF_ID: Pubkey = Pubkey::new_from_array([
    7, 71, 177, 26, 250, 145, 180, 209, 249, 34, 242, 123, 14, 186, 193, 218, 178, 59, 33, 41, 164, 190, 243, 79, 50,
    164, 123, 88, 245, 206, 252, 120,
]);
/// PDA seed of an ORAO randomness request: `[ORAO_RANDOMNESS_SEED, seed]`.
pub const ORAO_RANDOMNESS_SEED: &[u8] = b"orao-vrf-randomness-request";
/// Anchor discriminator of ORAO's `RandomnessV2` account = sha256("account:RandomnessV2")[..8].
pub const ORAO_RANDOMNESS_V2_DISC: [u8; 8] = [139, 239, 184, 215, 227, 86, 191, 226];

/// The most recent entry of the raw `SlotHashes` sysvar (hash of the previous slot).
pub fn latest_slot_hash(data: &[u8]) -> Option<[u8; 32]> {
    let mut l = [0u8; 8];
    l.copy_from_slice(data.get(..8)?);
    if u64::from_le_bytes(l) == 0 {
        return None;
    }
    entry(data, 0).map(|(_, h)| h)
}

/// VRF request seed of a superposition: bound to the world, the cell, the
/// commitment and the latest slot hash at commit time (unknown in advance).
pub fn vrf_seed_superposition(world: &[u8; 32], index: u8, commitment: &[u8; 32], recent: &[u8; 32]) -> [u8; 32] {
    hashv(&[b"recursia/vrf/psi/v1", world, &[index], commitment, recent]).to_bytes()
}

/// VRF request seed of an accepted SWAP (fixed at acceptance).
pub fn vrf_seed_swap(swap: &[u8; 32], recent: &[u8; 32], accept_slot: u64) -> [u8; 32] {
    hashv(&[b"recursia/vrf/swap/v1", swap, recent, &accept_slot.to_le_bytes()]).to_bytes()
}

/// Randomness of a FULFILLED ORAO `RandomnessV2` account whose seed is `seed`.
/// Layout: [8 disc][1 tag: 0 Pending | 1 Fulfilled][client 32][seed 32][randomness 64].
/// `None` while pending, for a foreign account type, or for another seed.
pub fn orao_fulfilled(data: &[u8], seed: &[u8; 32]) -> Option<[u8; 64]> {
    if data.get(..8)? != ORAO_RANDOMNESS_V2_DISC || *data.get(8)? != 1 || data.get(41..73)? != seed {
        return None;
    }
    let mut r = [0u8; 64];
    r.copy_from_slice(data.get(73..137)?);
    // an all-zero value is never a valid ed25519-derived output
    if r.iter().all(|b| *b == 0) {
        return None;
    }
    Some(r)
}

/// Measurement entropy derived from VRF output (domain-separated).
pub fn entropy_from_vrf(randomness: &[u8; 64]) -> [u8; 32] {
    hashv(&[b"recursia/vrf/entropy/v1", randomness]).to_bytes()
}

/// Per-tick quantum seed: bound to the scheduled slot hash, the world and the
/// generation, so two worlds (or two ticks) never share randomness.
pub fn quantum_seed(slot_hash: &[u8; 32], world: &[u8; 32], generation: u64) -> [u64; 4] {
    let d = hashv(&[b"recursia:q", slot_hash, world, &generation.to_le_bytes()]).to_bytes();
    let mut out = [0u64; 4];
    for (k, o) in out.iter_mut().enumerate() {
        let mut w = [0u8; 8];
        w.copy_from_slice(&d[k * 8..k * 8 + 8]);
        *o = u64::from_le_bytes(w);
    }
    out
}

pub fn make_quantum(q_birth: u16, q_survive: u16, amp: u8, seed: [u64; 4]) -> Quantum {
    Quantum { q_birth, q_survive, amp, seed }
}

/// Commitment to a superposition |ψ⟩ = √w·|A⟩ + √(1−w)·|B⟩. Bound to owner,
/// world and territory so a commitment cannot be copied by someone else.
pub fn commitment(
    pattern_a: u64,
    pattern_b: u64,
    weight_bps: u16,
    salt: &[u8; 32],
    owner: &[u8; 32],
    world: &[u8; 32],
    index: u8,
) -> [u8; 32] {
    hashv(&[
        b"recursia:psi",
        &pattern_a.to_le_bytes(),
        &pattern_b.to_le_bytes(),
        &weight_bps.to_le_bytes(),
        salt,
        owner,
        world,
        &[index],
    ])
    .to_bytes()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Collapse {
    /// true → branch A (primary territory gets A, entangled partner gets B).
    pub branch_a: bool,
    /// Pattern tunnels into a neighbouring block too.
    pub tunnel: bool,
    /// 0=N 1=E 2=S 3=W (torus neighbour of the block).
    pub tunnel_dir: u8,
}

/// Measurement outcome. `roll` uses 32 bits mod 10 000 (bias < 3e-6).
pub fn collapse(entropy: &[u8; 32], commitment: &[u8; 32], weight_bps: u16) -> Collapse {
    let r = hashv(&[b"recursia:collapse", entropy, commitment]).to_bytes();
    let roll = u32::from_le_bytes([r[0], r[1], r[2], r[3]]) % 10_000;
    Collapse { branch_a: roll < weight_bps as u32, tunnel: r[4] < crate::constants::TUNNEL_CHANCE_256, tunnel_dir: r[5] & 3 }
}

/// Neighbouring territory on the 8×8 territory torus.
pub fn neighbour(idx: u8, dir: u8) -> u8 {
    let (x, y) = (idx % 8, idx / 8);
    let (nx, ny) = match dir & 3 {
        0 => (x, (y + 7) % 8),
        1 => ((x + 1) % 8, y),
        2 => (x, (y + 1) % 8),
        _ => ((x + 7) % 8, y),
    };
    ny * 8 + nx
}

#[cfg(test)]
mod vrf_tests {
    use super::*;

    fn fulfilled(seed: &[u8; 32], r: u8) -> Vec<u8> {
        let mut d = ORAO_RANDOMNESS_V2_DISC.to_vec();
        d.push(1);
        d.extend_from_slice(&[9u8; 32]);
        d.extend_from_slice(seed);
        d.extend_from_slice(&[r; 64]);
        d.resize(8 + 1 + 32 + 32 + 4 + 96 * 7, 0); // allocated as PENDING_SIZE
        d
    }

    #[test]
    fn orao_parsing_accepts_only_fulfilled_matching_seed() {
        let seed = [3u8; 32];
        assert_eq!(orao_fulfilled(&fulfilled(&seed, 7), &seed), Some([7u8; 64]));
        assert_eq!(orao_fulfilled(&fulfilled(&seed, 7), &[4u8; 32]), None, "other seed");
        let mut pending = fulfilled(&seed, 7);
        pending[8] = 0;
        assert_eq!(orao_fulfilled(&pending, &seed), None, "pending");
        let mut foreign = fulfilled(&seed, 7);
        foreign[0] ^= 1;
        assert_eq!(orao_fulfilled(&foreign, &seed), None, "foreign account type");
        assert_eq!(orao_fulfilled(&fulfilled(&seed, 0), &seed), None, "zero randomness");
        assert_eq!(orao_fulfilled(&fulfilled(&seed, 7)[..100], &seed), None, "truncated");
    }

    #[test]
    fn seeds_are_domain_separated_and_bound_to_inputs() {
        let (w, c, h) = ([1u8; 32], [2u8; 32], [5u8; 32]);
        let a = vrf_seed_superposition(&w, 1, &c, &h);
        assert_ne!(a, vrf_seed_superposition(&w, 2, &c, &h));
        assert_ne!(a, vrf_seed_superposition(&w, 1, &c, &[6u8; 32]));
        assert_ne!(vrf_seed_swap(&w, &h, 10), vrf_seed_swap(&w, &h, 11));
        assert_ne!(entropy_from_vrf(&[1u8; 64]), entropy_from_vrf(&[2u8; 64]));
    }

    #[test]
    fn latest_slot_hash_reads_the_first_entry() {
        let mut d = 2u64.to_le_bytes().to_vec();
        d.extend_from_slice(&100u64.to_le_bytes());
        d.extend_from_slice(&[8u8; 32]);
        d.extend_from_slice(&99u64.to_le_bytes());
        d.extend_from_slice(&[7u8; 32]);
        assert_eq!(latest_slot_hash(&d), Some([8u8; 32]));
        assert_eq!(latest_slot_hash(&0u64.to_le_bytes()), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sysvar(slots: &[u64]) -> Vec<u8> {
        let mut d = (slots.len() as u64).to_le_bytes().to_vec();
        for &s in slots {
            d.extend_from_slice(&s.to_le_bytes());
            let mut h = [0u8; 32];
            h[..8].copy_from_slice(&s.to_le_bytes());
            d.extend_from_slice(&h);
        }
        d
    }
    fn h(s: u64) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[..8].copy_from_slice(&s.to_le_bytes());
        h
    }

    #[test]
    fn lookup_finds_first_produced_slot_at_or_after_target() {
        // descending, with skipped slots 97 and 95
        let d = sysvar(&[100, 99, 98, 96, 94, 93]);
        assert_eq!(slot_hash_lookup(&d, 98), Some(SlotHashLookup::Found { slot: 98, hash: h(98) }));
        assert_eq!(slot_hash_lookup(&d, 97), Some(SlotHashLookup::Found { slot: 98, hash: h(98) }));
        assert_eq!(slot_hash_lookup(&d, 95), Some(SlotHashLookup::Found { slot: 96, hash: h(96) }));
        assert_eq!(slot_hash_lookup(&d, 93), Some(SlotHashLookup::Found { slot: 93, hash: h(93) }));
        assert_eq!(slot_hash_lookup(&d, 101), Some(SlotHashLookup::NotYet { newest: h(100) }));
        // young cluster (len < 512): oldest entry is authoritative
        assert_eq!(slot_hash_lookup(&d, 10), Some(SlotHashLookup::Found { slot: 93, hash: h(93) }));
    }

    #[test]
    fn lookup_expires_when_window_full() {
        let slots: Vec<u64> = (0..SLOT_HASHES_MAX as u64).map(|i| 10_000 - i).collect();
        let d = sysvar(&slots);
        let oldest = 10_000 - (SLOT_HASHES_MAX as u64 - 1);
        assert_eq!(slot_hash_lookup(&d, oldest - 1), Some(SlotHashLookup::Expired { oldest: h(oldest) }));
        assert_eq!(slot_hash_lookup(&d, oldest), Some(SlotHashLookup::Found { slot: oldest, hash: h(oldest) }));
        for t in [oldest + 1, 9_700, 9_999, 10_000] {
            assert_eq!(slot_hash_lookup(&d, t), Some(SlotHashLookup::Found { slot: t, hash: h(t) }));
        }
    }

    #[test]
    fn lookup_rejects_malformed() {
        assert_eq!(slot_hash_lookup(&[], 1), None);
        assert_eq!(slot_hash_lookup(&0u64.to_le_bytes(), 1), None);
        let mut d = sysvar(&[5, 4]);
        d.truncate(30);
        assert_eq!(slot_hash_lookup(&d, 4), None);
    }

    #[test]
    fn collapse_respects_weight_extremes() {
        let e = [7u8; 32];
        for i in 0..64u8 {
            let c = [i; 32];
            assert!(collapse(&e, &c, 10_000).branch_a);
            assert!(!collapse(&e, &c, 0).branch_a);
        }
    }

    #[test]
    fn collapse_is_roughly_fair() {
        let mut a = 0;
        let mut t = 0;
        for i in 0..4000u32 {
            let mut c = [0u8; 32];
            c[..4].copy_from_slice(&i.to_le_bytes());
            let r = collapse(&[1u8; 32], &c, 3_000);
            a += r.branch_a as u32;
            t += r.tunnel as u32;
        }
        assert!((1_050..1_350).contains(&a), "branch A {a}/4000 for w=30%");
        assert!((150..350).contains(&t), "tunnel {t}/4000 for p=1/16");
    }

    #[test]
    fn neighbours_wrap_on_territory_torus() {
        assert_eq!(neighbour(0, 0), 56);
        assert_eq!(neighbour(0, 3), 7);
        assert_eq!(neighbour(63, 1), 56);
        assert_eq!(neighbour(63, 2), 7);
        assert_eq!(neighbour(9, 1), 10);
    }

    #[test]
    fn commitment_binds_every_field() {
        let base = commitment(1, 2, 5000, &[3; 32], &[4; 32], &[5; 32], 6);
        assert_ne!(base, commitment(2, 1, 5000, &[3; 32], &[4; 32], &[5; 32], 6));
        assert_ne!(base, commitment(1, 2, 5001, &[3; 32], &[4; 32], &[5; 32], 6));
        assert_ne!(base, commitment(1, 2, 5000, &[3; 32], &[9; 32], &[5; 32], 6));
        assert_ne!(base, commitment(1, 2, 5000, &[3; 32], &[4; 32], &[5; 32], 7));
    }

    fn b32(s: &serde_json::Value) -> [u8; 32] {
        let s = s.as_str().unwrap();
        let mut o = [0u8; 32];
        for (i, b) in o.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        o
    }

    /// Same vectors as the TypeScript SDK (packages/sdk/scripts/gen-vectors.ts).
    #[test]
    fn shared_quantum_vectors() {
        let raw = include_str!("../../../tests/vectors/quantum.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert_eq!(hashv(&[]).to_bytes(), b32(&v["hashvEmpty"]));
        for c in v["cases"].as_array().unwrap() {
            let slot_hash = b32(&c["slotHash"]);
            let world = b32(&c["world"]);
            let seed = quantum_seed(&slot_hash, &world, c["gen"].as_u64().unwrap());
            for (k, s) in c["seed"].as_array().unwrap().iter().enumerate() {
                assert_eq!(seed[k], u64::from_str_radix(s.as_str().unwrap(), 16).unwrap());
            }
            let a = u64::from_str_radix(c["a"].as_str().unwrap(), 16).unwrap();
            let b = u64::from_str_radix(c["b"].as_str().unwrap(), 16).unwrap();
            let w = c["weight"].as_u64().unwrap() as u16;
            let idx = c["index"].as_u64().unwrap() as u8;
            let com = commitment(a, b, w, &b32(&c["salt"]), &b32(&c["owner"]), &world, idx);
            assert_eq!(com, b32(&c["commitment"]));
            let col = collapse(&slot_hash, &com, w);
            assert_eq!(col.branch_a, c["branchA"].as_bool().unwrap());
            assert_eq!(col.tunnel, c["tunnel"].as_bool().unwrap());
            assert_eq!(col.tunnel_dir as u64, c["tunnelDir"].as_u64().unwrap());
            assert_eq!(neighbour(idx, col.tunnel_dir) as u64, c["neighbour"].as_u64().unwrap());
        }
    }
}
