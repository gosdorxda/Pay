import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lamportsToSol } from "@/lib/format";
import { getCreatorFeeStatus } from "@/lib/pumpfun/creator-fees";
import { getBagsLastClaim, getBagsUnclaimed } from "@/lib/bags/fees";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/creator-fees — public, minimal view of the creator-fee pot.
 *
 * The homepage prize-pool card shows two figures: how much creator fee is still
 * unclaimed (not yet swept into the prize pool) and when the last sweep landed.
 * That is a trust signal — "100% of creator fees go to the pool" is only
 * believable if you can see the money moving — so this route exposes the
 * numbers and nothing else: no wallet addresses, no signatures, no error
 * internals.
 *
 * Two sources, bags.fm first:
 *   • bags.fm API (`BAGS_API_KEY`) — `/token-launch/claimable-positions` +
 *     `/fee-share/deployer/claimable-positions` for "unclaimed" and
 *     `/fee-share/token/claim-events` for "last claimed".
 *   • pumpdev fallback — the legacy pump.fun snapshot, used when the bags key is
 *     absent or the token has no bags.fm record yet.
 *
 * Cost: up to three bags round-trips plus two DB reads, hence the 60 s cache.
 */
async function build() {
  let claimableSol: number | null = null;
  let pumpSol: number | null = null;
  let pumpSwapSol: number | null = null;
  let autoEnabled = false;
  let autoMinSol: number | null = null;
  let checkedAt: string | null = null;
  let error: string | null = null;
  let source: "bags" | "pump" | null = null;

  // bags.fm first: it is where this deployment's fees live now.
  try {
    const bags = await getBagsUnclaimed();
    if (bags) {
      claimableSol = lamportsToSol(bags.unclaimedLamports);
      checkedAt = bags.checkedAt;
      source = "bags";
    }
  } catch (e) {
    error = (e as Error).message;
  }

  // Legacy pump.fun snapshot — only when bags had nothing to say, so a migrated
  // token never shows a stale pump.fun pot next to live bags figures.
  if (source !== "bags") {
    try {
      const status = await getCreatorFeeStatus();
      autoEnabled = status.auto.enabled;
      autoMinSol = status.auto.minSol;
      // `error` here means "snapshot unavailable" (API down / non-mainnet) — the
      // UI then shows a dash rather than a zero.
      error = status.error ?? error;
      if (status.snapshot) {
        claimableSol = lamportsToSol(BigInt(status.snapshot.totalLamports));
        pumpSol = lamportsToSol(BigInt(status.snapshot.pumpLamports));
        pumpSwapSol = lamportsToSol(BigInt(status.snapshot.pumpSwapLamports));
        checkedAt = status.snapshot.checkedAt;
        source = "pump";
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Last claim: newest of the bags.fm event feed and our own confirmed claim
  // rows. The event feed is authoritative (it exists even when the sweep was
  // done from the bags dashboard), the DB row adds the pump.fun era.
  let lastClaimed: {
    at: string;
    amountSol: number;
    source: string;
  } | null = null;

  const candidates: Array<{ at: string; amountSol: number; source: string }> = [];

  try {
    const bagsClaim = await getBagsLastClaim();
    if (bagsClaim) {
      candidates.push({
        at: bagsClaim.claimedAt,
        amountSol: lamportsToSol(bagsClaim.amountLamports),
        source: "bags.fm",
      });
    }
  } catch (e) {
    error = error ?? (e as Error).message;
  }

  // Only confirmed claims count: a failed attempt must never read as "claimed".
  try {
    const row = await prisma.creatorFeeClaim.findFirst({
      where: { status: "confirmed" },
      orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }],
      select: {
        amountLamports: true,
        confirmedAt: true,
        createdAt: true,
        source: true,
      },
    });
    if (row) {
      candidates.push({
        at: (row.confirmedAt ?? row.createdAt).toISOString(),
        amountSol: lamportsToSol(row.amountLamports),
        source: row.source,
      });
    }
  } catch (e) {
    error = error ?? (e as Error).message;
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    lastClaimed = candidates[0];
  }

  return {
    claimableSol,
    pumpSol,
    pumpSwapSol,
    autoEnabled,
    autoMinSol,
    checkedAt,
    lastClaimed,
    /** Where the numbers came from: bags.fm API or the legacy pump.fun feed. */
    source,
    error,
  };
}

export async function GET() {
  return NextResponse.json(await cached("creator-fees:public", 60_000, build));
}
