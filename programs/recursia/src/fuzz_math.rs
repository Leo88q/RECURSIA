//! Property fuzzing of the money math (checklist #54 "Trident / fuzz").
//!
//! Dependency-free (splitmix64, fixed seed → reproducible, no new crates in the
//! pinned SBF lockfile). Every property runs on 200k random cases mixing
//! uniform values with edge values (0, 1, u64::MAX, powers of two, BPS bounds).

use crate::constants::*;
use crate::math::*;

const CASES: usize = 200_000;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform, small, edge or "realistic token amount" — whichever breaks things.
    fn amount(&mut self) -> u64 {
        match self.next() % 6 {
            0 => [0, 1, 2, u64::MAX, u64::MAX - 1, 1 << 63, 1 << 32][(self.next() % 7) as usize],
            1 => self.next() % 1_000,
            2 => self.next() % 10_000_000_000_000_000, // ≤ 10B SKR in base units
            3 => 1u64 << (self.next() % 64),
            _ => self.next(),
        }
    }
    fn bps(&mut self, max: u64) -> u64 {
        match self.next() % 4 {
            // edge values, clamped: with max = 0 the table's `1` would exceed the bound
            0 => [0, 1, max.saturating_sub(1), max][(self.next() % 4) as usize].min(max),
            _ => self.next() % (max + 1),
        }
    }
}

#[test]
fn fuzz_split_tick_is_exact() {
    let mut r = Rng(1);
    for _ in 0..CASES {
        let cost = r.amount();
        // any split `Params::validate` could accept: shares sum ≤ BPS − MIN_TICK_POOL_BPS
        let budget = BPS - MIN_TICK_POOL_BPS;
        let c = r.bps(budget);
        let p = r.bps(budget - c);
        let h = r.bps(budget - c - p);
        let roy = r.bps((budget - c - p - h).min(MAX_ROYALTY_BPS as u64));
        let host = r.next() % 2 == 0;
        let s = split_tick(cost, c as u16, p as u16, h as u16, roy as u16, host).unwrap();
        let sum = s.cranker as u128 + s.protocol as u128 + s.host as u128 + s.royalty as u128 + s.pool as u128;
        assert_eq!(sum, cost as u128, "split_tick must conserve");
        assert!(s.pool as u128 >= (cost as u128 * MIN_TICK_POOL_BPS as u128) / BPS as u128, "pool below its floor");
        if !host {
            assert_eq!(s.host, 0);
        }
    }
}

#[test]
fn fuzz_split_spend_is_exact() {
    let mut r = Rng(2);
    for _ in 0..CASES {
        let a = r.amount();
        let b = r.bps(BPS);
        let (studio, pool) = split_spend(a, b as u16).unwrap();
        assert_eq!(studio as u128 + pool as u128, a as u128);
        assert!(studio as u128 <= a as u128 * b as u128 / BPS as u128);
    }
}

#[test]
fn fuzz_world_emission_bounded() {
    let mut r = Rng(3);
    for _ in 0..CASES {
        let (e, total, claimed) = (r.amount(), r.amount(), r.amount());
        let sink = r.amount() % total.saturating_add(1).max(1); // a world is part of the total
        let cap = r.bps(MAX_REBATE_BPS) as u16;
        let v = world_emission(e, total, sink, cap, claimed).unwrap();
        assert!(v <= e.saturating_sub(claimed), "more than what's left of the budget");
        assert!(v as u128 <= sink as u128 * cap as u128 / BPS as u128, "above the rebate cap");
        if total > 0 {
            assert!(v as u128 <= e as u128 * sink as u128 / total as u128, "above pro rata");
        }
    }
}

/// Many worlds claiming in any order never take more than the epoch budget.
#[test]
fn fuzz_world_emission_many_claims_never_exceed_budget() {
    let mut r = Rng(4);
    for _ in 0..CASES / 50 {
        let e = r.amount() % 10_000_000_000_000_000;
        let n = 1 + (r.next() % 60) as usize;
        let sinks: Vec<u64> = (0..n).map(|_| r.next() % 1_000_000_000_000_000).collect();
        let total: u64 = sinks.iter().fold(0u64, |a, s| a.saturating_add(*s));
        let cap = r.bps(MAX_REBATE_BPS) as u16;
        let mut claimed = 0u64;
        for s in &sinks {
            claimed += world_emission(e, total, *s, cap, claimed).unwrap();
        }
        assert!(claimed <= e);
    }
}

