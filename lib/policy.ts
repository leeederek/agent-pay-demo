// Shared values for the spending policy and the payments it governs.
import type { Hex } from "viem";

export const TEMPO_TESTNET_CHAIN_ID = 42431;

// Stablecoin Stripe accepts at our Tempo deposit address (from `npm run check:stripe`).
export const USD_TOKEN: Hex = "0x20c0000000000000000000000000000000000000";
export const USD_TOKEN_DECIMALS = 6;

// Check #1 uses a deliberately tiny cap so it's easy to exceed.
export const PER_PAYMENT_CAP_USD = "0.05";
