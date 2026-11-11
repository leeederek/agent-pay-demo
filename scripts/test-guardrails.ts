// Guardrail test suite: runs every scenario from the walkthrough against the real server, agent, Privy wallet,
// Tempo testnet and Stripe sandbox, and reports pass/fail. Makes the live demo repeatable.
// Changes the wallet's policy while it runs (short windows) and always restores a fresh default policy at the end.
// Costs a few dollars of test pathUSD per run. Needs port 4242 free (stop your own `npm run server` first).
// Usage: npm run test:guardrails
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import StripeClient from "stripe";
import { stripeSecretKey } from "../lib/env.ts";
import { createAndAttachPolicy, currentAllowance } from "../lib/policy.ts";
import { DEFAULT_PRESET, presets } from "../lib/presets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = "http://localhost:4242";
const run = promisify(execFile);

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];

function say(message: string) {
  console.log(`${new Date().toISOString()} | guardrails | ${message}`);
}

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  say(`${pass ? "PASS" : "FAIL"}: ${name} (${detail})`);
}

// Runs a project script with tsx through node directly, so stopping it stops the real process.
function tsArgs(file: string, args: string[]) {
  return ["--import", "tsx", file, ...args];
}

async function serverUp(): Promise<boolean> {
  try {
    await fetch(`${SERVER}/openapi.json`);
    return true;
  } catch {
    return false;
  }
}

async function startServer(args: string[] = []): Promise<{ child: ChildProcess; log: () => string }> {
  const child = spawn(process.execPath, tsArgs("server/index.ts", args), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) throw new Error(`server ${args.join(" ")} didn't start:\n${out}`);
  return { child, log: () => out };
}

async function stopServer(server: { child: ChildProcess } | undefined) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
}

