"use client";

import { createContext, useContext } from "react";

/**
 * Exposes the admin-configured brand to client components (sidebar wordmark,
 * breadcrumbs, headings). Values are resolved on the server in the root layout
 * and passed down as a plain serialisable object.
 *
 * Importing `SEO_DEFAULTS` from `@/lib/seo` would pull Prisma into the client
 * bundle, so the fallback is defined locally here instead.
 */
export type SiteBrand = {
  brandName: string;
  /** Public social links (Admin → SEO). Empty string = hide the entry. */
  social: { x: string; telegram: string };
  /** Token ticker (e.g. "PAY") — one admin setting, read by every page. */
  tokenName: string;
  /** Versioned favicon URL injected from the admin upload; "" when unset. */
  faviconUrl: string;
  siteTitle: string;
  description: string;
  /** Homepage hero copy (Admin → Hero), already resolved with placeholders. */
  hero: { headline: string; accent: string; body: string };
  /**
   * Which UI shell to render ("1" sidebar, "2" floating nav). Resolved on the
   * SERVER from env at request time (see `app/layout.tsx`), not inlined into
   * the client bundle — so flipping it needs no rebuild.
   */
  uiVersion: "1" | "2";
};

const FALLBACK: SiteBrand = {
  brandName: "Pay",
  social: { x: "", telegram: "" },
  tokenName: "PAY",
  faviconUrl: "",
  siteTitle: "Pay Token Lottery",
  description:
    "A verifiable holder lottery on Solana, powered by drand randomness.",
  hero: {
    headline: "Hold {tokenName}.",
    accent: "Win the pool.",
    body: "100% of creator fees go into the pool. Meet the minimum hold and you’re in. Each round, {winnerCount} holders are drawn at random and paid in SOL.",
  },
  uiVersion: "1",
};

const SiteContext = createContext<SiteBrand>(FALLBACK);

export function SiteProvider({
  value,
  children,
}: {
  value: SiteBrand;
  children: React.ReactNode;
}) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Current site branding. Safe outside the provider (returns defaults). */
export function useSite(): SiteBrand {
  return useContext(SiteContext);
}
