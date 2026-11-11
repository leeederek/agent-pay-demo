// Check first #1: does Privy's policy engine evaluate the Tempo transaction mppx asks it to sign?
// Builds the same kind of transaction mppx builds (a Tempo tx whose call is transferWithMemo on the
// USD token) and asks Privy to sign three versions. Signs only, never sends, so no funds are needed.
import type { Hex } from "viem";
import { requireEnv } from "../lib/env.ts";
import { PER_PAYMENT_CAP_USD } from "../lib/policy.ts";
import { paymentTransaction } from "../lib/tempo.ts";
import { signPayment } from "../lib/wallet.ts";

const depositAddress = requireEnv("TEMPO_DEPOSIT_ADDRESS") as Hex;
const offAllowlist: Hex = "0x000000000000000000000000000000000000dEaD";

const cases = [
  { label: "under cap, allowed recipient", amountUsd: "0.01", recipient: depositAddress, expect: "ALLOWED" },
  { label: "over cap", amountUsd: "0.10", recipient: depositAddress, expect: "REFUSED" },
  { label: "recipient off allowlist", amountUsd: "0.01", recipient: offAllowlist, expect: "REFUSED" },
] as const;

console.log(`Wallet ${requireEnv("PRIVY_WALLET_ADDRESS")}, per-payment cap $${PER_PAYMENT_CAP_USD}\n`);

let passed = 0;
for (const c of cases) {
  const { decision } = await signPayment({
    amountUsd: c.amountUsd,
    recipient: c.recipient,
    tx: paymentTransaction({ recipient: c.recipient, amountUsd: c.amountUsd }),
  });
  const ok = decision === c.expect;
  if (ok) passed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${c.label} (expected ${c.expect})\n`);
}

console.log(`Result: ${passed}/${cases.length} cases behaved as expected.`);
if (passed !== cases.length) process.exitCode = 1;