async function agent(args: string[] = []): Promise<string> {
  try {
    const { stdout, stderr } = await run(process.execPath, tsArgs("agent/run.ts", args), { cwd: ROOT, timeout: 240_000 });
    return stdout + stderr;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

async function checkPolicy(): Promise<string> {
  try {
    const { stdout } = await run(process.execPath, tsArgs("scripts/check-policy.ts", []), { cwd: ROOT, timeout: 120_000 });
    return stdout;
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? "";
  }
}

const walletLines = (out: string, decision: "ALLOWED" | "REFUSED") => out.split("\n").filter((l) => l.includes(` | ${decision} | `));

async function openPolicy(windowSeconds?: number) {
  const preset = presets()[DEFAULT_PRESET];
  return createAndAttachPolicy({ ...preset, windowSeconds: windowSeconds ?? preset.windowSeconds, presetName: DEFAULT_PRESET });
}

// Stripe payments of $0.50 since a time. A new one can show up as "processing" before it's "succeeded", so this
// polls until one has succeeded or the wait runs out, then returns all it found.
async function stripeHalfDollarPaymentsSince(sinceSeconds: number, waitMs: number) {
  const stripe = new StripeClient(stripeSecretKey());
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = (await stripe.paymentIntents.list({ created: { gte: sinceSeconds }, limit: 10 })).data.filter((p) => p.amount === 50);
    if (found.some((p) => p.status === "succeeded") || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (await serverUp()) {
  throw new Error("Something is already answering on port 4242. Stop your own `npm run server` and re-run.");
}

let server: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  say("opening a fresh default policy");
  await openPolicy();

  // 1. The policy on its own: six hand-built payments, one rule each.
  const policyOut = await checkPolicy();
  record("policy checks (check:policy)", policyOut.includes("6/6"), policyOut.match(/Result: .*/)?.[0] ?? "no result line");

  // 2. A good payment, end to end, recorded by Stripe.
  server = await startServer();
  const before = Math.floor(Date.now() / 1000) - 5;
  const good = await agent(["--report", "acme"]);
  const signed = walletLines(good, "ALLOWED").length === 1;
  const bought = good.includes("Done: bought 1 report(s).");
  const tx = good.match(/paid on chain: (0x[0-9a-f]+)/)?.[1];
  const intent = (await stripeHalfDollarPaymentsSince(before, 15_000)).find((p) => p.status === "succeeded");
  record(
    "good payment: signed, PDF delivered, recorded by Stripe",
    signed && bought && !!tx && !!intent,
    `signed=${signed}, bought=${bought}, chain tx ${tx ? `${tx.slice(0, 10)}…` : "none"}, Stripe ${intent ? intent.id : "no new $0.50 payment"}`,
  );

  // 3. Over the per-payment cap: refused before signing.
  const over = await agent(["--report", "premium"]);
  record(
    "over the cap ($1.10 vs $1.00): refused before signing",
    walletLines(over, "REFUSED").length === 1 && walletLines(over, "ALLOWED").length === 0 && over.includes("Stopped after 0"),
    walletLines(over, "REFUSED")[0]?.split(" | ").slice(1, 3).join(" to ") ?? "no refusal line",
  );
  await stopServer(server);

  // 4. Lookalike merchant: the 402 asks for an address one character off the allowlist.
  server = await startServer(["--lookalike"]);
  const look = await agent(["--report", "acme"]);
  const lookRefusal = walletLines(look, "REFUSED")[0] ?? "";
  record(
    "lookalike merchant: refused before signing",
    !!lookRefusal && walletLines(look, "ALLOWED").length === 0 && /172b6c/i.test(lookRefusal),
    lookRefusal ? `asked to pay ${lookRefusal.split(" | ")[2]}` : "no refusal line",
  );
  await stopServer(server);

  // 5. A merchant holds the signed payment past its expiry: Privy signs, Tempo rejects, Stripe records nothing.
  server = await startServer(["--hold-payments", "30"]);
  const heldSince = Math.floor(Date.now() / 1000);
  const held = await agent(["--report", "acme"]);
  const serverLog = server.log();
  const rejected = serverLog.match(/Tempo REJECTED the late payment: (.*)/)?.[1] ?? "";
  // Any $0.50 payment at all (even still processing) would mean the held payment went through.
  const heldIntents = await stripeHalfDollarPaymentsSince(heldSince, 5_000);
  record(
    "held payment: signed by Privy, rejected by Tempo, not recorded",
    walletLines(held, "ALLOWED").length === 1 && /valid_before|expired/.test(rejected) && heldIntents.length === 0,
    rejected ? `Tempo: ${rejected}` : "no Tempo rejection in the server log",
  );
  await stopServer(server);

  // 6 and 7. The time window: a short window, buying every 5s until refused, then again after it closes.
  server = await startServer();
  say("opening a 45s window for the window tests (about a minute)");
  const { windowEndsAt } = await openPolicy(45);
  const repeat = await agent(["--repeat", "--every", "5", "--max", "20"]);
  const buys = walletLines(repeat, "ALLOWED").length;
  const leftAtRefusal = [...repeat.matchAll(/window: (\d+)s left/g)].map((m) => Number(m[1])).pop();
  record(
    "dead zone: refused while the window still had time left",
    buys >= 1 && walletLines(repeat, "REFUSED").length === 1 && leftAtRefusal !== undefined && leftAtRefusal > 0 && leftAtRefusal <= 30,
    `${buys} bought, then refused with ${leftAtRefusal ?? "?"}s left`,
  );

  const wait = windowEndsAt * 1000 + 3000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const closed = await agent(["--report", "acme"]);
  record(
    "window closed: refused before signing",
    walletLines(closed, "REFUSED").length === 1 && walletLines(closed, "ALLOWED").length === 0,
    `${Math.floor(Date.now() / 1000) - windowEndsAt}s after the window ended`,
  );
} finally {
  await stopServer(server);
  say("restoring a fresh default policy");
  await openPolicy();
  const after = await checkPolicy();
  const allowance = await currentAllowance();
  record("restored default policy (check:policy)", after.includes("6/6"), `${allowance.name}`);
}

console.log("\n===== Guardrail test suite =====");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
