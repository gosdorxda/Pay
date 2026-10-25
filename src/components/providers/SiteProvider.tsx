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
  siteTitle: string;
  description: string;
};

const FALLBACK: SiteBrand = {
  brandName: "Pay",
  siteTitle: "PAY Token Lottery",
  description:
    "A verifiable holder lottery for the PAY token on Solana, powered by drand randomness.",
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
