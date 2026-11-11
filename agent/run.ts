// Phase 1 agent: a plain script (no LLM) behind the agent interface (lib/agent.ts).
// Task: buy the Acme Corp report from the paid API and save it. With --repeat it keeps buying until the
// wallet policy refuses (e.g. the allowance window closes), then stops and reports. It never retries a refusal.
//
// Usage: npm run agent [-- --repeat] [--every <seconds>] [--max <n>]
//   (start the paid API first: npm run server)
import { mkdirSync, writeFileSync } from "node:fs";
import { Receipt } from "mppx";
import type { Hex } from "viem";
import type { Agent, AgentResult, Budget, PaidItem, PayFn, Task } from "../lib/agent.ts";
import { requireEnv } from "../lib/env.ts";
import { createPay } from "../lib/pay.ts";
import { currentWindowEndsAt, PER_PAYMENT_CAP_USD } from "../lib/policy.ts";
import { PolicyRefusedError } from "../lib/wallet.ts";

const REPORT_URL = "http://localhost:4242/report/acme.pdf";
const OUT_DIR = new URL("./out/", import.meta.url);

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}
const repeat = process.argv.includes("--repeat");
const everySeconds = arg("--every", 5);
const maxBuys = repeat ? arg("--max", 20) : 1;

function say(message: string) {
  console.log(`${new Date().toISOString()} | agent | ${message}`);
}

const scriptAgent: Agent = {
  name: "phase1-script",
  async run(task: Task, budget: Budget, pay: PayFn): Promise<AgentResult> {
    const paid: PaidItem[] = [];
    mkdirSync(OUT_DIR, { recursive: true });

    for (let n = 1; n <= maxBuys; n++) {
      const left = budget.windowEndsAt ? budget.windowEndsAt - Math.floor(Date.now() / 1000) : undefined;
      say(`buy #${n}: requesting the Acme report${left !== undefined ? ` (window: ${left}s left)` : ""}`);

      let response: Response;
      try {
        response = await pay({ url: REPORT_URL, purpose: "Acme Corp company report" });
      } catch (err) {
        if (err instanceof PolicyRefusedError || (err instanceof Error && err.message.includes("Wallet policy refused"))) {
          say("the wallet refused to sign, so I'm stopping (not retrying)");
          return { paid, result: `Stopped after ${paid.length} purchase(s): the wallet policy refused the next payment.` };
        }
        throw err;
      }

      if (!response.ok) {
        say(`the server answered ${response.status}, so I'm stopping`);
        return { paid, result: `Stopped after ${paid.length} purchase(s): server answered ${response.status}.` };
      }

      const file = new URL(`acme-report-${n}.pdf`, OUT_DIR);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const receipt = Receipt.fromResponse(response);
      paid.push({ amountUsd: "0.50", recipient: budget.allowedRecipients[0], purpose: "Acme Corp company report", reference: receipt.reference });
      say(`got the report (${file.pathname.split("/").pop()}), paid on chain: ${receipt.reference}`);

      if (n < maxBuys) await new Promise((resolve) => setTimeout(resolve, everySeconds * 1000));
    }
    return { paid, result: `Done: bought ${paid.length} report(s).` };
  },
};

// The harness role (for now, this file): set the task and budget, hand the agent its way to pay.
const task: Task = { id: "buy-acme-report", instructions: "Buy the Acme Corp company report and save it." };
const budget: Budget = {
  perPaymentCapUsd: PER_PAYMENT_CAP_USD,
  allowedRecipients: [requireEnv("TEMPO_DEPOSIT_ADDRESS") as Hex],
  windowEndsAt: await currentWindowEndsAt(),
};

say(`task: ${task.instructions}${repeat ? ` (repeat every ${everySeconds}s, up to ${maxBuys})` : ""}`);
const outcome = await scriptAgent.run(task, budget, createPay());
say(outcome.result);
for (const item of outcome.paid) say(`  paid $${item.amountUsd} for ${item.purpose}: ${item.reference}`);
