// The paid API: sells a mock PDF report over MPP, paid in stablecoin on Tempo testnet to our Stripe
// deposit address. Adapted from Stripe's sample (stripe-samples/machine-payments, mpp/server/node-typescript).
//
// GET /report/acme.pdf with no payment  -> 402 with the price and where to pay
// GET /report/acme.pdf with a payment   -> mppx verifies it, sends it to Tempo, Stripe records it -> the PDF
//
// TEST MODE: --hold-payments <seconds> plays a misbehaving merchant. It holds each signed payment that
// arrives for that long before sending it to Tempo. mppx payments expire ~25s after signing, so holding
// one for 30s means Tempo rejects it and the merchant never gets paid.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Credential, Store } from "mppx";
import { discovery } from "mppx/hono";
import { Mppx, stripe } from "mppx/server";
import StripeClient from "stripe";
import { stripeServerConfig } from "../lib/env.ts";

const PORT = 4242;
// Stripe's minimum: it refuses to record a payment under $0.50 (amount_too_small).
const PRICE_USD = "0.50";
const report = readFileSync(new URL("./acme-report.pdf", import.meta.url));

const flag = process.argv.indexOf("--hold-payments");
const holdSeconds = flag === -1 ? 0 : Number(process.argv[flag + 1]);
if (!Number.isFinite(holdSeconds) || holdSeconds < 0) throw new Error("--hold-payments needs a number of seconds");

const config = stripeServerConfig();

// Secret used to bind payment challenges to this server (https://mpp.dev/protocol/challenges#challenge-binding).
const mppSecretKey = crypto.createHmac("sha256", config.secretKey).update("mpp-challenge-signing").digest("base64");

const stripeMachinePayments = stripe.create({
  client: new StripeClient(config.secretKey),
  networkId: config.profileId,
  // Hard rule: sandbox only. Never derived from the key, never true.
  livemode: config.livemode,
  depositAddresses: { tempo: config.tempoDepositAddress },
  // In-memory replay protection; fine for a single-process demo.
  store: Store.memory(),
});

const mppx = Mppx.create({
  methods: stripeMachinePayments.defaultMethods(),
  secretKey: mppSecretKey,
});

const paid = mppx.charge({ amount: PRICE_USD });

function log(message: string) {
  console.log(`${new Date().toISOString()} | server | ${message}`);
}

const app = new Hono();

app.get("/report/acme.pdf", async (c) => {
  const hasPayment = Credential.extractPaymentScheme(c.req.header("authorization") ?? "") !== null;

  if (hasPayment && holdSeconds > 0) {
    log(`TEST MODE: holding a signed payment for ${holdSeconds}s before sending it to Tempo`);
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
    log("TEST MODE: hold over, sending the payment to Tempo now");
  }

  const response = await paid(c.req.raw);
  if (response.status === 402) {
    log(hasPayment ? "payment not accepted, answered 402" : `no payment, answered 402 ($${PRICE_USD})`);
    return response.challenge;
  }

  log(`paid $${PRICE_USD}, sending the PDF`);
  return response.withReceipt(
    new Response(report, { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="acme-report.pdf"' } }),
  );
});

discovery(app, mppx, {
  info: { title: "Allowance paid API", version: "0.1.0" },
  routes: [
    {
      handler: paid,
      method: "GET",
      path: "/report/acme.pdf",
      summary: "Acme Corp company report (mock PDF)",
    },
  ],
});

serve({ fetch: app.fetch, port: PORT });
log(`listening at http://localhost:${PORT}${holdSeconds > 0 ? ` (TEST MODE: holding payments ${holdSeconds}s)` : ""}`);
