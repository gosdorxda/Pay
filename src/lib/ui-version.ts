import { cache } from "react";

/**
 * Which UI shell this deployment renders ("1" = sidebar, "2" = floating nav).
 *
 * Read from a **server-only** env var at request time, NOT from a
 * `NEXT_PUBLIC_*` one: Next inlines `NEXT_PUBLIC_*` into the bundle at BUILD
 * time, so adding it afterwards (or editing it) has no effect until the app is
 * rebuilt. `UI_VERSION` is read on the server, so flipping it only needs a
 * process restart.
 *
 * `NEXT_PUBLIC_UI_VERSION` is still honoured as a build-time fallback for
 * existing deployments, and a per-browser override in
 * `localStorage["ui-version"]` wins over both (see `components/AppShell.tsx`).
 */
export type UiVersion = "1" | "2";

export const getServerUiVersion = cache((): UiVersion => {
  const raw = (
    process.env.UI_VERSION ||
    process.env.NEXT_PUBLIC_UI_VERSION ||
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "2" ? "2" : "1";
});
