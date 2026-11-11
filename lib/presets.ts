// Policy presets: named, ready-made mandates. Each is built only from limits the wallet enforces on Tempo
// (per-payment cap, one allowed merchant, time window). No total or count limits: Privy can't enforce them on
// Tempo (see docs/DECISIONS.md), so no preset name promises one.
// Caps start at $0.50 because Stripe won't record a payment below that.
import type { Hex } from "viem";
import { requireEnv } from "./env.ts";

export type Allowance = {
  perPaymentCapUsd: string;
  // Who may be paid. One merchant for now: the Stripe deposit address.
  merchant: Hex;
  windowSeconds: number;
};

export type Preset = Allowance & { description: string };

export const DEFAULT_PRESET = "research-run";

export function presets(): Record<string, Preset> {
  const stripeDeposit = requireEnv("TEMPO_DEPOSIT_ADDRESS") as Hex;
  return {
    starter: {
      description: "Up to $0.50 a payment, the Stripe merchant only, for 15 minutes",
      perPaymentCapUsd: "0.50",
      merchant: stripeDeposit,
      windowSeconds: 15 * 60,
    },
    "research-run": {
      description: "Up to $1.00 a payment, the Stripe merchant only, for 1 hour",
      perPaymentCapUsd: "1.00",
      merchant: stripeDeposit,
      windowSeconds: 60 * 60,
    },
    "api-spender": {
      description: "Up to $1.00 a payment, the Stripe merchant only, for 24 hours",
      perPaymentCapUsd: "1.00",
      merchant: stripeDeposit,
      windowSeconds: 24 * 60 * 60,
    },
  };
}
