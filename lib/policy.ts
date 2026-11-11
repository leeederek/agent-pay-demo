// The spending policy: its rules, and attaching it to the agent's wallet.
// The only place policy rules are defined. Scripts and agents call this; they never build rules themselves.
import { formatUnits, parseUnits, toHex, type Hex } from "viem";
import { requireEnv } from "./env.ts";
import type { Allowance } from "./presets.ts";
import { authorizationContext, authorizationPublicKey, privyClient } from "./privy.ts";

export const TEMPO_TESTNET_CHAIN_ID = 42431;

// Stablecoin Stripe accepts at our Tempo deposit address (from `npm run check:stripe`).
export const USD_TOKEN: Hex = "0x20c0000000000000000000000000000000000000";
export const USD_TOKEN_DECIMALS = 6;

// The token function mppx calls for each payment (TIP-20 transferWithMemo).
export const transferWithMemoAbi = [
  {
    type: "function" as const,
    name: "transferWithMemo",
    stateMutability: "nonpayable" as const,
    inputs: [
      { type: "address", name: "to" },
      { type: "uint256", name: "amount" },
      { type: "bytes32", name: "memo" },
    ],
    outputs: [],
  },
];

// Rules: Tempo testnet only, the USD token only, recipient = the allowed merchant, amount <= cap,
// fees paid in the USD token, and a time window: Privy refuses to sign after the window ends, and refuses
// any transaction whose valid_before is later than the end. Tempo then refuses to execute a signed
// payment after its valid_before, so a signature held past the window is worthless.
// The policy is owned by our authorization key, so the app secret alone can't loosen it.
// Creates a fresh policy (and a fresh window), replaces the one on the wallet, and deletes the old one.
export async function createAndAttachPolicy(allowance: Allowance & { presetName: string }) {
  const walletId = requireEnv("PRIVY_WALLET_ID");
  const recipient = allowance.merchant.toLowerCase();
  const cap = toHex(parseUnits(allowance.perPaymentCapUsd, USD_TOKEN_DECIMALS));
  const windowEndsAt = Math.floor(Date.now() / 1000) + allowance.windowSeconds;
  const privy = privyClient();

  const policy = await privy.policies().create({
    version: "1.0",
    name: `Allowance (${allowance.presetName}): up to $${allowance.perPaymentCapUsd} per payment until ${new Date(windowEndsAt * 1000).toISOString()}`,
    chain_type: "ethereum",
    owner: { public_key: authorizationPublicKey() },
    rules: [
      {
        name: "pay stripe up to payment cap",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(TEMPO_TESTNET_CHAIN_ID) },
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: USD_TOKEN },
          { field_source: "ethereum_calldata", field: "transferWithMemo.to", operator: "eq", value: recipient, abi: transferWithMemoAbi },
          { field_source: "ethereum_calldata", field: "transferWithMemo.amount", operator: "lte", value: cap, abi: transferWithMemoAbi },
          { field_source: "tempo_transaction", field: "fee_token", operator: "eq", value: USD_TOKEN },
          { field_source: "system", field: "current_unix_timestamp", operator: "lte", value: String(windowEndsAt) },
          { field_source: "tempo_transaction", field: "valid_before", operator: "lte", value: String(windowEndsAt) },
        ],
      },
    ],
  });

  const previous = (await privy.wallets().get(walletId)).policy_ids ?? [];
  await privy.wallets().update(walletId, {
    policy_ids: [policy.id],
    authorization_context: authorizationContext(),
  });

  // The replaced policies are no longer attached to anything; delete them so they don't pile up.
  const deleted: string[] = [];
  for (const id of previous.filter((id) => id !== policy.id)) {
    await privy.policies().delete(id, { authorization_context: authorizationContext() });
    deleted.push(id);
  }

  return { policyId: policy.id, walletId, recipient, cap, windowEndsAt, deleted };
}

// The allowance currently in force, read back from the policy attached to the wallet in Privy, so it's
// always the live one and nothing needs updating in .env.
export async function currentAllowance(): Promise<{
  policyId: string;
  name: string;
  perPaymentCapUsd: string;
  merchant: Hex;
  // Unix seconds. The window opens when the policy is created.
  windowStartedAt: number;
  windowEndsAt: number;
}> {
  const privy = privyClient();
  const [policyId] = (await privy.wallets().get(requireEnv("PRIVY_WALLET_ID"))).policy_ids ?? [];
  if (!policyId) throw new Error("The wallet has no policy attached. Run npm run policy:create.");
  const policy = await privy.policies().get(policyId);
  const conditions = policy.rules.flatMap((rule) => rule.conditions);
  const find = (source: string, field: string) => {
    const c = conditions.find((c) => c.field_source === source && c.field === field);
    if (!c) throw new Error(`Policy ${policy.id} has no ${field} rule. Re-run npm run policy:create.`);
    return String(c.value);
  };
  return {
    policyId: policy.id,
    name: policy.name,
    perPaymentCapUsd: formatUnits(BigInt(find("ethereum_calldata", "transferWithMemo.amount")), USD_TOKEN_DECIMALS),
    merchant: find("ethereum_calldata", "transferWithMemo.to") as Hex,
    windowStartedAt: Math.floor(policy.created_at / 1000),
    windowEndsAt: Number(find("system", "current_unix_timestamp")),
  };
}
