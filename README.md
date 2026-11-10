# Allowance (agent-pay-demo)

An AI agent with a Privy wallet and a spending policy pays a Stripe-backed API over the Machine Payments Protocol (MPP). One payment goes through; the policy refuses another before anything is signed.

Phase 2 turns this into an eval harness: how often does an agent stay inside its spending mandate on its own, and how much does the wallet policy catch when it doesn't?

Status: Phase 1 in progress. Test networks and sandboxes only.

## Setup

1. Node 20 or later.
2. `cp .env.example .env` and fill in Privy and Stripe sandbox values.
3. Install dependencies (the first Claude Code session does this with you).

## Layout

| Folder | What lives there |
| --- | --- |
| `server/` | The paid API (from Stripe's machine-payments sample) |
| `agent/` | The paying script; later the Claude agent |
| `lib/` | Shared code: env loading, Privy client, policy helpers |
| `scripts/` | One-off setup: create wallet, create policy, check balance |
| `evals/` | Phase 2: `cases/` and `results/` |
| `docs/` | Spec and decision log |

## Run

- `npm run server` starts the paid API on port 4242
- `npm run validate` checks it end to end with `mppx validate`
- `npm run agent` runs the paying agent
