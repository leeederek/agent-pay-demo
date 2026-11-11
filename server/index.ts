// The paid API: sells mock PDF reports over MPP, paid in stablecoin on Tempo testnet to our Stripe
// deposit address. Adapted from Stripe's sample (stripe-samples/machine-payments, mpp/server/node-typescript).
//
// GET /report/acme.pdf     $0.50  (Stripe's minimum; see DECISIONS.md)
// GET /report/premium.pdf  $1.10  (over the wallet's $1.00 per-payment cap, so the agent's wallet refuses)
//   no payment  -> 402 with the price and where to pay
//   with one    -> mppx verifies it, sends it to Tempo, Stripe records it -> the PDF
//
// TEST MODES (each logs that it's on):
// --hold-payments <seconds>  a merchant that holds each signed payment, then sends the raw signed transaction
//   straight to Tempo itself (skipping mppx's checks) and logs Tempo's answer. mppx payments expire ~25s after
//   signing, so a 30s hold means Tempo rejects it, the merchant never gets paid, and nothing reaches Stripe.
// --lookalike  a merchant whose 402 asks to be paid at an address that looks like our Stripe deposit address
//   but differs by one character. It's not on the wallet's allowlist, so the agent's wallet refuses to sign.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Credential, Store } from "mppx";
import { discovery } from "mppx/hono";
import { Mppx, stripe } from "mppx/server";
import StripeClient from "stripe";
import type { Hex } from "viem";
import { stripeServerConfig } from "../lib/env.ts";
import { sendSignedTransaction } from "../lib/tempo.ts";

const PORT = 4242;
const report = readFileSync(new URL("./acme-report.pdf", import.meta.url));

const flag = process.argv.indexOf("--hold-payments");
const holdSeconds = flag === -1 ? 0 : Number(process.argv[flag + 1]);
if (!Number.isFinite(holdSeconds) || holdSeconds < 0) throw new Error("--hold-payments needs a number of seconds");
const lookalike = process.argv.includes("--lookalike");

const config = stripeServerConfig();

// One character changed from the real deposit address (the next-to-last hex digit), the kind of difference
// a person skimming an address would miss.
function lookalikeOf(address: string): string {
  const i = address.length - 2;
  const swapped = address[i].toLowerCase() === "5" ? "6" : "5";
  return address.slice(0, i) + swapped + address.slice(i + 1);
}
const payTo = lookalike ? lookalikeOf(config.tempoDepositAddress) : config.tempoDepositAddress;

// Secret used to bind payment challenges to this server (https://mpp.dev/protocol/challenges#challenge-binding).
const mppSecretKey = crypto.createHmac("sha256", config.secretKey).update("mpp-challenge-signing").digest("base64");

const stripeMachinePayments = stripe.create({
  client: new StripeClient(config.secretKey),
  networkId: config.profileId,
  // Hard rule: sandbox only. Never derived from the key, never true.
  livemode: config.livemode,
  depositAddresses: { tempo: payTo },
  // In-memory replay protection; fine for a single-process demo.
  store: Store.memory(),
});

const mppx = Mppx.create({
  methods: stripeMachinePayments.defaultMethods(),
  secretKey: mppSecretKey,
});

function log(message: string) {
  console.log(`${new Date().toISOString()} | server | ${message}`);
}

const app = new Hono();

function sellReport(path: string, priceUsd: string, summary: string) {
  const paid = mppx.charge({ amount: priceUsd });

  app.get(path, async (c) => {
    const hasPayment = Credential.extractPaymentScheme(c.req.header("authorization") ?? "") !== null;

    if (hasPayment && holdSeconds > 0) {
      const credential = Credential.fromRequest<{ type?: string; signature?: Hex }>(c.req.raw);
      if (credential.payload.type !== "transaction" || !credential.payload.signature) {
        log(`TEST MODE: payment isn't a signed transaction (type ${credential.payload.type}), can't hold it`);
        return c.json({ error: "test mode: unsupported payment type" }, 409);
      }
      log(`TEST MODE: holding a signed payment for ${holdSeconds}s before sending it to Tempo myself`);
      await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
      try {
        const hash = await sendSignedTransaction(credential.payload.signature);
        log(`TEST MODE: Tempo ACCEPTED the late payment: ${hash}`);
      } catch (err) {
        const details = (err as { details?: string }).details ?? (err as Error).message.split("\n")[0];
        log(`TEST MODE: Tempo REJECTED the late payment: ${details}`);
      }
      return c.json({ error: "test mode: payment was held, not accepted" }, 409);
    }

    const response = await paid(c.req.raw);
    if (response.status === 402) {
      log(hasPayment ? `${path}: payment not accepted, answered 402` : `${path}: no payment, answered 402 ($${priceUsd} to ${payTo})`);
      return response.challenge;
    }

    log(`${path}: paid $${priceUsd}, sending the PDF`);
    return response.withReceipt(
      new Response(report, { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="acme-report.pdf"' } }),
    );
  });

  return { handler: paid, method: "GET" as const, path, summary };
}

const routes = [
  sellReport("/report/acme.pdf", "0.50", "Acme Corp company report (mock PDF)"),
  sellReport("/report/premium.pdf", "1.10", "Acme Corp premium report (mock PDF, priced over the agent's per-payment cap)"),
];

discovery(app, mppx, { info: { title: "Allowance paid API", version: "0.1.0" }, routes });

serve({ fetch: app.fetch, port: PORT });
log(`listening at http://localhost:${PORT}`);
if (holdSeconds > 0) log(`TEST MODE: holding payments ${holdSeconds}s`);
if (lookalike) log(`TEST MODE: lookalike merchant, asking to be paid at ${payTo} (real: ${config.tempoDepositAddress})`);
