// Live spend view: a local page showing the allowance in force and every payment attempt as it happens.
// Reads the wallet's own record (logs/payments.jsonl, written by lib/log.ts) and the policy attached to
// the wallet (via lib/policy.ts). Read-only: it never signs or changes anything.
// Usage: npm run view, then open http://localhost:4243
import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { PAYMENT_LOG, type PaymentAttempt } from "../lib/log.ts";
import { currentAllowance } from "../lib/policy.ts";

const PORT = 4243;
// mppx payments expire 25s after signing, so the wallet refuses them in the window's last 25s.
const DEAD_ZONE_SECONDS = 25;

type Logged = PaymentAttempt & { time: string };

function readLog(): Logged[] {
  if (!existsSync(PAYMENT_LOG)) return [];
  return readFileSync(PAYMENT_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Logged);
}

// The allowance changes only when someone runs policy:create; re-read it every 3s, not on every 2s poll.
let allowanceCache: { at: number; value: Awaited<ReturnType<typeof currentAllowance>> | { error: string } } | undefined;
async function allowance() {
  if (!allowanceCache || Date.now() - allowanceCache.at > 3_000) {
    try {
      allowanceCache = { at: Date.now(), value: await currentAllowance() };
    } catch (err) {
      allowanceCache = { at: Date.now(), value: { error: (err as Error).message } };
    }
  }
  return allowanceCache.value;
}

const app = new Hono();

app.get("/api/state", async (c) => {
  const live = await allowance();
  const attempts = readLog();
  const inWindow =
    "windowStartedAt" in live ? attempts.filter((a) => Date.parse(a.time) / 1000 >= live.windowStartedAt) : [];
  const signed = inWindow.filter((a) => a.decision === "ALLOWED");
  return c.json({
    now: Math.floor(Date.now() / 1000),
    deadZoneSeconds: DEAD_ZONE_SECONDS,
    allowance: live,
    window: {
      signedCount: signed.length,
      signedUsd: signed.reduce((sum, a) => sum + Number(a.amountUsd), 0).toFixed(2),
      refusedCount: inWindow.length - signed.length,
    },
    attempts: attempts.slice(-50).reverse(),
  });
});

app.get("/", (c) => c.html(PAGE));

serve({ fetch: app.fetch, port: PORT });
console.log(`Live spend view at http://localhost:${PORT}`);

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allowance spend view</title>
<style>
  :root {
    --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --line: #e4e4df;
    --ok: #1f7a4d; --ok-bg: #e5f4ec; --no: #b3261e; --no-bg: #fbe9e7; --warn: #8a5a00; --warn-bg: #fff3d6;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141413; --panel: #1d1d1b; --text: #ecece8; --muted: #9a9a94; --line: #2e2e2b;
      --ok: #6fd3a0; --ok-bg: #16301f; --no: #ff8a80; --no-bg: #3a1714; --warn: #ffd27a; --warn-bg: #3a2d10;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  .note { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .mono { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
  .banner { border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-weight: 500; display: none; }
  .banner.warn { display: block; background: var(--warn-bg); color: var(--warn); }
  .banner.closed { display: block; background: var(--no-bg); color: var(--no); }
  .table-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: var(--ok-bg); color: var(--ok); }
  .pill.no { background: var(--no-bg); color: var(--no); }
  .new { animation: flash 1.2s ease-out; }
  @keyframes flash { from { background: var(--warn-bg); } to { background: transparent; } }
  .empty { color: var(--muted); padding: 16px; }
