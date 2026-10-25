import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fmtTokenHuman } from "@/lib/format";
import { effectiveMinEligibleBigint } from "@/lib/settings";
import { getVenueAccountMap } from "@/lib/exclusions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solana addresses are base58, 32 bytes (typically 43–44 chars). Reject
// anything that isn't plausible base58 before hitting the DB.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Public single-wallet eligibility check. Reads the holder's summed balance
 * from the latest snapshot batch (a wallet may hold across several token
 * accounts, so amounts are summed) and compares it to MIN_TOKEN_ELIGIBLE —
 * the same threshold a draw selects winners from.
 *
 * Also reports whether the wallet is EXCLUDED from the draw (venue accounts
 * derived from TOKEN_MINT + the admin blacklist, with the organiser's label),
 * so a wallet that holds enough PAY but has no entry doesn't read "eligible".
 * `eligible` stays balance-only; `drawEligible` = clears the minimum AND is not
 * excluded, and is what the UI shows.
 *
 * Returns only this wallet's data (never the holder list) for privacy. No
 * auth required. Mirrors the env-direct pattern used by /api/status and
 * /api/admin/holders so it works without the full Solana/RPC config.
 */
export async function GET(request: NextRequest) {
  const network = (process.env.SOLANA_NETWORK || "mainnet") as
    | "mainnet"
    | "devnet";
  const tokenDecimals = Number(process.env.TOKEN_DECIMALS ?? 6);
  const tokenMint = process.env.TOKEN_MINT || null;
  const tokenName = process.env.TOKEN_NAME || "PAY";
  const threshold = await effectiveMinEligibleBigint();

  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";

  if (!address) {
    return NextResponse.json(
      { error: "Missing 'address' query parameter." },
      { status: 400 }
    );
  }
  if (!BASE58.test(address)) {
    return NextResponse.json(
      { error: "Invalid Solana address format." },
      { status: 400 }
    );
  }

  let balanceRaw = 0n;
  let found = false;
  let capturedAt: string | null = null;
  let lastSyncAt: string | null = null;
  let dbError: string | null = null;

  try {
    // Latest global snapshot batch + whether this wallet has ever been seen.
    const [latestSnap, anySnap] = await Promise.all([
      prisma.holderSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
      prisma.holderSnapshot.findFirst({
        where: { holderAddress: address },
        select: { holderAddress: true },
      }),
    ]);

    found = !!anySnap;
    lastSyncAt = latestSnap ? latestSnap.capturedAt.toISOString() : null;

    if (latestSnap) {
      // Sum this wallet's token accounts within the latest batch.
      const rows = await prisma.holderSnapshot.findMany({
        where: { capturedAt: latestSnap.capturedAt, holderAddress: address },
        select: { amount: true },
      });
      if (rows.length > 0) {
        balanceRaw = rows.reduce((sum, r) => sum + r.amount, 0n);
        capturedAt = latestSnap.capturedAt.toISOString();
      }
    }
  } catch (e) {
    dbError = (e as Error).message;
  }

  // Same two exclusion sources the draw filters with, so the answer here can't
  // disagree with the holder table: venue accounts derived from TOKEN_MINT
  // (bonding curve / pool authority) and the admin blacklist (with its label).
  const venue = getVenueAccountMap(tokenMint ?? undefined).get(address) ?? null;

  let manualExcluded = false;
  let manualLabel: string | null = null;
  try {
    const row = await prisma.excludedWallet.findUnique({
      where: { address },
      select: { label: true },
    });
    if (row) {
      manualExcluded = true;
      manualLabel = row.label;
    }
  } catch (e) {
    dbError = dbError ?? (e as Error).message;
  }

  const excluded = !!venue || manualExcluded;
  const eligible = balanceRaw >= threshold;
  const shortfallRaw = eligible ? 0n : threshold - balanceRaw;

  return NextResponse.json({
    address,
    network,
    tokenName,
    tokenMint,
    tokenDecimals,
    found,
    balanceRaw: balanceRaw.toString(),
    balanceHuman: fmtTokenHuman(balanceRaw, tokenDecimals),
    minTokenEligibleRaw: threshold.toString(),
    minTokenEligibleHuman: fmtTokenHuman(threshold, tokenDecimals),
    // clears the minimum, ignoring exclusions (kept for API compatibility)
    eligible,
    // clears the minimum AND has an entry in the draw
    drawEligible: eligible && !excluded,
    // venue account / blacklisted wallet: no entry even with a full balance
    excluded,
    excludedBy: venue ? "venue" : manualExcluded ? "manual" : null,
    excludedLabel: venue ? venue.label : manualLabel,
    exclusionReason: venue ? venue.reason : null,
    shortfallRaw: shortfallRaw.toString(),
    shortfallHuman: fmtTokenHuman(shortfallRaw, tokenDecimals),
    // snapshot batch this balance is from (null if wallet not in latest batch)
    capturedAt,
    // when the global holder sync last ran
    lastSyncAt,
    dbError,
  });
}