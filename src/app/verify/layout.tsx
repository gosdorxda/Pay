import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Verify",
  description:
    "Check any draw in your browser: the random number we used must match the one drand published, and it must reproduce the same winners.",
};

export default function VerifyLayout({ children }: { children: ReactNode }) {
  return children;
}
