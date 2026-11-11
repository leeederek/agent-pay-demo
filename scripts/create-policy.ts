// Creates the spending policy and attaches it to the agent's wallet. Rules live in lib/policy.ts.
// Re-running creates a fresh policy and replaces the one on the wallet.
import { createAndAttachPolicy, PER_PAYMENT_CAP_USD } from "../lib/policy.ts";

const { policyId, walletId, recipient, cap } = await createAndAttachPolicy();

console.log(`Policy ${policyId} created and attached to wallet ${walletId}.`);
console.log(`Per-payment cap: $${PER_PAYMENT_CAP_USD} (${cap} base units). Recipient: ${recipient}`);
console.log(`\nAdd to .env:\nPRIVY_POLICY_ID=${policyId}`);
