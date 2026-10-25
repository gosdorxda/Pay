import type { Metadata } from "next";
import type { ReactNode } from "react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roundNumber: string }>;
}): Promise<Metadata> {
  const { roundNumber: n } = await params;
  const num = Number(n);
  const valid = Number.isInteger(num) && num > 0;
  const title = valid ? `Draw #${num}` : "Draw";
  return {
    title,
    description: valid
      ? `What happened in draw #${num}: the winners, the random number behind them, and the checks anyone can re-run.`
      : "A draw from the lottery: what happened, the random number behind it, and the checks anyone can re-run.",
  };
}

export default function RoundLayout({ children }: { children: ReactNode }) {
  return children;
}
