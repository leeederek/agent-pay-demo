// Tempo testnet: building payment transactions, balances, and the testnet faucet.
// Scripts and agents get transactions from here; they never encode calldata themselves.
import { createClient, encodeFunctionData, http, pad, parseUnits, type Hex } from "viem";
import { sendRawTransaction } from "viem/actions";
import { tempoModerato } from "viem/chains";
import { Abis, Actions } from "viem/tempo";
import { TEMPO_TESTNET_CHAIN_ID, USD_TOKEN, USD_TOKEN_DECIMALS } from "./policy.ts";

// Hard rule: testnet only.
if (tempoModerato.id !== TEMPO_TESTNET_CHAIN_ID) {
  throw new Error(`Expected Tempo testnet (${TEMPO_TESTNET_CHAIN_ID}), got chain ${tempoModerato.id}.`);
}

export const tempoChain = tempoModerato;
const client = createClient({ chain: tempoModerato, transport: http() });

// A Tempo (type 118) transaction paying `amountUsd` of the USD token to `recipient`, the same shape
// mppx builds: one transferWithMemo call. Gas and fee values only need to be plausible for sign-only use.
// `validBefore` defaults to 60s from now; pass null to leave it out (the policy should refuse that).
export function paymentTransaction({
  recipient,
  amountUsd,
  validBefore = Math.floor(Date.now() / 1000) + 60,
  feeToken = USD_TOKEN,
}: {
  recipient: Hex;
  amountUsd: string;
  validBefore?: number | null;
  feeToken?: Hex;
}) {
  const data = encodeFunctionData({
    abi: Abis.tip20,
    functionName: "transferWithMemo",
    args: [recipient, parseUnits(amountUsd, USD_TOKEN_DECIMALS), pad("0x01")],
  });
  return {
    type: "tempo" as const,
    chainId: TEMPO_TESTNET_CHAIN_ID,
    calls: [{ to: USD_TOKEN, data }],
    nonce: 0,
    gas: 100_000n,
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 0n,
    feeToken,
    ...(validBefore === null ? {} : { validBefore }),
  };
}

export type PaymentTransaction = ReturnType<typeof paymentTransaction>;

export async function usdBalance(address: Hex): Promise<string> {
  const balance = await Actions.token.getBalance(client, { account: address, token: USD_TOKEN });
  return balance.formatted;
}

// Sends an already-signed transaction straight to Tempo, with no simulation or checks first.
// Used by the server's held-payment test mode to play a merchant that skips mppx.
export async function sendSignedTransaction(serialized: Hex): Promise<Hex> {
  return sendRawTransaction(client, { serializedTransaction: serialized as `0x76${string}` });
}

// Asks the testnet faucet (tempo_fundAddress) to mint test stablecoins, including the USD token, to `address`.
export async function fundFromFaucet(address: Hex) {
  return Actions.faucet.fundSync(client, { account: address, timeout: 30_000 });
}
