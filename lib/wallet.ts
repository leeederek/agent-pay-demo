// The one door every payment signature goes through. Asks the Privy wallet to sign (so the wallet's
// policy decides) and logs the attempt as one line, whatever the decision. Never retries a refusal.
import type { Hex } from "viem";
import { logAttempt, type PaymentAttempt } from "./log.ts";
import { agentAccount } from "./privy.ts";
import type { PaymentTransaction } from "./tempo.ts";

export type SignResult = Pick<PaymentAttempt, "decision" | "reason" | "reference"> & { signed?: Hex };

export async function signPayment(payment: {
  amountUsd: string;
  recipient: Hex;
  tx: PaymentTransaction;
}): Promise<SignResult> {
  let result: SignResult;
  try {
    const signed = await agentAccount().signTransaction(payment.tx);
    result = { decision: "ALLOWED", reason: "policy allowed signing", reference: `${signed.slice(0, 18)}…`, signed };
  } catch (err) {
    result = { decision: "REFUSED", reason: err instanceof Error ? err.message.replace(/\s+/g, " ") : String(err) };
  }
  logAttempt({ amountUsd: payment.amountUsd, recipient: payment.recipient, ...result });
  return result;
}
