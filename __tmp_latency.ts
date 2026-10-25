import { prisma } from "./src/lib/prisma";

const t = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const s = performance.now();
  const r = await fn();
  console.log(label.padEnd(38), Math.round(performance.now() - s), "ms");
  return r;
};

const three = () =>
  Promise.all([prisma.lotteryRound.count(), prisma.winner.count(), prisma.holder.count()]);

async function main() {
  await t("warm: SELECT 1 (opens conn #1)", () => prisma.$queryRaw`SELECT 1`);
  await t("warm: SELECT 1", () => prisma.$queryRaw`SELECT 1`);
  await t("parallel x3 (pool grows)", three);
  await t("parallel x3 (warm #2)", three);
  await t("parallel x3 (warm #3)", three);
  const five = () =>
    Promise.all([
      prisma.lotteryRound.count(),
      prisma.winner.count(),
      prisma.holder.count(),
      prisma.holderSnapshot.count(),
      prisma.excludedWallet.count(),
    ]);
  await t("parallel x5 (pool grows)", five);
  await t("parallel x5 (warm #2)", five);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
