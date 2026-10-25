import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Hold PAY and you are in every draw. Creator fees become the prize pool, three wallets are picked with drand randomness, and anyone can check the result.",
};

export default function HowItWorksLayout({ children }: { children: ReactNode }) {
  return children;
}