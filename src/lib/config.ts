import bs58 from "bs58";

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

/** Env value when set and non-empty, else a built-in default. Keeps the
 *  settings summary (`lib/settings.ts`) and the engine reading the same value. */
function envOr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}


export type LotteryConfig = {
  rpcUrl: string;
  heliusApiKey: string;
  network: "mainnet" | "devnet";
  tokenMint: string;
  tokenDecimals: number;
  /** Secret key bytes for the platform/hot wallet. Server-only. */
  platformWalletSecret: Uint8Array;
  /** Secret key bytes for the OPTIONAL platform fee treasury wallet. Server-only.
   *  Env: PLATFORM_TREASURY_SECRET. When set, the per-round platform fee is swept
   *  to this wallet in the same atomic tx as winner payouts (so the fee leaves
   *  the platform wallet and isn't recycled into the next round's prize pool).
   *  When null/unset, the fee stays on the platform wallet (legacy behaviour). */
  platformTreasurySecret: Uint8Array | null;
  lotteryCron: string;
  holderSyncCron: string;
  minTokenEligible: bigint;
  /** SOL kept on the platform wallet for fees/rent (not distributed). Env: PRIZE_RESERVE_LAMPORTS (default 0.05 SOL). */
  prizeReserveLamports: bigint;
  /** Max SOL prize distributed per round (lamports). 0 = no cap; the balance
   *  above the cap stays on the platform wallet for future rounds.
   *  Env: MAX_PRIZE_SOL (readable SOL string, e.g. "1.0"). */
  maxPrizeLamports: bigint;
  /** Minimum SOL prize per round (lamports). When the effective prize (after
   *  the max cap) falls below this, the round is skipped instead of drawn — no
   *  randomness consumed, no winners, no payout. 0 = no minimum.
   *  Env: MIN_PRIZE_SOL (readable SOL string, e.g. "0.1"). */
  minPrizeLamports: bigint;
  /** Platform revenue cut in basis points (0–10000; 100 = 1%, 500 = 5%). Default 0 = no cut.
   *  Env: PLATFORM_FEE_BPS. Deducted from the prize pool before splitting among
   *  winners; the cut stays on the platform wallet (the funder), not transferred. */
  platformFeeBps: number;
  winnerCount: number;
  payoutDistribution: number[];
  databaseUrl: string;
  adminUsername: string;
  adminPassword: string;
  adminSessionSecret: string;
  publicRpcUrl: string;
};

let cached: LotteryConfig | null = null;

/**
 * Loads and validates all server-side configuration from environment variables.
 * Throws if any required value is missing. Results are cached for the process.
 */
