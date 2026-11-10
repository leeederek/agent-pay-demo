// Creates the agent's Privy server wallet, owned by our authorization key.
// Run once, then copy the printed values into .env.
import { privyClient, authorizationPublicKey } from "../lib/privy.ts";

if (process.env.PRIVY_WALLET_ID) {
  console.log(`PRIVY_WALLET_ID is already set (${process.env.PRIVY_WALLET_ID}). Not creating another wallet.`);
  process.exit(0);
}

const wallet = await privyClient().wallets().create({
  chain_type: "ethereum", // Tempo is EVM-compatible, so an Ethereum wallet works there
  owner: { public_key: authorizationPublicKey() },
});

console.log("Wallet created. Add these to .env:\n");
console.log(`PRIVY_WALLET_ID=${wallet.id}`);
console.log(`PRIVY_WALLET_ADDRESS=${wallet.address}`);
