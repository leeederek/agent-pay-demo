// The spending policy: its values, its rules, and attaching it to the agent's wallet.
// The only place policy rules are defined. Scripts and agents call this; they never build rules themselves.
import { parseUnits, toHex, type Hex } from "viem";
import { requireEnv } from "./env.ts";
import { authorizationContext, authorizationPublicKey, privyClient } from "./privy.ts";

export const TEMPO_TESTNET_CHAIN_ID = 42431;

// Stablecoin Stripe accepts at our Tempo deposit address (from `npm run check:stripe`).
export const USD_TOKEN: Hex = "0x20c0000000000000000000000000000000000000";
export const USD_TOKEN_DECIMALS = 6;

// Check #1 uses a deliberately tiny cap so it's easy to exceed.
export const PER_PAYMENT_CAP_USD = "0.05";

// How long an allowance lasts from `npm run policy:create`. The demo passes a short one with --window.
export const DEFAULT_WINDOW_SECONDS = 60 * 60;

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

// Rules: Tempo testnet only, the USD token only, recipient = Stripe deposit address, amount <= cap,
// fees paid in the USD token, and a time window: Privy refuses to sign after the window ends, and refuses
// any transaction whose valid_before is later than the end. Tempo then refuses to execute a signed
// payment after its valid_before, so a signature held past the window is worthless.
// The policy is owned by our authorization key, so the app secret alone can't loosen it.
// Creates a fresh policy (and a fresh window) and replaces the one on the wallet.
export async function createAndAttachPolicy({ windowSeconds = DEFAULT_WINDOW_SECONDS } = {}) {
  const walletId = requireEnv("PRIVY_WALLET_ID");
  const recipient = requireEnv("TEMPO_DEPOSIT_ADDRESS").toLowerCase();
  const cap = toHex(parseUnits(PER_PAYMENT_CAP_USD, USD_TOKEN_DECIMALS));
  const windowEndsAt = Math.floor(Date.now() / 1000) + windowSeconds;
  const privy = privyClient();

  const policy = await privy.policies().create({
    version: "1.0",
    name: `Allowance: pay Stripe up to $${PER_PAYMENT_CAP_USD} per payment until ${new Date(windowEndsAt * 1000).toISOString()}`,
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

  await privy.wallets().update(walletId, {
    policy_ids: [policy.id],
    authorization_context: authorizationContext(),
  });

  return { policyId: policy.id, walletId, recipient, cap, windowEndsAt };
}

// When the wallet's current allowance window ends (unix seconds), read back from the policy in Privy,
// so scripts and the agent don't need it in .env.
export async function currentWindowEndsAt(): Promise<number> {
  const policy = await privyClient().policies().get(requireEnv("PRIVY_POLICY_ID"));
  const condition = policy.rules
    .flatMap((rule) => rule.conditions)
    .find((c) => c.field_source === "system" && c.field === "current_unix_timestamp");
  if (!condition) throw new Error(`Policy ${policy.id} has no time window. Re-run npm run policy:create.`);
  return Number(condition.value);
}
