import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lamportsToSol } from "@/lib/format";
import {
  getConnection,
  getPlatformKeypair,
  getTreasuryKeypair,
} from "@/lib/solana/connection";
import {
  effectiveValue,
  getEffectiveConfig,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC treasury overview for the /stats page: the platform (hot) wallet and
 * the optional platform-fee treasury wallet — address + live SOL balance — plus
 * the cumulative fee ledger (Σ `platformFeeLamports` over every recorded round).
 *
 * Only public, on-chain data is exposed (addresses, balances, fee totals). No
 * secrets, no signer material.
 *
 * Balances change only when SOL moves, so the whole snapshot is cached for 15s
 * in-process — same pattern as /api/status. Without it, every /stats mount
 * would cost 2 Solana RPC round-trips.
 */
const CACHE_TTL_MS = 15_000;

type WalletInfo = {
  address: string | null;
  balanceSol: number | null;
};

type FeeWalletInfo = WalletInfo & {
  /** True when PLATFORM_TREASURY_SECRET is set (fees are swept off-chain of the
   *  platform wallet into this treasury at payout time). When false the fee
   *  simply accumulates on the platform wallet (legacy behaviour). */
  configured: boolean;
  /** Lifetime platform fee recorded across all rounds (SOL). */
  totalEarnedSol: number;
  /** Number of rounds that actually recorded a fee > 0. */
  sweeps: number;
  /** False when the DB aggregate failed — the UI shows "—" instead of 0. */
  ledgerAvailable: boolean;
};

export type WalletOverview = {
  network: "mainnet" | "devnet";
  /** Reserve kept on the platform wallet for fees/rent (SOL). */
  reserveSol: number;
  /** Effective platform fee in basis points (100 = 1%). */
  feeBps: number;
  platform: WalletInfo;
  fee: FeeWalletInfo;
  generatedAt: string;
  /** Human-readable reason when part of the snapshot could not be read. */
  error: string | null;
};

let cache: { payload: WalletOverview; ts: number } | null = null;

async function buildOverview(): Promise<WalletOverview> {
  const network = (process.env.SOLANA_NETWORK || "mainnet") as
    | "mainnet"
    | "devnet";
  const feeBps = Math.max(
    0,
    Math.min(10000, Number(effectiveValue("PLATFORM_FEE_BPS")) || 0)
  );

  let reserveSol = 0.05;
  try {
    const cfg = await getEffectiveConfig();
    reserveSol = lamportsToSol(cfg.prizeReserveLamports);
  } catch {
    /* config not ready (missing secrets in dev) — keep the 0.05 default */
  }

  const notes: string[] = [];

  // Platform (hot) wallet: address is derived locally, balance needs the RPC.
  const platform: WalletInfo = { address: null, balanceSol: null };
  try {
    const kp = getPlatformKeypair();
    platform.address = kp.publicKey.toBase58();
    try {
      const bal = await getConnection().getBalance(kp.publicKey, "confirmed");
      platform.balanceSol = lamportsToSol(bal);
    } catch (e) {
      notes.push(`Platform balance: ${(e as Error).message}`);
    }
  } catch (e) {
    notes.push(`Platform wallet: ${(e as Error).message}`);
  }

  // Optional fee treasury wallet. Null (not an error) when unset.
  const fee: FeeWalletInfo = {
    address: null,
    balanceSol: null,
    configured: false,
    totalEarnedSol: 0,
    sweeps: 0,
    ledgerAvailable: false,
  };
  try {
    const kp = getTreasuryKeypair();
    if (kp) {
      fee.configured = true;
      fee.address = kp.publicKey.toBase58();
      try {
        const bal = await getConnection().getBalance(kp.publicKey, "confirmed");
        fee.balanceSol = lamportsToSol(bal);
      } catch (e) {
        notes.push(`Fee wallet balance: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    notes.push(`Fee wallet: ${(e as Error).message}`);
  }

  // Cumulative fee ledger straight from the draw rows. `platformFeeLamports`
  // is written at draw time, so this is the authoritative fee history even if
  // the on-chain sweep tx isn't indexed anywhere yet.
  try {
    const [agg, sweeps] = await Promise.all([
      prisma.lotteryRound.aggregate({ _sum: { platformFeeLamports: true } }),
      prisma.lotteryRound.count({
        where: { platformFeeLamports: { gt: BigInt(0) } },
      }),
    ]);
    fee.totalEarnedSol = lamportsToSol(agg._sum.platformFeeLamports ?? 0n);
    fee.sweeps = sweeps;
    fee.ledgerAvailable = true;
  } catch (e) {
    notes.push(`Fee ledger: ${(e as Error).message}`);
  }

  return {
    network,
    reserveSol,
    feeBps,
    platform,
    fee,
    generatedAt: new Date().toISOString(),
    error: notes.length > 0 ? notes.join(" · ") : null,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  const payload = await buildOverview();
  cache = { payload, ts: now };
  return NextResponse.json(payload);
}
