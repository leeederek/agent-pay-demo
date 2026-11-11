// Creates the spending policy from a preset and attaches it to the agent's wallet. Rules live in
// lib/policy.ts, presets in lib/presets.ts. Re-running opens a fresh window, replaces the wallet's policy,
// and deletes the old one.
// Usage: npm run policy:create [-- --preset <name>] [--window <seconds>]
//   --window overrides the preset's window (e.g. --window 60 for the window-closing demo).
import { createAndAttachPolicy } from "../lib/policy.ts";
import { DEFAULT_PRESET, presets } from "../lib/presets.ts";

const all = presets();
const presetFlag = process.argv.indexOf("--preset");
const presetName = presetFlag === -1 ? DEFAULT_PRESET : process.argv[presetFlag + 1];
const preset = all[presetName];
if (!preset) {
  console.log("Presets:");
  for (const [name, p] of Object.entries(all)) console.log(`  ${name.padEnd(14)} ${p.description}`);
  throw new Error(`Unknown preset "${presetName}".`);
}

const windowFlag = process.argv.indexOf("--window");
const windowSeconds = windowFlag === -1 ? preset.windowSeconds : Number(process.argv[windowFlag + 1]);
if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("--window needs a whole number of seconds");

const { policyId, walletId, recipient, cap, windowEndsAt, deleted } = await createAndAttachPolicy({
  ...preset,
  windowSeconds,
  presetName,
});

console.log(`Preset "${presetName}": ${preset.description}${windowFlag === -1 ? "" : ` (window overridden to ${windowSeconds}s)`}`);
console.log(`Policy ${policyId} created and attached to wallet ${walletId}.`);
if (deleted.length) console.log(`Replaced and deleted: ${deleted.join(", ")}`);
console.log(`Per-payment cap: $${preset.perPaymentCapUsd} (${cap} base units). Recipient: ${recipient}`);
console.log(`Window: ${windowSeconds}s, ends ${new Date(windowEndsAt * 1000).toISOString()} (${windowEndsAt})`);
console.log(`\nScripts read the attached policy from Privy; PRIVY_POLICY_ID in .env is for reference only:\nPRIVY_POLICY_ID=${policyId}`);
