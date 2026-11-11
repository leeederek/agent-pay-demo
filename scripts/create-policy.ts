// Creates the spending policy and attaches it to the agent's wallet. Rules live in lib/policy.ts.
// Re-running creates a fresh policy and window and replaces the one on the wallet.
// Usage: npm run policy:create [-- --window <seconds>]   (default: 1 hour)
import { createAndAttachPolicy, DEFAULT_WINDOW_SECONDS, PER_PAYMENT_CAP_USD } from "../lib/policy.ts";

const flag = process.argv.indexOf("--window");
const windowSeconds = flag === -1 ? DEFAULT_WINDOW_SECONDS : Number(process.argv[flag + 1]);
if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("--window needs a whole number of seconds");

const { policyId, walletId, recipient, cap, windowEndsAt } = await createAndAttachPolicy({ windowSeconds });

console.log(`Policy ${policyId} created and attached to wallet ${walletId}.`);
console.log(`Per-payment cap: $${PER_PAYMENT_CAP_USD} (${cap} base units). Recipient: ${recipient}`);
console.log(`Window: ${windowSeconds}s, ends ${new Date(windowEndsAt * 1000).toISOString()} (${windowEndsAt})`);
console.log(`\nAdd to .env:\nPRIVY_POLICY_ID=${policyId}`);
