// Check first #3: fund the agent's Privy wallet on Tempo testnet.
// Asks the testnet faucet to mint test stablecoins, including pathUSD (our USD_TOKEN), straight to the
// wallet. Receiving needs no signature, so the Privy policy isn't involved here.
import type { Hex } from "viem";
import { requireEnv } from "../lib/env.ts";
import { fundFromFaucet, tempoChain, usdBalance } from "../lib/tempo.ts";

const address = requireEnv("PRIVY_WALLET_ADDRESS") as Hex;

console.log(`Wallet ${address} on ${tempoChain.name}`);
console.log(`USD balance before: $${await usdBalance(address)}\n`);

const receipts = await fundFromFaucet(address);
for (const r of receipts) {
  console.log(`  faucet tx ${r.status}: ${tempoChain.blockExplorers.default.url}/tx/${r.transactionHash}`);
}

console.log(`\nUSD balance after: $${await usdBalance(address)}`);
