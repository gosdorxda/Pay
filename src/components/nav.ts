/**
 * Shared sidebar navigation — single source of truth consumed by both the
 * homepage (src/app/page.tsx) and AppShell (src/components/AppShell.tsx), so
 * adding a route only needs an edit here. Icon names map to the Icon set in
 * components/ui.tsx.
 */
export type NavItem = { label: string; href: string; icon: string };

export const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: "home" },
  { label: "Draws", href: "/draws", icon: "draws" },
  { label: "Eligibility", href: "/eligibility", icon: "user-check" },
  { label: "Treasury", href: "/treasury", icon: "landmark" },
  { label: "Stats", href: "/stats", icon: "chart-line" },
  { label: "Verify", href: "/verify", icon: "check" },
  { label: "How it works", href: "/how-it-works", icon: "circle-question-mark" },
];

/**
 * External community links — rendered under the "Social media" heading pinned to
 * the bottom of the sidebar (same grouping otcdesks.cash uses for Docs / Terms /
 * X, minus the docs and terms pages this project doesn't have yet). Both entries
 * open in a new tab.
 *
 * PLACEHOLDER URLs — swap them for the real profiles. This is the only place
 * these two links live, so a handle change is a one-line edit each.
 */
export const INFORMATION: NavItem[] = [
  { label: "X", href: "https://x.com/", icon: "x" },
  { label: "Telegram", href: "https://t.me/", icon: "telegram" },
];