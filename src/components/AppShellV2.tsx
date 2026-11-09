"use client";

import { FloatingNav } from "@/components/FloatingNav";

/**
 * UI v2 shell — no sidebar at all.
 *
 * The page owns the full width; the only chrome is the floating pill from
 * `FloatingNav`, which is `sticky` inside normal flow so it never overlaps the
 * first section (unlike `fixed`, which would force every page to know the nav
 * height). `title` is accepted for API parity with v1 but is NOT rendered —
 * v2's navbar is links + actions only.
 *
 * Content wrapper deliberately has no max-width or horizontal padding: each
 * page already ships its own `mx-auto max-w-7xl px-4 sm:px-6 lg:px-10`, so v2
 * keeps those pages untouched.
 */
export function AppShellV2({
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ui-v2 min-h-screen bg-background text-foreground">
      <FloatingNav />
      {children}
    </div>
  );
}
