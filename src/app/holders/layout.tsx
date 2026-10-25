import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Holders",
  description:
    "Every wallet holding PAY, its balance, and whether it qualifies for the next draw.",
};

export default function HoldersLayout({ children }: { children: ReactNode }) {
  return children;
}
