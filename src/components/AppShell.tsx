"use client";

import { useEffect, useState } from "react";
import { AppShellV1 } from "@/components/AppShellV1";
import { AppShellV2 } from "@/components/AppShellV2";

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

/** Deploy-wide default from the environment (build-time inlined). */
function envVersion(): UiVersion {
  return process.env.NEXT_PUBLIC_UI_VERSION === "2" ? "2" : "1";
}

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
 * Current UI version. Starts from the env default so the first render matches
 * SSR, then applies the stored override in an effect.
 */
export function useUiVersion(): UiVersion {
  const [version, setVersion] = useState<UiVersion>(() => envVersion());

  useEffect(() => {
    const stored = storedVersion();
    if (stored && stored !== version) setVersion(stored);
    // Only re-read when the tab regains focus, so another tab's choice lands
    // without a full reload. Intentionally not depending on `version` (that
    // would fight the setter).
    const onFocus = () => {
      const next = storedVersion();
      if (next) setVersion(next);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
