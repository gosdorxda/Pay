"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, Chip, Skeleton } from "@heroui/react";

/**
 * Admin → Appearance: the DEFAULT theme for first-time visitors.
 *
 * This does not change what a visitor already picked — `use-theme.ts` stores
 * that per browser and the inline script in `app/layout.tsx` prefers it. It
 * only decides the starting point for someone with no stored choice, which is
 * why the copy says "first visit" instead of "site theme".
 *
 * Saved through `/api/admin/theme` into the `AdminSetting` key/value table.
 */
type ThemeValue = "dark" | "light";

export function ThemePanel() {
  const [saved, setSaved] = useState<ThemeValue | null>(null);
  const [draft, setDraft] = useState<ThemeValue>("dark");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/theme", { cache: "no-store" });
        if (!r.ok) throw new Error("Could not load the default theme");
        const data = (await r.json()) as { value?: ThemeValue };
        const value = data.value === "light" ? "light" : "dark";
        if (!alive) return;
        setSaved(value);
        setDraft(value);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: draft }),
      });
      const data = (await r.json()) as { value?: ThemeValue; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      setSaved(data.value ?? draft);
      setMsg(`New visitors now start in ${data.value ?? draft} mode.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = saved !== null && draft !== saved;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-bold">Default theme</p>
        <Chip size="sm" variant="soft">
          First visit only
        </Chip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted leading-relaxed">
          Which theme someone with{" "}
          <span className="text-foreground">no saved preference</span> sees when
          they open the site. A visitor who has flipped the toggle keeps their
          own choice — clearing site data makes them fall back to this default
          again.
        </p>

        {loading ? (
          <Skeleton className="h-10 w-64 rounded-lg" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(["light", "dark"] as const).map((value) => (
              <Button
                key={value}
                variant={draft === value ? "primary" : "secondary"}
                aria-pressed={draft === value}
                onPress={() => setDraft(value)}
              >
                {value === "dark" ? "Dark" : "Light"}
                {saved === value ? " (saved)" : ""}
              </Button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onPress={save} isPending={saving} isDisabled={!dirty}>
            Save default
          </Button>
          {dirty && <span className="text-xs text-warning">Unsaved change</span>}
        </div>

        {msg && <p className="text-success text-small">{msg}</p>}
        {err && <p className="text-danger text-small">{err}</p>}
      </CardContent>
    </Card>
  );
}
