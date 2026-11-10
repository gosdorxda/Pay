import { cache } from "react";
import { prisma } from "./prisma";

/**
 * Admin-editable homepage hero copy (server-only).
 *
 * The hero card on `/` used to hardcode two sentences. They now come from
 * `AdminSetting` under a `HERO_` prefix, so no Prisma migration is needed and
 * the layout/JSX stays untouched — only the strings change.
 *
 * Placeholders are allowed and resolved at render time:
 *   {tokenName}   → the ticker from Admin → SEO (e.g. "PAY")
 *   {winnerCount} → WINNER_COUNT from the settings registry
 * Anything else is printed verbatim, so an admin can't break the page by
 * typing a stray `{`.
 *
 * Reads are wrapped in React `cache` (one DB query per request) and never
 * throw: an unreachable DB falls back to the defaults so the homepage still
 * renders.
 */

export const HERO_KEYS = {
  headline: "HERO_HEADLINE",
  accent: "HERO_HEADLINE_ACCENT",
  body: "HERO_BODY",
  /** Launchpad credit in the animated flow ("Bags.fm trading" / "Pump.fun trading"). */
  launchpad: "HERO_LAUNCHPAD",
} as const;

export type HeroField = keyof typeof HERO_KEYS;

export interface HeroCopy {
  /** First half of the headline, plain foreground. */
  headline: string;
  /** Second half, rendered in the accent colour. */
  accent: string;
  /** Supporting paragraph under the headline. */
  body: string;
  /** Which launchpad the flow credits. Free text, so a new venue needs no code. */
  launchpad: string;
}

export const HERO_DEFAULTS: HeroCopy = {
  headline: "Hold {tokenName}.",
  accent: "Win the pool.",
  body: "100% of creator fees go into the pool. Meet the minimum hold and you’re in. Each round, {winnerCount} holders are drawn at random and paid in SOL.",
  launchpad: "Bags.fm",
};

/** Offered in the admin dropdown. Free text is still accepted by the API. */
export const LAUNCHPAD_PRESETS = [
  "Bags.fm",
  "Pump.fun",
  "Raydium",
  "Meteora",
] as const;

/**
 * Public token page for a launchpad, so the prize-pool card's "Verify fees"
 * link points at the venue the admin actually selected. Matched on the leading
 * word, case-insensitively, so "bags.fm", "Bags" and "BAGS.FM" all resolve.
 * Unknown venues fall back to bags.fm.
 */
export function launchpadTokenUrl(launchpad: string, mint: string): string {
  const key = launchpad.trim().toLowerCase();
  if (!mint) return "";
  if (key.startsWith("pump")) return `https://pump.fun/coin/${mint}`;
  if (key.startsWith("raydium")) return `https://raydium.io/swap/?outputMint=${mint}`;
  if (key.startsWith("meteora")) return `https://app.meteora.ag/tokens/${mint}`;
  return `https://bags.fm/${mint}`;
}

/** Short label for the same link ("bags.fm", "pump.fun", …). */
export function launchpadHostLabel(launchpad: string): string {
  const key = launchpad.trim().toLowerCase();
  if (key.startsWith("pump")) return "pump.fun";
  if (key.startsWith("raydium")) return "raydium.io";
  if (key.startsWith("meteora")) return "meteora.ag";
  return "bags.fm";
}

/** Max characters per field — keeps the hero from overflowing the card. */
export const HERO_LIMITS: Record<HeroField, number> = {
  headline: 60,
  accent: 60,
  body: 400,
  launchpad: 24,
};

/** Replace the supported placeholders; unknown braces stay untouched. */
export function renderHeroText(
  template: string,
  values: { tokenName: string; winnerCount: number | string }
): string {
  return template
    .split("{tokenName}").join(values.tokenName)
    .split("{winnerCount}").join(String(values.winnerCount));
}

const ALL_FIELDS = Object.keys(HERO_KEYS) as HeroField[];

/** The saved hero copy, with defaults for anything unset. Never throws. */
export const getHeroCopy = cache(async (): Promise<HeroCopy> => {
  const copy: HeroCopy = { ...HERO_DEFAULTS };
  try {
    const rows = await prisma.adminSetting.findMany({
      where: { key: { in: Object.values(HERO_KEYS) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    for (const field of ALL_FIELDS) {
      const value = byKey.get(HERO_KEYS[field]);
      if (value !== undefined && value !== "") copy[field] = value;
    }
  } catch (e) {
    console.warn(
      "[hero] copy unavailable, using defaults:",
      (e as Error).message
    );
  }
  return copy;
});

export type SaveHeroResult =
  | { ok: true; copy: HeroCopy }
  | { ok: false; errors: Partial<Record<HeroField, string>> };

/**
 * Validate + persist. Empty input restores that field's default (the row is
 * deleted), and a value identical to the default is not stored at all — so an
 * untouched hero keeps the table empty.
 */
export async function saveHeroCopy(input: unknown): Promise<SaveHeroResult> {
  const errors: Partial<Record<HeroField, string>> = {};
  const src = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;

  const next: HeroCopy = { ...getHeroCopySyncDefaults() };
  for (const field of ALL_FIELDS) {
    const raw = src[field];
    if (raw === undefined) continue;
    const value = String(raw ?? "").trim();
    if (value.length > HERO_LIMITS[field]) {
      errors[field] = `Use at most ${HERO_LIMITS[field]} characters.`;
      continue;
    }
    next[field] = value.length > 0 ? value : HERO_DEFAULTS[field];
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  for (const field of ALL_FIELDS) {
    const value = next[field];
    const isDefault = value === HERO_DEFAULTS[field];
    if (isDefault || value === "") {
      await prisma.adminSetting.deleteMany({ where: { key: HERO_KEYS[field] } });
    } else {
      await prisma.adminSetting.upsert({
        where: { key: HERO_KEYS[field] },
        update: { value },
        create: { key: HERO_KEYS[field], value },
      });
    }
  }
  return { ok: true, copy: next };
}

function getHeroCopySyncDefaults(): HeroCopy {
  return { ...HERO_DEFAULTS };
}
