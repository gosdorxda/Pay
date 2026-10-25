import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Eligibility",
  description:
    "Check whether a Solana wallet holds enough PAY to enter the next draw.",
};

export default function EligibilityLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
