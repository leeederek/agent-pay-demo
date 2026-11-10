// Check first #3: fund the agent's Privy wallet on Tempo testnet.
// Asks the testnet faucet (tempo_fundAddress) to mint test stablecoins, including pathUSD (our USD_TOKEN),
// straight to the wallet. Receiving needs no signature, so the Privy policy isn't involved here.
import { createClient, http, type Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { Actions } from "viem/tempo";
import { requireEnv } from "../lib/env.ts";
import { TEMPO_TESTNET_CHAIN_ID, USD_TOKEN } from "../lib/policy.ts";

// Hard rule: testnet only. The faucet doesn't exist on mainnet, but refuse anyway.
if (tempoModerato.id !== TEMPO_TESTNET_CHAIN_ID) {
  throw new Error(`Expected Tempo testnet (${TEMPO_TESTNET_CHAIN_ID}), got chain ${tempoModerato.id}.`);
}

const address = requireEnv("PRIVY_WALLET_ADDRESS") as Hex;
const client = createClient({ chain: tempoModerato, transport: http() });

async function usdBalance(): Promise<string> {
  const balance = await Actions.token.getBalance(client, { account: address, token: USD_TOKEN });
  return balance.formatted;
}

console.log(`Wallet ${address} on ${tempoModerato.name}`);
console.log(`USD balance before: $${await usdBalance()}\n`);

const receipts = await Actions.faucet.fundSync(client, { account: address, timeout: 30_000 });
for (const r of receipts) {
  console.log(`  faucet tx ${r.status}: ${tempoModerato.blockExplorers.default.url}/tx/${r.transactionHash}`);
}

console.log(`\nUSD balance after: $${await usdBalance()}`);