export function getConfig(): LotteryConfig {
  if (cached) return cached;

  const network = (process.env.SOLANA_NETWORK || "mainnet") as "mainnet" | "devnet";

  cached = {
    rpcUrl: required("SOLANA_RPC_URL", process.env.SOLANA_RPC_URL),
    heliusApiKey: process.env.HELIUS_API_KEY || "",
    network,
    tokenMint: required("TOKEN_MINT", process.env.TOKEN_MINT),
    tokenDecimals: Number(process.env.TOKEN_DECIMALS ?? 6),
    platformWalletSecret: parseSecret(
      required("PLATFORM_WALLET_SECRET", process.env.PLATFORM_WALLET_SECRET)
    ),
    platformTreasurySecret: (() => {
      const raw = process.env.PLATFORM_TREASURY_SECRET;
      return raw && raw.trim().length > 0
        ? parseSecret(raw.trim(), "PLATFORM_TREASURY_SECRET")
        : null;
    })(),
    lotteryCron: envOr("LOTTERY_CRON", "0 * * * *"),
    holderSyncCron: envOr("HOLDER_SYNC_CRON", "*/5 * * * *"),
    minTokenEligible: BigInt(envOr("MIN_TOKEN_ELIGIBLE", "100000")),
    prizeReserveLamports: parseReserve(
      envOr("PRIZE_RESERVE_LAMPORTS", "")
    ),
    maxPrizeLamports: parseSolToLamports(
      envOr("MAX_PRIZE_SOL", "")
    ),
    minPrizeLamports: parseSolToLamports(
      envOr("MIN_PRIZE_SOL", "")
    ),
    platformFeeBps: Math.max(
      0,
      Math.min(10000, Number(envOr("PLATFORM_FEE_BPS", "0")))
    ),
    winnerCount: Number(envOr("WINNER_COUNT", "3")),
    payoutDistribution: parseDistribution(
      envOr("PAYOUT_DISTRIBUTION", "0.5,0.3,0.2")
    ),

    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    adminUsername: process.env.ADMIN_USERNAME || "admin",
    adminPassword: required("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD),
    adminSessionSecret: required(
      "ADMIN_SESSION_SECRET",
      process.env.ADMIN_SESSION_SECRET
    ),
    publicRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "",
  };

  // winnerCount must match the payout distribution length
  if (cached.winnerCount !== cached.payoutDistribution.length) {
    throw new Error(
      `WINNER_COUNT (${cached.winnerCount}) must equal PAYOUT_DISTRIBUTION length (${cached.payoutDistribution.length})`
    );
  }

  return cached;
}

/** Busts the cached LotteryConfig so the next getConfig() rebuilds it from env.
 *  Settings are env-only now, so this is mainly for tests / scripts that mutate
 *  `process.env` in-process. */
export function bustConfigCache(): void {
  cached = null;
}

export interface AuthConfig {
  adminUsername: string;
  adminPassword: string;
  adminSessionSecret: string;
}

let authCached: AuthConfig | null = null;

/**
 * Loads only the admin-auth config (username, password, session secret).
 * Use this instead of getConfig() in auth/login paths so the admin panel can
 * work without the full Solana/DB credentials being set.
 */
export function getAuthConfig(): AuthConfig {
  if (authCached) return authCached;
  authCached = {
    adminUsername: process.env.ADMIN_USERNAME || "admin",
    adminPassword: required("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD),
    adminSessionSecret: required(
      "ADMIN_SESSION_SECRET",
      process.env.ADMIN_SESSION_SECRET
    ),
  };
  return authCached;
}

function parseDistribution(raw: string): number[] {
  const parts = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !isNaN(n));
  const sum = parts.reduce((a, b) => a + b, 0);
  if (parts.length === 0 || Math.abs(sum - 1) > 0.0001) {
    throw new Error(
      `PAYOUT_DISTRIBUTION must be a comma-separated list summing to 1.0, got "${raw}" (sum=${sum})`
    );
  }
  return parts;
}

/**
 * Parses PRIZE_RESERVE_LAMPORTS (raw lamports). Defaults to 0.05 SOL when unset
 * or invalid, so production stays safe unless explicitly lowered for testing.
 */
function parseReserve(raw: string | undefined): bigint {
  if (!raw || raw.trim().length === 0) return 50_000_000n; // 0.05 SOL default
  try {
    const v = BigInt(raw.trim());
    return v >= 0n ? v : 50_000_000n;
  } catch {
    return 50_000_000n;
  }
}

/**
 * Parses a readable SOL string (e.g. "1.0", "0.05") into lamports (× 1e9).
 * Returns 0n for unset / invalid / non-positive values, which disables the
 * max-prize cap and minimum-prize threshold respectively. Used by MAX_PRIZE_SOL
 * and MIN_PRIZE_SOL so admins enter friendly SOL amounts instead of lamports.
 */
function parseSolToLamports(raw: string | undefined): bigint {
  if (!raw || raw.trim().length === 0) return 0n;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return 0n;
  const lamports = Math.round(n * 1_000_000_000);
  return lamports > 0 ? BigInt(lamports) : 0n;
}

/**
 * Parses the platform wallet secret from env. Accepts either:
 *  - a JSON number array (solana-keygen output), e.g. "[12,34,...]"
 *  - a base58 string (Phantom export), e.g. "5K..."
 */
function parseSecret(raw: string, label = "PLATFORM_WALLET_SECRET"): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as number[];
      if (arr.length !== 64) {
        throw new Error(`expected 64 numbers, got ${arr.length}`);
      }
      return Uint8Array.from(arr);
    } catch (e) {
      throw new Error(
        `${label} looks like a JSON array but failed to parse: ${(e as Error).message}`
      );
    }
  }
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length !== 64) {
      throw new Error(`decoded to ${decoded.length} bytes, expected 64`);
    }
    return decoded;
  } catch (e) {
    throw new Error(
      `${label} is neither a valid JSON array nor valid base58: ${(e as Error).message}`
    );
  }
}
