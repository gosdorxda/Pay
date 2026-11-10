"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Separator,
  Skeleton,
  TextArea,
  TextField,
  Label,
  Input,
} from "@heroui/react";

/**
 * Admin → Hero copy.
 *
 * The homepage hero card used to hardcode its headline and paragraph. This
 * panel edits them; the values live in `AdminSetting` (`HERO_*`) and are read
 * by the root layout, which resolves the placeholders before passing plain
 * strings to `SiteProvider`.
 *
 * Placeholders are literal text in this panel, not templating syntax:
 *   {tokenName}   → the ticker from Admin → SEO
 *   {winnerCount} → the current WINNER_COUNT
 * Leaving a field empty restores its default (the row is deleted).
 */

type HeroCopy = { headline: string; accent: string; body: string; launchpad: string };
type HeroResponse = {
  hero?: HeroCopy;
  defaults?: HeroCopy;
  limits?: Record<keyof HeroCopy, number>;
  presets?: string[];
  errors?: Partial<Record<keyof HeroCopy, string>>;
  error?: string;
};

const EMPTY: HeroCopy = { headline: "", accent: "", body: "", launchpad: "" };

export function HeroPanel() {
  const [saved, setSaved] = useState<HeroCopy>(EMPTY);
  const [draft, setDraft] = useState<HeroCopy>(EMPTY);
  const [defaults, setDefaults] = useState<HeroCopy>(EMPTY);
  const [limits, setLimits] = useState<Record<keyof HeroCopy, number>>({
    headline: 60,
    accent: 60,
    body: 400,
    launchpad: 24,
  });
  const [presets, setPresets] = useState<string[]>([
    "Bags.fm",
    "Pump.fun",
    "Raydium",
    "Meteora",
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof HeroCopy, string>>
  >({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/hero", { cache: "no-store" });
        if (!r.ok) throw new Error("Could not load the hero copy");
        const data = (await r.json()) as HeroResponse;
        if (!alive) return;
        const h = data.hero ?? EMPTY;
        setSaved(h);
        setDraft(h);
        if (data.defaults) setDefaults(data.defaults);
        if (data.limits) setLimits(data.limits);
        if (data.presets) setPresets(data.presets);
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

  function set(field: keyof HeroCopy, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setFieldErrors((f) => ({ ...f, [field]: undefined }));
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    setFieldErrors({});
    try {
      const r = await fetch("/api/admin/hero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await r.json()) as HeroResponse;
      if (!r.ok) {
        if (data.errors) setFieldErrors(data.errors);
        throw new Error(data.error ?? "Save failed");
      }
      const next = data.hero ?? draft;
      setSaved(next);
      setDraft(next);
      setMsg("Hero copy saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    draft.headline !== saved.headline ||
    draft.accent !== saved.accent ||
    draft.body !== saved.body ||
    draft.launchpad !== saved.launchpad;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-bold">Homepage hero</p>
        <Chip size="sm" variant="soft">
          Home card
        </Chip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted leading-relaxed">
          The headline and paragraph at the top of the homepage. The second
          field renders in the accent colour. Use{" "}
          <code className="rounded bg-default px-1.5 py-0.5 text-xs">
            {"{tokenName}"}
          </code>{" "}
          and{" "}
          <code className="rounded bg-default px-1.5 py-0.5 text-xs">
            {"{winnerCount}"}
          </code>{" "}
          to insert the ticker and the number of winners. Leave a field empty to
          restore its default.
        </p>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField className="flex flex-col gap-1.5">
                <Label>Headline — first part</Label>
                <Input
                  value={draft.headline}
                  onChange={(e) => set("headline", e.target.value)}
                  placeholder={defaults.headline}
                  maxLength={limits.headline}
                />
                <p className="text-xs text-muted">
                  Plain text, e.g.{" "}
                  <span className="text-foreground">Hold {"{tokenName}"}.</span>
                </p>
              </TextField>

              <TextField className="flex flex-col gap-1.5">
                <Label>Headline — accent part</Label>
                <Input
                  value={draft.accent}
                  onChange={(e) => set("accent", e.target.value)}
                  placeholder={defaults.accent}
                  maxLength={limits.accent}
                />
                <p className="text-xs text-muted">
                  Rendered in the accent colour, e.g.{" "}
                  <span className="text-foreground">Win the pool.</span>
                </p>
              </TextField>
            </div>

            <TextField className="flex flex-col gap-1.5">
              <Label>Launchpad</Label>
              <Input
                value={draft.launchpad}
                onChange={(e) => set("launchpad", e.target.value)}
                placeholder={defaults.launchpad}
                maxLength={limits.launchpad}
              />
              <p className="text-xs text-muted">
                Drives the flow card (&ldquo;Launchpad trading&rdquo;) and the
                prize-pool card&rsquo;s Verify fees link. Free text — matching is
                on the first word, so{" "}
                <span className="text-foreground">pump.fun</span> opens pump.fun,
                anything else defaults to bags.fm.
              </p>
            </TextField>

            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Quick pick:</span>
                {presets.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant={draft.launchpad === preset ? "primary" : "secondary"}
                    aria-pressed={draft.launchpad === preset}
                    onPress={() => set("launchpad", preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            )}

            <TextField className="flex flex-col gap-1.5">
              <Label>Paragraph</Label>
              <TextArea
                value={draft.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder={defaults.body}
                maxLength={limits.body}
                rows={4}
                className="min-h-24"
              />
              <p className="text-xs text-muted">
                {draft.body.length}/{limits.body} characters
              </p>
            </TextField>
          </>
        )}

        {(fieldErrors.headline || fieldErrors.accent || fieldErrors.body) && (
          <div className="text-sm text-danger">
            {fieldErrors.headline && <p>{fieldErrors.headline}</p>}
            {fieldErrors.accent && <p>{fieldErrors.accent}</p>}
            {fieldErrors.body && <p>{fieldErrors.body}</p>}
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onPress={save}
            isPending={saving}
            isDisabled={!dirty}
          >
            Save hero copy
          </Button>
          {dirty && <span className="text-xs text-warning">Unsaved change</span>}
        </div>

        {msg && <p className="text-success text-small">{msg}</p>}
        {err && <p className="text-danger text-small">{err}</p>}
      </CardContent>
    </Card>
  );
}
