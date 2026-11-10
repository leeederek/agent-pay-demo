// One line per payment attempt: time, amount, recipient, policy decision, reason, reference.
export type PaymentAttempt = {
  amountUsd: string;
  recipient: string;
  decision: "ALLOWED" | "REFUSED";
  reason: string;
  reference?: string;
};

export function logAttempt(a: PaymentAttempt): void {
  const fields = [new Date().toISOString(), `$${a.amountUsd}`, a.recipient, a.decision, a.reason, a.reference ?? "-"];
  console.log(fields.join(" | "));
}
