// Check first #1: does Privy's policy engine evaluate the Tempo transaction mppx asks it to sign?
// Builds the same kind of transaction mppx builds (a Tempo tx whose call is transferWithMemo on the
// USD token) and asks Privy to sign three versions. Signs only, never sends, so no funds are needed.
import { encodeFunctionData, pad, parseUnits, type Hex } from "viem";
import { Abis } from "viem/tempo";
import { requireEnv } from "../lib/env.ts";
import { logAttempt } from "../lib/log.ts";
import { PER_PAYMENT_CAP_USD, TEMPO_TESTNET_CHAIN_ID, USD_TOKEN, USD_TOKEN_DECIMALS } from "../lib/policy.ts";
import { agentAccount } from "../lib/privy.ts";

const depositAddress = requireEnv("TEMPO_DEPOSIT_ADDRESS") as Hex;
const offAllowlist: Hex = "0x000000000000000000000000000000000000dEaD";

const cases = [
  { label: "under cap, allowed recipient", amountUsd: "0.01", recipient: depositAddress, expect: "ALLOWED" },
  { label: "over cap", amountUsd: "0.10", recipient: depositAddress, expect: "REFUSED" },
  { label: "recipient off allowlist", amountUsd: "0.01", recipient: offAllowlist, expect: "REFUSED" },
] as const;

const account = agentAccount();
console.log(`Wallet ${account.address}, per-payment cap $${PER_PAYMENT_CAP_USD}\n`);

let passed = 0;
for (const c of cases) {
  const data = encodeFunctionData({
    abi: Abis.tip20,
    functionName: "transferWithMemo",
    args: [c.recipient, parseUnits(c.amountUsd, USD_TOKEN_DECIMALS), pad("0x01")],
  });
  // Gas and fee values only need to be plausible: this transaction is signed, never broadcast.
  const tx = {
    type: "tempo" as const,
    chainId: TEMPO_TESTNET_CHAIN_ID,
    calls: [{ to: USD_TOKEN, data }],
    nonce: 0,
    gas: 100_000n,
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 0n,
    feeToken: USD_TOKEN,
    validBefore: Math.floor(Date.now() / 1000) + 60,
  };

  let decision: "ALLOWED" | "REFUSED";
  let reason: string;
  let reference: string | undefined;
  try {
    const signed = await account.signTransaction(tx);
    decision = "ALLOWED";
    reason = "policy allowed signing";
    reference = `${signed.slice(0, 18)}…`;
  } catch (err) {
    decision = "REFUSED";
    reason = err instanceof Error ? err.message.replace(/\s+/g, " ") : String(err);
  }

  logAttempt({ amountUsd: c.amountUsd, recipient: c.recipient, decision, reason, reference });
  const ok = decision === c.expect;
  if (ok) passed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${c.label} (expected ${c.expect})\n`);
}

console.log(`Result: ${passed}/${cases.length} cases behaved as expected.`);
if (passed !== cases.length) process.exitCode = 1;
