// One line per payment attempt: time, amount, recipient, policy decision, reason, reference.
// Printed for people, and appended to logs/payments.jsonl (one JSON object per line) for the live spend
// view and the Phase 3 harness. That file is the wallet's own record of what was attempted.
import { appendFileSync, mkdirSync } from "node:fs";

export type PaymentAttempt = {
  amountUsd: string;
  recipient: string;
  decision: "ALLOWED" | "REFUSED";
  reason: string;
  reference?: string;
};

export const PAYMENT_LOG = new URL("../logs/payments.jsonl", import.meta.url);

export function logAttempt(a: PaymentAttempt): void {
  const time = new Date().toISOString();
  const fields = [time, `$${a.amountUsd}`, a.recipient, a.decision, a.reason, a.reference ?? "-"];
  console.log(fields.join(" | "));

  // Only these fields, whatever the caller passes: nothing else (e.g. a signed payment) reaches the file.
  const record = { time, amountUsd: a.amountUsd, recipient: a.recipient, decision: a.decision, reason: a.reason, reference: a.reference };
  mkdirSync(new URL(".", PAYMENT_LOG), { recursive: true });
  appendFileSync(PAYMENT_LOG, `${JSON.stringify(record)}\n`);
}
