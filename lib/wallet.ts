// The one door every payment signature goes through. Asks the Privy wallet to sign (so the wallet's
// policy decides) and logs the attempt as one line, whatever the decision. Never retries a refusal.
import { decodeFunctionData, formatUnits, type Hex } from "viem";
import { toAccount } from "viem/accounts";
import { Abis } from "viem/tempo";
import { logAttempt, type PaymentAttempt } from "./log.ts";
import { USD_TOKEN_DECIMALS } from "./policy.ts";
import { agentAccount } from "./privy.ts";
import type { PaymentTransaction } from "./tempo.ts";

// Privy's viem account types signTransaction for standard Ethereum transactions only, but it signs Tempo
// (type 118) ones too (Check first #1). Typed loosely here, in this one place.
type SignableTransaction = Record<string, unknown>;

export type SignResult = Pick<PaymentAttempt, "decision" | "reason" | "reference"> & { signed?: Hex };

// Thrown when the wallet policy refuses to sign. Callers stop; they don't work around it.
export class PolicyRefusedError extends Error {
  constructor(reason: string) {
    super(`Wallet policy refused to sign: ${reason}`);
  }
}

async function signAndLog(tx: SignableTransaction, payment: { amountUsd: string; recipient: string }): Promise<SignResult> {
  let result: SignResult;
  try {
    const signed = await agentAccount().signTransaction(tx as never);
    result = { decision: "ALLOWED", reason: "policy allowed signing", reference: `${signed.slice(0, 18)}…`, signed };
  } catch (err) {
    result = { decision: "REFUSED", reason: err instanceof Error ? err.message.replace(/\s+/g, " ") : String(err) };
  }
  logAttempt({ amountUsd: payment.amountUsd, recipient: payment.recipient, ...result });
  return result;
}

// For scripts that build their own test payments (check:policy).
export async function signPayment(payment: { amountUsd: string; recipient: Hex; tx: PaymentTransaction }): Promise<SignResult> {
  return signAndLog(payment.tx, payment);
}

// Reads amount and recipient from a Tempo payment, for the log only. Privy still decides on the real
// transaction; if it can't be read, the log says so and Privy decides anyway.
function describe(tx: SignableTransaction): { amountUsd: string; recipient: string } {
  const calls = "calls" in tx ? (tx.calls as { data?: Hex }[] | undefined) : undefined;
  if (calls?.length === 1 && calls[0].data) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: Abis.tip20, data: calls[0].data });
      if (functionName === "transferWithMemo" || functionName === "transfer") {
        return { amountUsd: formatUnits(args[1] as bigint, USD_TOKEN_DECIMALS), recipient: args[0] as string };
      }
    } catch {
      // not a token transfer; fall through
    }
  }
  return { amountUsd: "?", recipient: calls ? `? (${calls.length} calls)` : "?" };
}

// The agent's wallet as a viem account for mppx. Same Privy wallet and policy, but every signature
// goes through signAndLog, and a refusal throws PolicyRefusedError so the payment stops.
export function paymentAccount() {
  const privy = agentAccount();
  return toAccount({
    address: privy.address,
    signMessage: privy.signMessage,
    signTypedData: privy.signTypedData,
    signTransaction: async (tx) => {
      const result = await signAndLog(tx as SignableTransaction, describe(tx as SignableTransaction));
      if (!result.signed) throw new PolicyRefusedError(result.reason);
      return result.signed;
    },
  });
}
