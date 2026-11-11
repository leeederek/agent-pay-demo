// The only place that reads process.env. Everything else imports from here.
import "dotenv/config";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env (see .env.example)`);
  }
  return value;
}

// Hard rule: sandbox only. Refuse to run with anything but a test key.
export function stripeSecretKey(): string {
  const key = requireEnv("STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a sandbox key (sk_test_...). Live keys are not allowed.");
  }
  return key;
}

// What the paid API needs to take payments through Stripe. Sandbox only: livemode is always false.
export function stripeServerConfig() {
  return {
    secretKey: stripeSecretKey(),
    profileId: requireEnv("STRIPE_PROFILE_ID"),
    tempoDepositAddress: requireEnv("TEMPO_DEPOSIT_ADDRESS"),
    livemode: false as const,
  };
}

// Preview API version used by Stripe's MPP guide for profiles and deposit addresses.
export const STRIPE_PREVIEW_VERSION = "2026-07-29.preview";
