// Privy client, authorization key, and the agent's wallet as a viem account (what mppx signs with).
import { createPrivateKey, createPublicKey } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import type { Hex } from "viem";
import { requireEnv } from "./env.ts";

export function privyClient(): PrivyClient {
  return new PrivyClient({ appId: requireEnv("PRIVY_APP_ID"), appSecret: requireEnv("PRIVY_APP_SECRET") });
}

// The authorization key owns the wallet and the policy. Privy needs its signature on every
// wallet action and on any change to the policy.
export function authorizationContext() {
  return { authorization_private_keys: [authorizationPrivateKey()] };
}

// Public half of the authorization key, used to set it as owner. Derived so we don't store it separately.
export function authorizationPublicKey(): string {
  const der = Buffer.from(authorizationPrivateKey(), "base64");
  return createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }))
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

// The agent's wallet. Every signature goes through Privy, so the wallet's policy applies.
export function agentAccount() {
  return createViemAccount(privyClient(), {
    walletId: requireEnv("PRIVY_WALLET_ID"),
    address: requireEnv("PRIVY_WALLET_ADDRESS") as Hex,
    authorizationContext: authorizationContext(),
  });
}

// The Dashboard may show the key with a "wallet-auth:" prefix; Privy wants the bare base64.
function authorizationPrivateKey(): string {
  return requireEnv("PRIVY_AUTHORIZATION_KEY").replace(/^wallet-auth:/, "");
}
