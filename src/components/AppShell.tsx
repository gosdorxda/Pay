"use client";

import { useEffect, useState } from "react";
import { AppShellV1 } from "@/components/AppShellV1";
import { AppShellV2 } from "@/components/AppShellV2";
import { useSite } from "@/components/providers/SiteProvider";

/**
 * Shell dispatcher — picks the UI version and renders the matching chrome.
 *
 * v1 (sidebar) is the default and is frozen in `AppShellV1.tsx`; v2 (floating
 * nav) lives in `AppShellV2.tsx` + `FloatingNav.tsx`. Keeping the switch here
 * means every route that already renders `<AppShell>` keeps working unchanged.
 *
 * Resolution order (first match wins):
 *   1. `NEXT_PUBLIC_UI_VERSION=2` — deploy-wide switch, set it in `.env`/VPS.
 *   2. `localStorage["ui-version"]` — per-browser override, handy to compare
 *      both shells without a rebuild.
 *   3. v1.
 *
 * SSR/first paint always renders v1 (`version` starts as "1"), so the markup
 * the server sent and the first client render agree — no hydration mismatch,
 * no flash. A browser with v2 stored swaps to v2 on the next frame.
 */
export type UiVersion = "1" | "2";

const STORAGE_KEY = "ui-version";

/** Read the per-browser override, if any. Safe on the server. */
function storedVersion(): UiVersion | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "1" || raw === "2" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Current UI version.
 *
 * The base comes from the SERVER (`SiteProvider.uiVersion`, read from the
 * `UI_VERSION` env at request time), so switching shells needs no rebuild — a
 * `NEXT_PUBLIC_*` value would be frozen into the bundle at build time. A
 * per-browser `localStorage["ui-version"]` still wins, which is handy for
 * comparing both shells.
 *
 * The first client render always uses the server value, so hydration matches.
 */
export function useUiVersion(): UiVersion {
  const { uiVersion } = useSite();
  const [version, setVersion] = useState<UiVersion>(uiVersion);

  useEffect(() => {
    setVersion(storedVersion() ?? uiVersion);
    // Re-read when the tab regains focus so another tab's choice lands.
    const onFocus = () => setVersion(storedVersion() ?? uiVersion);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [uiVersion]);

  return version;
}

/** Persist a version choice for this browser and apply it immediately. */
export function setUiVersion(version: UiVersion): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    /* private mode / storage disabled — the env default still applies */
  }
}

export function AppShell({
  title = "Home",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const version = useUiVersion();
  if (version === "2") {
    return <AppShellV2 title={title}>{children}</AppShellV2>;
  }
  return <AppShellV1 title={title}>{children}</AppShellV1>;
}
