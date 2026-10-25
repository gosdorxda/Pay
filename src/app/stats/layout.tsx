import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Stats",
  description:
    "Every completed draw in one place: SOL paid to winners, wallet counts, and the leaderboard.",
};

export default function StatsLayout({ children }: { children: ReactNode }) {
  return children;
}
