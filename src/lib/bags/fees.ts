import { getConfig } from "../config";
import { getPlatformKeypair } from "../solana/connection";

/**
 * bags.fm fee reader (server-only, read-only).
 *
 * Answers the two numbers the homepage hero card shows under the prize pool:
 *   • Unclaimed fees — SOL still sitting in the token's fee vault
 *   • Last claimed   — when creator fees were last swept out
 *
 * Docs: https://docs.bags.fm — base `https://public-api-v2.bags.fm/api/v1`,
 * auth header `x-api-key` (create one at dev.bags.fm). Three endpoints are used:
 *
 *   GET /token-launch/claimable-positions?wallet=…  → normal creator/recipient
 *        claimable lamports per token (`totalClaimableLamportsUserShare`)
 *   GET /fee-share/deployer/claimable-positions?wallet=…  → deployer pending +
 *        accrued lamports per token (`totalClaimableLamports`)
 *   GET /fee-share/token/claim-events?tokenMint=…&mode=offset&limit=1
 *        → newest claim event (wallet, amount, signature, timestamp)
 *
 * "Unclaimed" sums the creator and deployer balances for OUR mint, because both
 * are fee SOL that has not reached the prize pool yet. It is NOT the lifetime
 * figure (`/token-launch/lifetime-fees`) — that one never decreases and would
 * be wrong for a "still unclaimed" label.
 *
 * Everything here is optional: without `BAGS_API_KEY` (or on a non-mainnet
 * deploy) every function returns `null`, and the UI shows an em dash.
 */

const DEFAULT_BASE = "https://public-api-v2.bags.fm/api/v1";
const TIMEOUT_MS = 12_000;

/** Lamport string → bigint, tolerating decimals and junk. */
function lamports(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.round(value));
  }
  return null;
}

function apiBase(): string {
  return (process.env.BAGS_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export function bagsConfigured(): boolean {
  return Boolean(process.env.BAGS_API_KEY?.trim());
}

async function bagsGet<T>(path: string): Promise<T> {
  const key = process.env.BAGS_API_KEY?.trim();
  if (!key) throw new Error("BAGS_API_KEY is not set");

  const res = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "x-api-key": key },
  });
  const text = await res.text();
  if (!res.ok) {
    // Keep the body out of the UI (it can echo the request); one short line is
    // enough to debug from the server log.
    throw new Error(`bags API ${res.status}: ${text.slice(0, 160)}`);
  }
  return JSON.parse(text) as T;
}

export interface BagsFeeSnapshot {
  /** Unclaimed creator + deployer lamports for the configured mint. */
  unclaimedLamports: bigint;
  /** Split, for the tooltip ("creator x · deployer y"). */
  creatorLamports: bigint;
  deployerLamports: bigint;
  checkedAt: string;
}

export interface BagsClaimEvent {
  amountLamports: bigint;
  signature: string;
  claimedAt: string;
  wallet: string;
}

/**
 * Unclaimed fee SOL for the configured mint, summed across the creator and
 * deployer ledgers. Returns null when the API key is missing or the token has
 * no bags.fm launch record (a pump.fun-only mint answers 400/404).
 */
export async function getBagsUnclaimed(): Promise<BagsFeeSnapshot | null> {
  if (!bagsConfigured()) return null;
  const cfg = getConfig();
  if (cfg.network !== "mainnet") return null;

  const wallet = getPlatformKeypair().publicKey.toBase58();
  const mint = cfg.tokenMint;

  let creatorLamports = 0n;
  let deployerLamports = 0n;

  const creator = await bagsGet<{
    success?: boolean;
    response?: Array<{
      baseMint?: string;
      totalClaimableLamportsUserShare?: number | string;
    }>;
  }>(`/token-launch/claimable-positions?wallet=${wallet}`);

  for (const position of creator.response ?? []) {
    if (position.baseMint !== mint) continue;
    const amount = lamports(position.totalClaimableLamportsUserShare);
    if (amount) creatorLamports += amount;
  }

  // Deployer revenue is a separate ledger; a failure here must not zero the
  // creator figure, so it is isolated.
  try {
    const deployer = await bagsGet<{
      success?: boolean;
      response?: {
        positions?: Array<{ tokenMint?: string; totalClaimableLamports?: string }>;
      };
    }>(`/fee-share/deployer/claimable-positions?wallet=${wallet}`);

    for (const position of deployer.response?.positions ?? []) {
      if (position.tokenMint !== mint) continue;
      const amount = lamports(position.totalClaimableLamports);
      if (amount) deployerLamports += amount;
    }
  } catch (e) {
    console.warn(`[bags] deployer balance unavailable: ${(e as Error).message}`);
  }

  return {
    unclaimedLamports: creatorLamports + deployerLamports,
    creatorLamports,
    deployerLamports,
    checkedAt: new Date().toISOString(),
  };
}

/** Newest claim event for the configured mint, or null when there is none. */
export async function getBagsLastClaim(): Promise<BagsClaimEvent | null> {
  if (!bagsConfigured()) return null;
  const cfg = getConfig();
  if (cfg.network !== "mainnet") return null;

  const data = await bagsGet<{
    success?: boolean;
    response?: {
      events?: Array<{
        wallet?: string;
        amount?: string;
        signature?: string;
        timestamp?: string;
      }>;
    };
  }>(
    `/fee-share/token/claim-events?tokenMint=${cfg.tokenMint}&mode=offset&limit=1&offset=0`
  );

  const event = data.response?.events?.[0];
  if (!event) return null;
  const amount = lamports(event.amount);
  if (!amount || !event.timestamp) return null;

  return {
    amountLamports: amount,
    signature: event.signature ?? "",
    claimedAt: event.timestamp,
    wallet: event.wallet ?? "",
  };
}
