// Checks the wallet policy refuses bad Tempo payments before signing (Check first #1, plus the time window).
// Builds the same kind of transaction mppx builds (a Tempo tx whose call is transferWithMemo on the
// USD token) and asks Privy to sign each version. Signs only, never sends, so no funds are needed.
import type { Hex } from "viem";
import { requireEnv } from "../lib/env.ts";
import { currentWindowEndsAt, PER_PAYMENT_CAP_USD } from "../lib/policy.ts";
import { paymentTransaction } from "../lib/tempo.ts";
import { signPayment } from "../lib/wallet.ts";

const depositAddress = requireEnv("TEMPO_DEPOSIT_ADDRESS") as Hex;
const offAllowlist: Hex = "0x000000000000000000000000000000000000dEaD";
const otherTestToken: Hex = "0x20c0000000000000000000000000000000000001"; // AlphaUSD, also from the faucet
const windowEndsAt = await currentWindowEndsAt();

const cases = [
  { label: "under cap, allowed recipient", amountUsd: "0.50", recipient: depositAddress, expect: "ALLOWED" },
  { label: "over cap", amountUsd: "1.10", recipient: depositAddress, expect: "REFUSED" },
  { label: "recipient off allowlist", amountUsd: "0.01", recipient: offAllowlist, expect: "REFUSED" },
  { label: "no valid_before (could be held forever)", amountUsd: "0.01", recipient: depositAddress, validBefore: null, expect: "REFUSED" },
  { label: "valid_before after window ends", amountUsd: "0.01", recipient: depositAddress, validBefore: windowEndsAt + 60, expect: "REFUSED" },
  { label: "fee paid in another token", amountUsd: "0.01", recipient: depositAddress, feeToken: otherTestToken, expect: "REFUSED" },
] as const;

const secondsLeft = windowEndsAt - Math.floor(Date.now() / 1000);
console.log(`Wallet ${requireEnv("PRIVY_WALLET_ADDRESS")}, per-payment cap $${PER_PAYMENT_CAP_USD}`);
console.log(`Window ends ${new Date(windowEndsAt * 1000).toISOString()} (${secondsLeft > 0 ? `${secondsLeft}s left` : "CLOSED"})\n`);

let passed = 0;
for (const c of cases) {
  const { label, expect, ...payment } = c;
  const { decision } = await signPayment({
    amountUsd: payment.amountUsd,
    recipient: payment.recipient,
    tx: paymentTransaction(payment),
  });
  const ok = decision === expect;
  if (ok) passed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label} (expected ${expect})\n`);
}

console.log(`Result: ${passed}/${cases.length} cases behaved as expected.`);
if (passed !== cases.length) process.exitCode = 1;
