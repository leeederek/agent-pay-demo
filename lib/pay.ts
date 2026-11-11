// How an agent pays: a fetch that handles HTTP 402 over MPP, paying from the Privy wallet.
// The harness creates this and hands it to the agent (see lib/agent.ts), so it controls the wallet.
import { Mppx, tempo } from "mppx/client";
import type { PayFn } from "./agent.ts";
import { USD_TOKEN } from "./policy.ts";
import { paymentAccount } from "./wallet.ts";

export function createPay(): PayFn {
  const mppx = Mppx.create({
    // mppx leaves the fee token out by default; our policy requires fees in pathUSD, so set it.
    methods: [tempo({ account: paymentAccount(), feeToken: USD_TOKEN })],
    // Don't patch the global fetch: only calls made through PayFn can spend.
    polyfill: false,
  });
  return ({ url }) => mppx.fetch(url);
}
