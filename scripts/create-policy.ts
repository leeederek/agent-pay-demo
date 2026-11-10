// Creates the spending policy and attaches it to the agent's wallet.
// Rules: Tempo testnet only, the USD token only, recipient = Stripe deposit address, amount <= cap.
// The policy is owned by our authorization key, so the app secret alone can't loosen it.
// Re-running creates a fresh policy and replaces the one on the wallet.
import { parseUnits, toHex } from "viem";
import { requireEnv } from "../lib/env.ts";
import { PER_PAYMENT_CAP_USD, TEMPO_TESTNET_CHAIN_ID, USD_TOKEN, USD_TOKEN_DECIMALS } from "../lib/policy.ts";
import { authorizationContext, authorizationPublicKey, privyClient } from "../lib/privy.ts";

const walletId = requireEnv("PRIVY_WALLET_ID");
const recipient = requireEnv("TEMPO_DEPOSIT_ADDRESS").toLowerCase();
const cap = toHex(parseUnits(PER_PAYMENT_CAP_USD, USD_TOKEN_DECIMALS));

// The token function mppx calls for each payment (TIP-20 transferWithMemo).
const transferWithMemoAbi = [
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

const privy = privyClient();

const policy = await privy.policies().create({
  version: "1.0",
  name: `Allowance: pay Stripe up to $${PER_PAYMENT_CAP_USD} per payment`,
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
      ],
    },
  ],
});

await privy.wallets().update(walletId, {
  policy_ids: [policy.id],
  authorization_context: authorizationContext(),
});

console.log(`Policy ${policy.id} created and attached to wallet ${walletId}.`);
console.log(`Per-payment cap: $${PER_PAYMENT_CAP_USD} (${cap} base units). Recipient: ${recipient}`);
console.log(`\nAdd to .env:\nPRIVY_POLICY_ID=${policy.id}`);
