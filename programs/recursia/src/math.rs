//! Pure, checked economic math. Every function here is unit-tested and
//! mirrored in `packages/sdk/src/economy.ts`.

use anchor_lang::prelude::*;

use crate::constants::{BPS, TERRITORIES};
use crate::errors::RecursiaError;

#[inline]
pub fn bps_floor(amount: u64, bps: u64) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(RecursiaError::MathOverflow)?
        / BPS as u128;
    u64::try_from(v).map_err(|_| RecursiaError::MathOverflow.into())
}

#[inline]
pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(RecursiaError::MathOverflow.into())
}

#[inline]
pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(RecursiaError::MathOverflow.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickSplit {
    pub cranker: u64,
    pub protocol: u64,
    pub host: u64,
    pub royalty: u64,
    pub burn: u64,
}

/// Split a tick cost. All shares are floored; the burn takes the remainder,
/// so `sum == cost` exactly and rounding never favours a recipient (#15).
pub fn split_tick(
    cost: u64,
    cranker_bps: u16,
    protocol_bps: u16,
    host_bps: u16,
    royalty_bps: u16,
    has_host: bool,
) -> Result<TickSplit> {
    let cranker = bps_floor(cost, cranker_bps as u64)?;
    let protocol = bps_floor(cost, protocol_bps as u64)?;
    let host = if has_host { bps_floor(cost, host_bps as u64)? } else { 0 };
    let royalty = bps_floor(cost, royalty_bps as u64)?;
    let paid = add(add(add(cranker, protocol)?, host)?, royalty)?;
    let burn = sub(cost, paid)?;
    Ok(TickSplit { cranker, protocol, host, royalty, burn })
}

/// Harberger tax accrued over `elapsed` slots, rounded UP (in favour of the
/// world, never the holder).
pub fn harberger_due(price: u64, rate_bps: u16, elapsed: u64, epoch_slots: u64) -> Result<u64> {
    if price == 0 || elapsed == 0 {
        return Ok(0);
    }
    let num = (price as u128)
        .checked_mul(rate_bps as u128)
        .and_then(|v| v.checked_mul(elapsed as u128))
        .ok_or(RecursiaError::MathOverflow)?;
    let den = (BPS as u128)
        .checked_mul(epoch_slots as u128)
        .ok_or(RecursiaError::MathOverflow)?;
    require!(den > 0, RecursiaError::MathOverflow);
    let v = num.div_ceil(den);
    Ok(u64::try_from(v).unwrap_or(u64::MAX))
}

/// Tax for a full epoch at `price` — the minimum deposit when acquiring.
pub fn epoch_tax(price: u64, rate_bps: u16) -> Result<u64> {
    let v = (price as u128)
        .checked_mul(rate_bps as u128)
        .ok_or(RecursiaError::MathOverflow)?
        .div_ceil(BPS as u128);
    u64::try_from(v).map_err(|_| RecursiaError::MathOverflow.into())
}

/// Emission a world may claim for the previous epoch:
///   min( emission * burn_w / total_burn ,  burn_w * rebate_cap )
/// Capped by the rebate so that burning tokens to farm emission is always
/// net-negative, regardless of how many wallets/worlds an attacker controls.
pub fn world_emission(
    emission: u64,
    total_burn: u64,
    burn_w: u64,
    rebate_cap_bps: u16,
    already_claimed: u64,
) -> Result<u64> {
    if total_burn == 0 || burn_w == 0 || emission == 0 {
        return Ok(0);
    }
    let pro_rata = (emission as u128)
        .checked_mul(burn_w as u128)
        .ok_or(RecursiaError::MathOverflow)?
        / total_burn as u128;
    let cap = bps_floor(burn_w, rebate_cap_bps as u64)? as u128;
    let remaining = emission.saturating_sub(already_claimed) as u128;
    let v = pro_rata.min(cap).min(remaining);
    Ok(v as u64)
}

/// Distribute `amount` across territories by score. Returns per-territory
/// shares (floored) plus the remainder (dust + unowned share), which the caller
/// sends to world energy. Invariant: sum(shares) + rest == amount.
pub fn distribute(
    amount: u64,
    scores: &[u32; TERRITORIES],
    owned: &[bool; TERRITORIES],
) -> Result<([u64; TERRITORIES], u64)> {
    let mut shares = [0u64; TERRITORIES];
    let total: u128 = scores.iter().map(|&s| s as u128).sum();
    if total == 0 || amount == 0 {
        return Ok((shares, amount));
    }
    let mut paid: u64 = 0;
    for i in 0..TERRITORIES {
        if !owned[i] || scores[i] == 0 {
            continue;
        }
        let s = (amount as u128)
            .checked_mul(scores[i] as u128)
            .ok_or(RecursiaError::MathOverflow)?
            / total;
        let s = s as u64;
        shares[i] = s;
        paid = add(paid, s)?;
    }
    let rest = sub(amount, paid)?;
    Ok((shares, rest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_split_sums_exactly() {
        for cost in [1_000u64, 1_234_567, 10_000_000, u32::MAX as u64] {
            for &(c, p, h, r) in &[(200, 1000, 1500, 500), (0, 0, 0, 0), (1, 1, 1, 1)] {
                for host in [true, false] {
                    let s = split_tick(cost, c, p, h, r, host).unwrap();
                    assert_eq!(s.cranker + s.protocol + s.host + s.royalty + s.burn, cost);
                    assert!(s.burn >= cost * 3000 / 10_000 - 1);
                }
            }
        }
    }

    #[test]
    fn harberger_rounds_up_and_scales() {
        assert_eq!(harberger_due(0, 50, 100, 1000).unwrap(), 0);
        assert_eq!(harberger_due(10_000, 50, 1, 216_000).unwrap(), 1); // tiny → rounds up
        let full = harberger_due(1_000_000, 100, 216_000, 216_000).unwrap();
        assert_eq!(full, 10_000);
        assert_eq!(epoch_tax(1_000_000, 100).unwrap(), 10_000);
        // no overflow at max bounds
        assert!(harberger_due(crate::constants::MAX_PRICE, 500, u64::MAX / 2, 9_000).is_ok());
    }

    #[test]
    fn emission_cannot_exceed_burn() {
        // attacker is the only burner: pro-rata would give them everything
        let e = world_emission(1_000_000, 100, 100, 9_000, 0).unwrap();
        assert_eq!(e, 90);
        // proportional when many burners
        let e = world_emission(1_000, 1_000_000, 500_000, 9_000, 0).unwrap();
        assert_eq!(e, 500);
        // never above remaining
        let e = world_emission(1_000, 1_000, 1_000, 10_000, 990).unwrap();
        assert_eq!(e, 10);
        // property: reward <= burn * cap for many inputs
        let mut x = 7u64;
        for _ in 0..10_000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let em = x % 1_000_000_000_000;
            let tb = (x >> 20) % 1_000_000_000 + 1;
            let bw = (x >> 7) % tb + 1;
            let r = world_emission(em, tb, bw, 9_000, 0).unwrap();
            assert!(r as u128 <= bw as u128 * 9_000 / 10_000);
            assert!(r <= em);
        }
    }

    #[test]
    fn distribute_conserves() {
        let mut scores = [0u32; TERRITORIES];
        let mut owned = [false; TERRITORIES];
        for i in 0..TERRITORIES {
            scores[i] = (i as u32 * 37) % 101;
            owned[i] = i % 3 != 0;
        }
        for amount in [0u64, 1, 999, 1_000_000_007] {
            let (s, rest) = distribute(amount, &scores, &owned).unwrap();
            assert_eq!(s.iter().sum::<u64>() + rest, amount);
            for i in 0..TERRITORIES {
                if !owned[i] {
                    assert_eq!(s[i], 0);
                }
            }
        }
    }
}
