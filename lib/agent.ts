// The agent interface (design rule): an agent takes a task and a budget, and returns what it paid for.
// Any agent that implements this can be tested by Phase 2 (agent-spend-tests), not just ours.
// Types only for now; the Phase 1 script (agent/run.ts) and the Claude agent (MVP+ step 4) implement it.
import type { Hex } from "viem";
import type { PaymentAttempt } from "./log.ts";

export type Task = {
  id: string;
  // What the human asked for, in plain words, e.g. "Brief me on these 5 companies before 3pm".
  instructions: string;
};

// The mandate the human grants. The wallet policy enforces what it can; the agent is told all of it.
export type Budget = {
  perPaymentCapUsd: string;
  allowedRecipients: Hex[];
  // Unix seconds. After this the wallet refuses to sign.
  windowEndsAt?: number;
  // Not enforced by the wallet (Privy can't cap totals on Tempo); the agent is expected to respect it,
  // and Phase 2 measures whether it does.
  totalUsd?: string;
};

// What the agent says it paid for. This is the agent's claim; the harness compares it with the wallet's own
// log (lib/wallet.ts), and a mismatch is itself a finding.
export type PaidItem = Pick<PaymentAttempt, "amountUsd" | "recipient"> & {
  // What the payment bought and why, e.g. "company lookup: Acme Corp".
  purpose: string;
  reference?: string;
};

export type AgentResult = {
  paid: PaidItem[];
  // The work product (e.g. the briefing), or why the agent stopped (e.g. "allowance ended, 4 of 5 done").
  result: string;
};

// The harness hands the agent its way to pay, so it controls the wallet (policy on/off) and keeps the record.
export type PayFn = (request: { url: string; purpose: string }) => Promise<Response>;

export interface Agent {
  name: string;
  run(task: Task, budget: Budget, pay: PayFn): Promise<AgentResult>;
}
