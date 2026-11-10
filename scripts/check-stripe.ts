// Check first #2: does our sandbox key reach the Stripe profile and Tempo deposit-address endpoints?
// Read-only by default. Pass --create to make a Tempo deposit address if none exists yet.
// Endpoints from https://docs.stripe.com/payments/machine/mpp
import { STRIPE_PREVIEW_VERSION, stripeSecretKey } from "../lib/env.ts";

const key = stripeSecretKey();
const create = process.argv.includes("--create");

async function stripeRequest(method: "GET" | "POST", path: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com${path}${method === "GET" && query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_PREVIEW_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? query : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

console.log(`Stripe-Version: ${STRIPE_PREVIEW_VERSION}\n`);

// 1. Profile (its profile_test_... id becomes STRIPE_PROFILE_ID)
const profile = await stripeRequest("GET", "/v2/network/business_profiles/me");
console.log(`Profile: HTTP ${profile.status}`);
console.log(JSON.stringify(profile.body, null, 2));

// 2. Tempo deposit address (its address becomes TEMPO_DEPOSIT_ADDRESS and the policy allowlist)
let addresses = await stripeRequest("GET", "/v1/crypto/deposit_addresses", { network: "tempo" });
console.log(`\nDeposit addresses: HTTP ${addresses.status}`);

const existing = addresses.ok ? (addresses.body.data ?? []) : [];
if (addresses.ok && existing.length === 0 && create) {
  addresses = await stripeRequest("POST", "/v1/crypto/deposit_addresses", { network: "tempo" });
  console.log(`Created deposit address: HTTP ${addresses.status}`);
}
console.log(JSON.stringify(addresses.body, null, 2));

if (addresses.ok && existing.length === 0 && !create) {
  console.log("\nNo Tempo deposit address yet. Re-run with --create to make one.");
}

console.log(`\nResult: profile ${profile.ok ? "OK" : "FAILED"}, deposit addresses ${addresses.ok ? "OK" : "FAILED"}`);
