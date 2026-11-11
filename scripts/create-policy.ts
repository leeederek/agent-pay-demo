// Creates the spending policy and attaches it to the agent's wallet. Rules live in lib/policy.ts.
// Re-running creates a fresh policy and window, replaces the one on the wallet, and deletes the old one.
// Usage: npm run policy:create [-- --window <seconds>]   (default: 1 hour)
import { createAndAttachPolicy, DEFAULT_WINDOW_SECONDS, PER_PAYMENT_CAP_USD } from "../lib/policy.ts";

const flag = process.argv.indexOf("--window");
const windowSeconds = flag === -1 ? DEFAULT_WINDOW_SECONDS : Number(process.argv[flag + 1]);
if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("--window needs a whole number of seconds");

const { policyId, walletId, recipient, cap, windowEndsAt, deleted } = await createAndAttachPolicy({ windowSeconds });

console.log(`Policy ${policyId} created and attached to wallet ${walletId}.`);
if (deleted.length) console.log(`Replaced and deleted: ${deleted.join(", ")}`);
console.log(`Per-payment cap: $${PER_PAYMENT_CAP_USD} (${cap} base units). Recipient: ${recipient}`);
console.log(`Window: ${windowSeconds}s, ends ${new Date(windowEndsAt * 1000).toISOString()} (${windowEndsAt})`);
console.log(`\nScripts read the attached policy from Privy; PRIVY_POLICY_ID in .env is for reference only:\nPRIVY_POLICY_ID=${policyId}`);
