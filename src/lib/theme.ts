import { cache } from "react";
import { prisma } from "./prisma";

/**
 * Admin-editable DEFAULT theme (server-only).
 *
 * The per-visitor choice still wins: `use-theme.ts` stores the toggle in
 * localStorage under `theme`, and the inline script in `app/layout.tsx` applies
 * the stored value before first paint. This setting only decides what a visitor
 * with NO stored preference gets, so switching it to `dark` makes every new
 * visitor start dark while existing visitors keep their pick.
 *
 * Storage: one row in the key/value `AdminSetting` table under
 * `THEME_DEFAULT` ("dark" | "light"), so no Prisma migration is needed.
 * Reads are wrapped in React `cache` (one query per request) and never throw —
 * an unreachable DB falls back to `dark`.
 */

export type DefaultTheme = "dark" | "light";

const SETTING_KEY = "THEME_DEFAULT";

/** Used when nothing is saved (or the DB is unreachable). */
export const FALLBACK_DEFAULT_THEME: DefaultTheme = "dark";

function normalize(value: unknown): DefaultTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

/** The saved default theme, or `dark` when unset/unreadable. */
export const getDefaultTheme = cache(async (): Promise<DefaultTheme> => {
  try {
    const row = await prisma.adminSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    return normalize(row?.value) ?? FALLBACK_DEFAULT_THEME;
  } catch (e) {
    console.warn(
      "[theme] default theme unavailable, using fallback:",
      (e as Error).message
    );
    return FALLBACK_DEFAULT_THEME;
  }
});

/** Persist the default theme. Throws on an invalid value. */
export async function saveDefaultTheme(value: unknown): Promise<DefaultTheme> {
  const next = normalize(value);
  if (!next) throw new Error('Default theme must be "dark" or "light"');
  await prisma.adminSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: next },
    create: { key: SETTING_KEY, value: next },
  });
  return next;
}
