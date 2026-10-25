import { prisma } from "./prisma";
import { snapshotHolders } from "./solana/holders";
import { logEvent } from "./log-buffer";

/**
 * Snapshots all non-zero holders of the Pay token on-chain and persists the
 * batch to the database (Holder rows + a HolderSnapshot row per holder, all
 * sharing one `capturedAt` timestamp so the latest batch can be queried).
 */
export async function syncHolders(): Promise<{
  totalHolders: number;
  capturedAt: Date;
}> {
  logEvent("info", "sync", "holder sync started");
  try {
    const { holders, totalHolders, fetchedAt } = await snapshotHolders();
    const capturedAt = fetchedAt;

    if (holders.length === 0) {
      logEvent("info", "sync", "holder sync done — 0 holders on-chain");
      return { totalHolders: 0, capturedAt };
    }

    await prisma.$transaction([
      prisma.holder.createMany({
        data: holders.map((h) => ({ address: h.owner })),
        skipDuplicates: true,
      }),
      prisma.holderSnapshot.createMany({
        data: holders.map((h) => ({
          holderAddress: h.owner,
          amount: BigInt(h.amount),
          capturedAt,
        })),
      }),
    ]);

    logEvent(
      "success",
      "sync",
      `holder sync done — ${totalHolders} holders @ ${capturedAt.toISOString()}`
    );
    return { totalHolders, capturedAt };
  } catch (e) {
    logEvent("error", "sync", `holder sync failed: ${(e as Error).message}`);
    throw e;
  }
}