#[test]
fn fuzz_world_sponsor_bounded() {
    let mut r = Rng(5);
    for _ in 0..CASES {
        let (b, total, sink, claimed) = (r.amount(), r.amount(), r.amount(), r.amount());
        let score = r.amount() % total.saturating_add(1).max(1);
        let cap = r.bps(4 * BPS);
        let v = world_sponsor(b, total, score, sink, cap, claimed).unwrap();
        assert!(v <= b.saturating_sub(claimed));
        assert!(v as u128 <= sink as u128 * cap as u128 / BPS as u128);
    }
}

#[test]
fn fuzz_distribute_conserves_and_skips_unowned() {
    let mut r = Rng(6);
    for _ in 0..CASES / 20 {
        let amount = r.amount();
        let mut scores = [0u32; TERRITORIES];
        let mut owned = [false; TERRITORIES];
        for (s, o) in scores.iter_mut().zip(owned.iter_mut()) {
            *s = match r.next() % 4 {
                0 => 0,
                1 => u32::MAX,
                _ => (r.next() % 100_000) as u32,
            };
            *o = r.next() % 3 != 0;
        }
        let (shares, rest) = distribute(amount, &scores, &owned).unwrap();
        let paid: u128 = shares.iter().map(|&s| s as u128).sum();
        assert_eq!(paid + rest as u128, amount as u128, "distribute must conserve");
        for ((sh, sc), o) in shares.iter().zip(scores.iter()).zip(owned.iter()) {
            if !*o || *sc == 0 {
                assert_eq!(*sh, 0, "unowned / dead territory got paid");
            }
        }
    }
}

#[test]
fn fuzz_tournament_prizes_conserve_and_are_ordered() {
    let mut r = Rng(7);
    for _ in 0..CASES {
        let pot = r.amount();
        let k = (r.next() % (TOURNAMENT_TOP as u64 + 3)) as usize;
        let (p, rest) = tournament_prizes(pot, k).unwrap();
        let paid: u128 = p.iter().map(|&x| x as u128).sum();
        assert_eq!(paid + rest as u128, pot as u128);
        for w in p.windows(2) {
            assert!(w[0] >= w[1], "a lower place got more");
        }
        for (i, x) in p.iter().enumerate() {
            if i >= k.min(TOURNAMENT_TOP) {
                assert_eq!(*x, 0);
            }
        }
    }
}

#[test]
fn fuzz_season_prize_capped() {
    let mut r = Rng(8);
    for _ in 0..CASES {
        let (pool, pts) = (r.amount(), r.amount());
        let rank = r.bps(BPS);
        let v = season_prize(pool, rank, pts).unwrap();
        assert!(v as u128 <= pool as u128 * rank as u128 / BPS as u128);
        assert!(v as u128 <= pts as u128 * SEASON_PRIZE_CAP_BPS as u128 / BPS as u128);
    }
}

#[test]
fn fuzz_harberger_rounds_up_and_is_monotonic() {
    let mut r = Rng(9);
    for _ in 0..CASES {
        let price = r.amount() % 1_000_000_000_000_000_000;
        let rate = r.bps(BPS) as u16;
        let epoch = 1 + r.next() % 10_000_000;
        let e1 = r.next() % (4 * epoch);
        let e2 = e1 + r.next() % epoch;
        let (Ok(a), Ok(b)) = (harberger_due(price, rate, e1, epoch), harberger_due(price, rate, e2, epoch)) else { continue };
        assert!(a <= b, "tax decreased with time");
        let exact = price as u128 * rate as u128 * e1 as u128;
        assert!(a as u128 * BPS as u128 * epoch as u128 >= exact, "tax rounded in the holder's favour");
    }
}
