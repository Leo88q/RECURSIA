import { DEFAULT_PARAMS, ONE, type Params } from "../src/constants.js";

/**
 * Rule tests are price-independent: they run on small "unit" prices (the
 * shape of the economy — splits, caps, emission rate — is the real default).
 * The real SKR price list is asserted separately in skr.test.ts.
 */
export const P: Params = {
  ...DEFAULT_PARAMS,
  worldCreateFee: 1_000n * ONE,
  moduleRegisterFee: 5_000n * ONE,
  tickCost: 10n * ONE,
  minPrice: 10n * ONE,
  plantCost: 5n * ONE,
};
