// Phase 1 agent: a plain script (no LLM) behind the agent interface (lib/agent.ts).
// Task: buy the Acme Corp report from the paid API and save it. With --repeat it keeps buying until the
// wallet policy refuses (e.g. the allowance window closes), then stops and reports. It never retries a refusal.
//
// Usage: npm run agent [-- --report acme|premium] [--repeat] [--every <seconds>] [--max <n>]
//   (start the paid API first: npm run server). premium costs $1.10, over the wallet's $1.00 cap.
import { mkdirSync, writeFileSync } from "node:fs";
import { Receipt } from "mppx";
import type { Agent, AgentResult, Budget, PaidItem, PayFn, Task } from "../lib/agent.ts";
import { createPay } from "../lib/pay.ts";
import { currentAllowance } from "../lib/policy.ts";
import { PolicyRefusedError } from "../lib/wallet.ts";

const OUT_DIR = new URL("./out/", import.meta.url);

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

// What the agent can buy. The price is what the server's 402 asks; it's listed here only for the agent's
// own report of what it paid. The wallet decides on the real amount in the payment.
const REPORTS = {
  acme: { url: "http://localhost:4242/report/acme.pdf", name: "Acme Corp company report", priceUsd: "0.50" },
  premium: { url: "http://localhost:4242/report/premium.pdf", name: "Acme Corp premium report", priceUsd: "1.10" },
} as const;
const reportFlag = process.argv.indexOf("--report");
const reportKey = (reportFlag === -1 ? "acme" : process.argv[reportFlag + 1]) as keyof typeof REPORTS;
if (!(reportKey in REPORTS)) throw new Error(`--report must be one of: ${Object.keys(REPORTS).join(", ")}`);
const item = REPORTS[reportKey];
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
      say(`buy #${n}: requesting the ${item.name} ($${item.priceUsd})${left !== undefined ? ` (window: ${left}s left)` : ""}`);

      let response: Response;
      try {
        response = await pay({ url: item.url, purpose: item.name });
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

      const file = new URL(`${reportKey}-report-${n}.pdf`, OUT_DIR);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const receipt = Receipt.fromResponse(response);
      paid.push({ amountUsd: item.priceUsd, recipient: budget.allowedRecipients[0], purpose: item.name, reference: receipt.reference });
      say(`got the report (${file.pathname.split("/").pop()}), paid on chain: ${receipt.reference}`);

      if (n < maxBuys) await new Promise((resolve) => setTimeout(resolve, everySeconds * 1000));
    }
    return { paid, result: `Done: bought ${paid.length} report(s).` };
  },
};

// The harness role (for now, this file): set the task and budget, hand the agent its way to pay.
const task: Task = { id: `buy-${reportKey}-report`, instructions: `Buy the ${item.name} and save it.` };
// The budget is the allowance actually in force: read from the policy attached to the wallet.
const allowance = await currentAllowance();
const budget: Budget = {
  perPaymentCapUsd: allowance.perPaymentCapUsd,
  allowedRecipients: [allowance.merchant],
  windowEndsAt: allowance.windowEndsAt,
};

say(`task: ${task.instructions}${repeat ? ` (repeat every ${everySeconds}s, up to ${maxBuys})` : ""}`);
const outcome = await scriptAgent.run(task, budget, createPay());
say(outcome.result);
for (const item of outcome.paid) say(`  paid $${item.amountUsd} for ${item.purpose}: ${item.reference}`);
