import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lamportsToSol } from "@/lib/format";
import { getPlatformKeypair } from "@/lib/solana/connection";
import {
  DRAND_CHAIN,
  DRAND_CHAIN_HASH,
  DRAND_PUBLIC_KEY,
  DRAND_SCHEME,
  DRAND_PERIOD,
} from "@/lib/solana/randomness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC single-round transparency surface. Returns one draw plus the EXACT
 * eligible-holder list that seeded its winner selection (filtered by the
 * round's minTokenEligible, minus the exclusion list recorded on the round —
 * platform wallet + admin blacklist — sorted by address) so anyone can
 * re-derive the winners client-side and confirm honest derivation.
 *
 * The eligible list is resolved from the holder-snapshot batch recorded for the
 * round (eligibleSnapshotCapturedAt — exact, from the round that introduced the
 * field onward). For older rounds that predate that field it falls back to the
 * latest snapshot batch at or before the draw start — the same batch the draw
 * would have read — and flags the source as "inferred".
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ roundNumber: string }> }
) {
  const network = (process.env.SOLANA_NETWORK || "mainnet") as
    | "mainnet"
    | "devnet";
  const { roundNumber: roundNumberStr } = await ctx.params;
  const roundNumber = Number(roundNumberStr);

  if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
    return NextResponse.json({ error: "Invalid round number" }, { status: 400 });
  }

  try {
    const round = await prisma.lotteryRound.findUnique({
      where: { roundNumber },
      include: { winners: { orderBy: { rank: "asc" } } },
    });

    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    // Resolve the snapshot batch that seeded this round's eligible pool.
    let batchCapturedAt: Date | null = round.eligibleSnapshotCapturedAt ?? null;
    let eligibleSource: "recorded" | "inferred" | "unavailable" = "recorded";
    if (!batchCapturedAt) {
      const inferred = await prisma.holderSnapshot.findFirst({
        where: { capturedAt: { lte: round.startedAt } },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      });
      if (inferred) {
        batchCapturedAt = inferred.capturedAt;
        eligibleSource = "inferred";
      } else {
        eligibleSource = "unavailable";
      }
    }

    // Reproduce the exact eligible list selectWinners received: sum balances
    // per wallet across token accounts within the batch, filter by the round's
    // minTokenEligible, then drop the exclusion list applied at draw time.
    //
    // Exclusions are snapshotted on the round (platform wallet + admin
    // blacklist, see lib/exclusions.ts). Rounds drawn before that column
    // existed have an empty array → fall back to the platform wallet only,
    // NEVER to the current blacklist: applying today's list retroactively would
    // silently change the reproduced winners of an old round.
    let platformAddress: string | null = null;
    try {
      platformAddress = getPlatformKeypair().publicKey.toBase58();
    } catch {
      // Solana config (PLATFORM_WALLET_SECRET) unavailable in this env — the
      // platform wallet can only be excluded when the round recorded it.
      platformAddress = null;
    }
    const recordedExclusions = round.excludedAddresses ?? [];
    const excludedAddresses =
      recordedExclusions.length > 0
        ? recordedExclusions
        : platformAddress
          ? [platformAddress]
          : [];
    const exclusionSource: "recorded" | "platform-only" =
      recordedExclusions.length > 0 ? "recorded" : "platform-only";
    const platformExclusionReproduced =
      platformAddress !== null || recordedExclusions.length > 0;

    const minTokenEligible = round.minTokenEligible;
    let eligible: { address: string; amount: string }[] = [];
    let snapshotTotalHolders = 0;
    if (batchCapturedAt) {
      const snaps = await prisma.holderSnapshot.findMany({
        where: { capturedAt: batchCapturedAt },
        select: { holderAddress: true, amount: true },
      });
      const map = new Map<string, bigint>();
      for (const s of snaps) {
        map.set(s.holderAddress, (map.get(s.holderAddress) ?? 0n) + s.amount);
      }
      snapshotTotalHolders = map.size;
      const excludeSet = new Set<string>(excludedAddresses);
      const list: { address: string; amount: bigint }[] = [];
      for (const [address, amount] of map) {
        if (excludeSet.has(address)) continue;
        if (amount >= minTokenEligible) list.push({ address, amount });
      }
      // Sort by address asc — identical to selectWinners' sort — so the client
      // reproduction feeds in the same order it would have on the server.
      list.sort((a, b) => a.address.localeCompare(b.address));
      eligible = list.map((e) => ({
        address: e.address,
        amount: e.amount.toString(),
      }));
    }

    return NextResponse.json({
      network,
      chain: {
        name: DRAND_CHAIN,
        hash: DRAND_CHAIN_HASH,
        publicKey: DRAND_PUBLIC_KEY,
        scheme: DRAND_SCHEME,
        period: DRAND_PERIOD,
        verifyBaseUrl: `https://api.drand.sh/${DRAND_CHAIN_HASH}/public`,
      },
      round: {
        roundNumber: round.roundNumber,
        status: round.status,
        prizePoolSol: lamportsToSol(round.prizePoolLamports),
        eligibleCount: round.eligibleCount,
        minTokenEligible: minTokenEligible.toString(),
        startedAt: round.startedAt.toISOString(),
        completedAt: round.completedAt ? round.completedAt.toISOString() : null,
        randomnessValue: round.randomnessValue,
        randomnessSignature: round.randomnessSignature,
        randomnessRound: round.randomnessRound,
        randomnessVerified: round.randomnessVerified,
        error: round.error,
        winners: round.winners.map((w) => ({
          rank: w.rank,
          address: w.address,
          amountSol: lamportsToSol(w.amountLamports),
          payoutTx: w.payoutTx,
          status: w.status,
        })),
      },
      eligible,
      eligibleSource,
      eligibleSnapshotCapturedAt: batchCapturedAt
        ? batchCapturedAt.toISOString()
        : null,
      snapshotTotalHolders,
      platformExclusionReproduced,
      platformAddress,
      excludedAddresses,
      exclusionSource,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