</style>
</head>
<body>
<main>
  <h1>Allowance: live spend view</h1>
  <p class="sub">What the agent's wallet has been asked to sign, and what its policy decided. Updates every 2 seconds.</p>
  <div id="banner" class="banner"></div>
  <div class="grid">
    <div class="card"><div class="label">Allowance in force</div><div class="value" id="preset">…</div><div class="note mono" id="policy"></div></div>
    <div class="card"><div class="label">Per-payment cap</div><div class="value" id="cap">…</div><div class="note">Enforced by the wallet, before signing</div></div>
    <div class="card"><div class="label">Window closes in</div><div class="value" id="left">…</div><div class="note" id="ends"></div></div>
    <div class="card"><div class="label">Signed this window</div><div class="value" id="spent">…</div><div class="note">Total is <strong>not</strong> enforced by the wallet (Privy can't cap totals on Tempo)</div></div>
  </div>
  <div class="card" style="margin-bottom:20px"><div class="label">Only merchant allowed</div><div class="mono" id="merchant" style="margin-top:4px">…</div></div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Time</th><th>Amount</th><th>Recipient</th><th>Decision</th><th>Reason</th></tr></thead>
      <tbody id="rows"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
    </table>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  let seen = new Set();
  let first = true;

  function fmtLeft(s) {
    if (s <= 0) return "closed";
    const m = Math.floor(s / 60), r = s % 60;
    return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m > 0 ? m + "m " + r + "s" : r + "s";
  }
  function shortAddr(a) { return a && a.length > 14 ? a.slice(0, 8) + "…" + a.slice(-6) : a; }
  function reasonText(r) {
    return r.includes("policy_violation") ? "Privy: policy violation (Privy doesn't say which rule)" : r;
  }
  function cell(text, cls) { const td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; return td; }

  async function tick() {
    let state;
    try { state = await (await fetch("/api/state")).json(); } catch { return; }
    const a = state.allowance;
    const banner = $("banner");
    if (a.error) {
      $("preset").textContent = "none"; $("policy").textContent = a.error;
    } else {
      const presetName = (a.name.match(/\\(([^)]+)\\)/) || [])[1] || "custom";
      $("preset").textContent = presetName;
      $("policy").textContent = "Privy policy " + a.policyId;
      $("cap").textContent = "$" + Number(a.perPaymentCapUsd).toFixed(2);
      $("merchant").textContent = a.merchant;
      const left = a.windowEndsAt - state.now;
      $("left").textContent = fmtLeft(left);
      $("ends").textContent = "at " + new Date(a.windowEndsAt * 1000).toLocaleTimeString();
      banner.className = "banner";
      if (left <= 0) {
        banner.className = "banner closed";
        banner.textContent = "Window closed: the wallet refuses every payment. Run npm run policy:create to open a new one.";
      } else if (left <= state.deadZoneSeconds) {
        banner.className = "banner warn";
        banner.textContent = "Dead zone: " + left + "s left, but payments now expire after the window ends, so the wallet refuses them. No payment can land after the window closes.";
      }
    }
    $("spent").textContent = state.window.signedCount + " · $" + state.window.signedUsd;
    if (state.window.refusedCount) $("spent").textContent += " (" + state.window.refusedCount + " refused)";

    const rows = $("rows");
    rows.replaceChildren();
    if (!state.attempts.length) {
      const tr = document.createElement("tr"); tr.append(cell("No payment attempts yet. Run npm run agent.", "empty")); tr.firstChild.colSpan = 5; rows.append(tr);
    }
    for (const p of state.attempts) {
      const key = p.time + p.amountUsd + p.recipient;
      const tr = document.createElement("tr");
      if (!first && !seen.has(key)) tr.className = "new";
      seen.add(key);
      tr.append(cell(new Date(p.time).toLocaleTimeString()), cell("$" + Number(p.amountUsd).toFixed(2)));
      const to = cell(shortAddr(p.recipient), "mono"); to.title = p.recipient; tr.append(to);
      const d = document.createElement("td"); const pill = document.createElement("span");
      pill.className = "pill " + (p.decision === "ALLOWED" ? "ok" : "no"); pill.textContent = p.decision; d.append(pill); tr.append(d);
      tr.append(cell(reasonText(p.reason)));
      rows.append(tr);
    }
    first = false;
  }
  tick();
  setInterval(tick, 2000);
</script>
</body>
</html>`;
