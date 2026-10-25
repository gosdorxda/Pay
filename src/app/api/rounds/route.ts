import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lamportsToSol } from "@/lib/format";
import {
  DRAND_CHAIN,
  DRAND_CHAIN_HASH,
  DRAND_PUBLIC_KEY,
  DRAND_SCHEME,
  DRAND_PERIOD,
} from "@/lib/solana/randomness";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC draw history + drand audit metadata.
 * No auth — this is the public transparency surface: anyone can fetch this and
 * independently verify every past draw against the drand public beacon.
 */
async function buildRounds() {
  const network = (process.env.SOLANA_NETWORK || "mainnet") as
    | "mainnet"
    | "devnet";

  let rounds: unknown[] = [];
  let dbError: string | null = null;
  try {
    const rows = await prisma.lotteryRound.findMany({
      where: { status: { in: ["completed", "failed", "skipped"] } },
      orderBy: { roundNumber: "desc" },
      take: 50,
      include: { winners: { orderBy: { rank: "asc" } } },
    });
    rounds = rows.map((r) => ({
      roundNumber: r.roundNumber,
      status: r.status,
      prizePoolSol: lamportsToSol(r.prizePoolLamports),
      eligibleCount: r.eligibleCount,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      randomnessValue: r.randomnessValue,
      randomnessSignature: r.randomnessSignature,
      randomnessRound: r.randomnessRound,
      randomnessVerified: r.randomnessVerified,
      error: r.error,
      payoutTx: r.payoutTx,
      payoutFeeLamports: r.payoutFeeLamports
        ? r.payoutFeeLamports.toString()
        : null,
      platformFeeLamports: r.platformFeeLamports
        ? r.platformFeeLamports.toString()
        : null,
      winners: r.winners.map((w) => ({
        rank: w.rank,
        address: w.address,
        amountSol: lamportsToSol(w.amountLamports),
        payoutTx: w.payoutTx,
        status: w.status,
      })),
    }));
  } catch (e) {
    dbError = (e as Error).message;
  }

  return {
    network,
    chain: {
      name: DRAND_CHAIN,
      hash: DRAND_CHAIN_HASH,
      publicKey: DRAND_PUBLIC_KEY,
      scheme: DRAND_SCHEME,
      period: DRAND_PERIOD,
      verifyBaseUrl: `https://api.drand.sh/${DRAND_CHAIN_HASH}/public`,
    },
    rounds,
    dbError,
  };
}

/**
 * Cached 15 s: rounds only change when a draw finishes (hourly cron), yet every
 * visit to /draws used to pay for a 50-round query with all winners included.
 */
export async function GET() {
  return NextResponse.json(await cached("rounds", 15_000, buildRounds));
}
