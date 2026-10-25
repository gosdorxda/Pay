import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Treasury",
  description:
    "Platform and fee wallet balances, every fee sweep on chain, and the buyback & burn ledger — live.",
};

export default function TreasuryLayout({ children }: { children: ReactNode }) {
  return children;
}
