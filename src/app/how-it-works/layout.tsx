import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTokenName } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const token = await getTokenName();
  return {
    title: "How it works",
    description: `Hold ${token} and you are in every draw. Creator fees become the prize pool, three wallets are picked with drand randomness, and anyone can check the result.`,
  };
}

export default function HowItWorksLayout({ children }: { children: ReactNode }) {
  return children;
}