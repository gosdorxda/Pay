"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TriangleAlert, X } from "lucide-react";
import { Breadcrumbs, Chip, ProgressBar, Typography } from "@heroui/react";
import HowItWorksFlow from "@/components/HowItWorksFlow";
import RecentDraws from "@/components/RecentDraws";
import { CountUp, Icon, ThemeToggle, Skeleton } from "@/components/ui";
import { INFORMATION, NAV } from "@/components/nav";
import { useSite } from "@/components/providers/SiteProvider";
import { nextCronOccurrence } from "@/lib/cron-next";
import { fmtSolHuman, fmtSolNum, timeAgo } from "@/lib/format";

/* ──────────────────────────────────────────────────────────────────────────
   Live data. The homepage fetches /api/status (current prize pool, eligible
   count, latest round, min-eligible threshold, lottery cron) and /api/rounds
   (round history for totals + the drand chain metadata) on mount and derives
   every displayed number from those responses — no hardcoded stats.
   ────────────────────────────────────────────────────────────────────────── */
const TOKEN_NAME = "PAY";

type Winner = {
  rank: number;
  address: string;
  amountSol: number;
  payoutTx: string | null;
  status: string;
};

type Round = {
  roundNumber: number;
  status: string;
  prizePoolSol: number;
  eligibleCount: number;
  startedAt: string;
  completedAt: string | null;
  randomnessValue: string | null;
  randomnessSignature: string | null;
  randomnessRound: number | null;
  randomnessVerified: boolean;
  error: string | null;
  winners: Winner[];
};

/** Public economics of the NEXT round, computed server-side by /api/status. */
type PrizeInfo = {
  winnerCount: number;
  payoutDistribution: number[];
  effectivePoolSol: number;
  firstPrizeSol: number;
  minPrizeSol: number;
  playable: boolean;
};

type StatusResp = {
  configured: boolean;
  network: "mainnet" | "devnet";
  tokenMint: string | null;
  tokenDecimals: number;
  lotteryCron: string;
  holderSyncCron: string;
  prizePoolSol: number;
  prize: PrizeInfo | null;
  eligibleCount: number;
  totalHolders: number;
  minTokenEligibleRaw: string;
  minTokenEligibleHuman: string;
  lastRound: Round | null;
  lastSyncAt: string | null;
  dbError: string | null;
  solanaError: string | null;
};

type Chain = {
  name: string;
  hash: string;
  publicKey: string;
  scheme: string;
  period: number;
  verifyBaseUrl: string;
};

type RoundsResp = {
  network: "mainnet" | "devnet";
  chain: Chain | null;
  rounds: Round[];
  dbError: string | null;
};

/**
 * Human cadence derived from the actual gap between two cron occurrences
 * (`nextCronOccurrence` is UTC-exact). Deriving it from real occurrences
 * instead of parsing the cron string keeps step crons honest — a 15-minute
 * step cron reads "every 15m", never "every 15h" — and it always matches the
 * countdown next to it, regardless of the schedule an admin saved.
 */
function cadenceLabel(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return "—";
  const mins = Math.round(intervalMs / 60_000);
  if (mins === 60) return "hourly";
  if (mins === 1440) return "daily";
  if (mins % 1440 === 0) return `every ${mins / 1440}d`;
  if (mins % 60 === 0) return `every ${mins / 60}h`;
  return `every ${mins}m`;
}

/**
 * Absolute next-run time in UTC (the cron is interpreted as UTC, see
 * lib/cron-next). Absolute instead of "in 42m" so it adds information the big
 * countdown doesn't already show. Long cadences get a date prefix.
 */
function nextRunClock(date: Date | null, withDate = false): string {
  if (!date) return "—";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const clock = `${hh}:${mm} UTC`;
  if (!withDate) return clock;
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${day}, ${clock}`;
}

/** Compact live countdown from ms — "MM:SS" or "H:MM:SS" once an hour+. */
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "due now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Decorative art for the prize-pool card — a coin with the SOL mark plus a few
 * sparkles, drawn inline so it needs no asset request and tints itself from
 * the accent token (`currentColor`), which keeps light and dark in sync.
 */
function PoolArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={`pool-coin-float text-accent ${className}`}
      aria-hidden="true"
    >
      {/* soft halo behind the coin */}
      <circle cx="60" cy="60" r="46" fill="currentColor" opacity="0.06" />
      <circle cx="60" cy="60" r="38" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <circle
        cx="60"
        cy="60"
        r="30"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
        strokeDasharray="3 6"
      />
      {/* three slanted bars — reads as the SOL mark without the wordmark */}
      <g fill="currentColor" opacity="0.7">
        <path d="M41 45h29l-5 5H36z" />
        <path d="M47 55h29l-5 5H42z" />
        <path d="M41 65h29l-5 5H36z" />
      </g>
      {/* sparkles */}
      <path
        d="M99 20l1.9 5.1L106 27l-5.1 1.9L99 34l-1.9-5.1L92 27l5.1-1.9z"
        fill="currentColor"
        opacity="0.55"
      />
      <circle cx="19" cy="34" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="104" cy="80" r="1.6" fill="currentColor" opacity="0.35" />
      <circle cx="26" cy="96" r="1.6" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

export default function Home() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { brandName } = useSite();
  const brandInitial = brandName.trim().charAt(0).toUpperCase() || "P";

  // Mobile drawer: lock page scroll while it is open and let Escape close it,
  // so a thumb drag on the panel never scrolls the page underneath.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  // Live data: /api/status (current prize pool, eligible count, latest round,
  // min-eligible threshold, lottery cron) + /api/rounds (history + drand chain).
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [rounds, setRounds] = useState<RoundsResp | null>(null);
  const [loading, setLoading] = useState(true);
  // 1s ticker so the "next draw" countdown in the hero updates live.
  const [now, setNow] = useState(() => Date.now());

  // One-time fetch for round history + drand chain metadata (rarely changes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rounds", { cache: "no-store" }).then((x) => x.json());
        if (cancelled) return;
        setRounds(r as RoundsResp);
      } catch {
        /* leave null — UI shows placeholders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling fetch for live status — mirrors the old /live page's 5-second
  // refresh so the homepage stays live (prize pool, eligible count, latest round).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await fetch("/api/status", { cache: "no-store" }).then((x) => x.json());
        if (cancelled) return;
        setStatus(s as StatusResp);
      } catch {
        /* leave null — UI shows placeholders */
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(poll, 5000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Ticking clock — drives the hero countdown once status (lottery cron) loads.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Derived display values (safe defaults while loading).
  const network = status?.network ?? "mainnet";
  const lastRound = status?.lastRound ?? rounds?.rounds?.[0] ?? null;
  const chain = rounds?.chain ?? null;
  const eligibleHolders = status?.eligibleCount ?? 0;
  const totalHolders = status?.totalHolders ?? 0;
  // Share of all holders that clear the threshold — drives the eligible card bar.
  const eligibleShare = totalHolders > 0 ? Math.min(100, (eligibleHolders / totalHolders) * 100) : 0;
  // Homepage shows the 3 newest settled rounds only — the rest live behind
  // "view all" (/draws), so no pagination / load-more belongs here.
  const completedRounds = (rounds?.rounds ?? [])
    .filter((r) => r.status === "completed")
    .slice(0, 3);
  const rawPoolSol = status?.prizePoolSol ?? lastRound?.prizePoolSol ?? 0;
  const prize = status?.prize ?? null;
  // What will actually be paid this round (cap applied, fee deducted). Equal to
  // the raw balance unless MAX_PRIZE_SOL is set, so no surprise for default setups.
  const prizePoolSol = prize?.effectivePoolSol ?? rawPoolSol;
  const minEligibleHuman = status?.minTokenEligibleHuman ?? "—";
  // Reads as a phrase so it can drop into a sentence, and falls back to wording
  // instead of "—" while /api/status is still in flight (SSR + first paint).
  const minRule = status?.minTokenEligibleHuman
    ? `at least ${minEligibleHuman} ${TOKEN_NAME}`
    : "the minimum balance";
  // Prose reads from the same value as the badge, so changing WINNER_COUNT in
  // settings can't leave the copy claiming a different number of winners.
  const winnerCount = prize?.winnerCount ?? 3;
  // "50% / 30% / 20%" — the configured split for the next round.
  const splitLabel = (prize?.payoutDistribution ?? [])
    .map((p) => `${Math.round(p * 100)}%`)
    .join(" / ");
  // Mirrors the engine skip rule, surfaced honestly instead of "pool > 0".
  const prizeState = loading
    ? "Loading"
    : prize?.playable
      ? "Ready"
      : prizePoolSol > 0
        ? "Below minimum prize"
        : "Awaiting funds";
  // Live-draw banner: a round is mid-execution, or we count down to the next one.
  const drawing = lastRound?.status === "drawing";
  const nextDraw = useMemo(
    () => (status ? nextCronOccurrence(status.lotteryCron, new Date(now)) : null),
    [status, now],
  );
  const countdown = nextDraw ? nextDraw.getTime() - now : null;
  // Ring progress: fraction of the current draw interval already elapsed (0→100).
  const nextNext = useMemo(
    () => (status && nextDraw ? nextCronOccurrence(status.lotteryCron, new Date(nextDraw.getTime() + 1000)) : null),
    [status, nextDraw],
  );
  const intervalMs = nextDraw && nextNext ? nextNext.getTime() - nextDraw.getTime() : 0;
  const prevDrawTs = intervalMs > 0 && nextDraw ? nextDraw.getTime() - intervalMs : 0;
  const progress =
    intervalMs > 0 && !drawing
      ? Math.min(100, Math.max(0, ((now - prevDrawTs) / intervalMs) * 100))
      : 0;
  // Cadence derived from the two nearest cron occurrences, so the tile footer
  // can never contradict the countdown above it (and step crons stay honest).
  const cadence = cadenceLabel(intervalMs);
  const longCadence = intervalMs >= 86_400_000;
  // How often the holder snapshot itself refreshes — explains why the eligible
  // bar is a gauge (a share of holders) and not a ticking countdown.
  const holderSyncCadence = useMemo(() => {
    if (!status?.holderSyncCron) return "—";
    // Anchored at the epoch so the answer is stable across renders (no ceil to
    // "the next tick"), which keeps SSR and the client in agreement.
    const a = nextCronOccurrence(status.holderSyncCron, new Date(0));
    const b = a
      ? nextCronOccurrence(status.holderSyncCron, new Date(a.getTime() + 1000))
      : null;
    return a && b ? cadenceLabel(b.getTime() - a.getTime()) : "—";
  }, [status?.holderSyncCron]);

  /** Active state matches AppShell: "Home" active on `/`, route links match
      pathname. Draws is a real route now — the in-page view toggle is gone, so
      clicking Draws navigates to /draws just like every other nav entry and the
      URL always reflects the page you're on (bookmarkable, back/forward work). */
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-(--border) bg-surface transition-[width,transform] duration-200 lg:translate-x-0 ${collapsed ? "lg:w-[68px]" : ""} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-14 shrink-0 items-center gap-2 border-b border-(--border) px-4 ${collapsed ? "lg:justify-center" : ""}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-sm font-bold text-accent">{brandInitial}</span>
          {!collapsed && (
            <span className="min-w-0 truncate font-bold tracking-tight">{brandName}</span>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-default/40 hover:text-foreground lg:hidden"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const cls = `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition w-full text-left ${collapsed ? "lg:justify-center lg:px-0" : ""} ${active ? "bg-default font-medium text-foreground" : "font-medium text-muted hover:bg-default/40 hover:text-foreground"}`;
            const inner = (
              <>
                <Icon name={item.icon} className="shrink-0 text-(--nav-icon)" />
                <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
              </>
            );
            // All nav entries are real route links now — Home → /, Draws → /draws,
            // matching AppShell so the URL always reflects the page you're on.
            return (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cls}
              >
                {inner}
              </a>
            );
          })}
          {/* Information — external community links pinned to the bottom of the
              nav (the grouping otcdesks.cash uses for Docs / Terms / X, minus
              the docs and terms pages this project doesn't have). */}
          <div className="mt-auto flex flex-col gap-1 pt-2">
            <span
              className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted ${collapsed ? "lg:hidden" : ""}`}
            >
              Information
            </span>
            {INFORMATION.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-default/40 hover:text-foreground ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              >
                <Icon name={item.icon} className="shrink-0 text-(--nav-icon)" />
                <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
                <Icon
                  name="arrow-up-right"
                  className={`ml-auto h-3.5 w-3.5 opacity-50 ${collapsed ? "lg:hidden" : ""}`}
                />
              </a>
            ))}
          </div>
        </nav>
        <div className="hidden shrink-0 border-t border-(--border) p-3 lg:block">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-2 text-xs text-muted transition hover:text-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[68px]" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-20 border-b border-(--border) bg-surface/80 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition hover:bg-default/40 hover:text-foreground lg:hidden"
              aria-label="Open menu"
            >
              <Icon name="menu" />
            </button>
            <div className="min-w-0 flex-1">
              <Breadcrumbs isDisabled>
                <Breadcrumbs.Item href="/">{brandName}</Breadcrumbs.Item>
                <Breadcrumbs.Item>Home</Breadcrumbs.Item>
              </Breadcrumbs>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        {/* Hero — pitch only: title, description and CTAs on one surface.
            The live numbers sit in the tile strip below, so the fold reads
            headline → status tiles → draws. */}
        <section className="pt-5 pb-5 sm:pt-10 sm:pb-6">
          <div className="relative overflow-hidden rounded-lg border border-(--border) bg-surface">
            {/* Soft accent halo — token-based, so it adapts to light/dark. */}
            <div
              className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative flex flex-col gap-5 p-4 sm:p-6">
              <div className="flex flex-col gap-2">
                <h1 className="max-w-3xl text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                  Hold {TOKEN_NAME}. <span className="text-accent">Win the draw.</span>
                </h1>
                <Typography type="body-sm" color="muted" className="max-w-2xl text-pretty">
                  Hold {minRule} and you’re in. Creator fees become the prize pool, split in SOL
                  between {winnerCount} wallets picked at random with drand — verifiable by anyone.
                </Typography>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <Link href="/draws" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90">
                  View draws
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
                <a href="#how" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-(--border) px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-default/40">
                  How it works
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Live strip — the three numbers that used to sit inside the hero card
            now get their own promo-style tiles (bc.game daily-contest layout):
            prize pool (widest, with art + animated sheen), next-draw countdown,
            and eligible holders. Kept directly under the hero so the fold still
            answers "what can I win / when / am I in" without scrolling. */}
        <section id="draw" className="pb-6">
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
            {/* Prize pool — the wide tile */}
            <div className="relative overflow-hidden rounded-lg border border-(--border) bg-surface p-4 sm:col-span-2 sm:p-6 lg:col-span-1">
              <div className="pool-sheen pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Prize pool</span>
                    {loading ? (
                      /* Same footprint as the `sm` chip, so the number below
                         doesn't jump when the first /api/status response lands. */
                      <Skeleton className="h-[22px] w-24 rounded-full" />
                    ) : (
                      <span
                        title={
                          prize && prizePoolSol > 0 && !prize.playable
                            ? `Below the ${fmtSolHuman(prize.minPrizeSol)} minimum — the round is skipped until the pool grows.`
                            : undefined
                        }
                      >
                        <Chip
                          size="sm"
                          variant="soft"
                          color={
                            prize?.playable
                              ? "success"
                              : prizePoolSol > 0
                                ? "warning"
                                : "default"
                          }
                        >
                          {prizeState}
                        </Chip>
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    {loading ? (
                      <>
                        <Skeleton className="h-10 w-40 sm:h-12 sm:w-52" />
                        <Skeleton className="h-3.5 w-8" />
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-4xl font-semibold leading-none tracking-tight tabular-nums sm:text-5xl">
                          {/* Counts up from 0 when the first poll lands; later
                              polls only animate the (small) delta. */}
                          <CountUp value={prizePoolSol} format={(n) => fmtSolNum(n)} />
                        </span>
                        <span className="font-mono text-sm text-muted">SOL</span>
                      </>
                    )}
                  </div>
                  <p className="max-w-sm text-sm text-muted">
                    Funded by creator fees, paid out in SOL to {winnerCount} randomly drawn wallets.
                  </p>
                </div>
                <PoolArt className="hidden h-24 w-24 shrink-0 sm:block" />
              </div>
              <div className="relative mt-5 grid grid-cols-2 gap-3 border-t border-(--border) pt-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">
                    Winners
                  </span>
                  {loading ? (
                    <Skeleton className="h-4 w-10" />
                  ) : (
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {prize ? prize.winnerCount : "—"}
                      </span>
                      {splitLabel ? (
                        <span
                          className="text-xs text-muted"
                          title="Share of the pool each winner gets, by rank."
                        >
                          {splitLabel}
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">
                    1st prize ≈
                  </span>
                  {loading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    <span
                      className="font-mono text-sm font-semibold tabular-nums"
                      title="Estimated 1st prize: the current pool minus the platform fee, split by rank."
                    >
                      {!prize || prize.firstPrizeSol <= 0 ? (
                        "—"
                      ) : (
                        <CountUp
                          value={prize.firstPrizeSol}
                          format={(n) => fmtSolHuman(n)}
                        />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Next draw — countdown + interval progress (flex column so the
                progress footer lines up across all three tiles) */}
            <div className="relative flex flex-col overflow-hidden rounded-lg border border-(--border) bg-surface p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted">
                  Next draw
                </span>
                <Chip size="sm" variant="soft" color={drawing ? "warning" : "accent"}>
                  {drawing ? "In progress" : "Scheduled"}
                </Chip>
              </div>
              <div className="mt-4 flex flex-col gap-1">
                {loading ? (
                  <Skeleton className="h-9 w-28 sm:h-10 sm:w-32" />
                ) : (
                  <span
                    className={`font-mono text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl ${
                      drawing ? "text-warning" : "text-foreground"
                    }`}
                  >
                    {drawing ? "live" : countdown != null ? fmtCountdown(countdown) : "—"}
                  </span>
                )}
                {loading ? (
                  <Skeleton className="h-3 w-24" />
                ) : (
                  <span className="text-xs text-muted">
                    {drawing
                      ? `Draw #${lastRound?.roundNumber ?? ""} in progress`
                      : "until the next draw"}
                  </span>
                )}
              </div>
              <div className="mt-auto pt-5">
                <ProgressBar
                  aria-label="Time until the next draw"
                  value={drawing ? 100 : progress}
                  maxValue={100}
                  size="sm"
                  color={drawing ? "warning" : "accent"}
                  className="gap-1.5"
                >
                  <ProgressBar.Track className="bg-default/40">
                    <ProgressBar.Fill
                      className={`transition-[width] duration-700 ease-out ${
                        drawing ? "bg-warning" : "bg-accent"
                      }`}
                    />
                  </ProgressBar.Track>
                </ProgressBar>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
                  {loading ? (
                    <Skeleton className="h-3 w-24" />
                  ) : (
                    /* Short by design — the cadence lives in the tooltip so
                       the footer reads like the countdown above it. */
                    <span
                      className="truncate"
                      title={`Draws ${cadence} · next ${nextRunClock(nextDraw, longCadence)} (cron is interpreted as UTC)`}
                    >
                      Next{" "}
                      <span className="font-mono tabular-nums">
                        {nextRunClock(nextDraw, longCadence)}
                      </span>
                    </span>
                  )}
                  {/* Same quiet link treatment as "open beacon" on /draws:
                      thin, underlined, inherited colour, small arrow. */}
                  <Link
                    href="/draws"
                    aria-label="View all draws"
                    className="-my-1 inline-flex items-center gap-1 py-1 underline transition-colors hover:text-foreground"
                  >
                    View all
                    <Icon name="arrow-right" className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Eligible holders — count + share of all holders (same flex
                column as the timer tile, footer pinned to the bottom) */}
            <div className="relative flex flex-col overflow-hidden rounded-lg border border-(--border) bg-surface p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted">
                  Eligible wallets
                </span>
                {loading ? (
                  <Skeleton className="h-[22px] w-24 rounded-full" />
                ) : (
                  <Chip size="sm" variant="soft" color="default">
                    {status?.minTokenEligibleHuman ? `Min ${minEligibleHuman} ${TOKEN_NAME}` : "Minimum balance"}
                  </Chip>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-1">
                {loading ? (
                  <Skeleton className="h-9 w-24 sm:h-10 sm:w-28" />
                ) : (
                  <span className="font-mono text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">
                    <CountUp value={eligibleHolders} />
                  </span>
                )}
                {loading ? (
                  <Skeleton className="h-3 w-24" />
                ) : (
                  <span className="text-xs text-muted">
                    {eligibleHolders > 0
                      ? "wallets entered"
                      : "No wallet meets the minimum yet"}
                  </span>
                )}
              </div>
              <div className="mt-auto pt-5">
                <ProgressBar
                  aria-label="Share of holders eligible"
                  value={eligibleShare}
                  maxValue={100}
                  size="sm"
                  color="success"
                  className="gap-1.5"
                >
                  <ProgressBar.Track className="bg-default/40">
                    {/* Eased width so a fresh snapshot visibly lands instead of
                        snapping — the bar's only source of motion. */}
                    <ProgressBar.Fill className="bg-success transition-[width] duration-700 ease-out" />
                  </ProgressBar.Track>
                </ProgressBar>
                {/* Two words only: the tile title already says "Eligible
                    wallets", so the footer just carries the share. Totals,
                    snapshot age and refresh cadence live in the tooltip. */}
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                  {loading ? (
                    <Skeleton className="h-3 w-20" />
                  ) : (
                    <span
                      className="font-mono tabular-nums"
                      title={
                        [
                          totalHolders > 0
                            ? `${Math.round(eligibleShare)}% of ${totalHolders.toLocaleString()} tracked holders qualify`
                            : null,
                          status?.lastSyncAt
                            ? `Snapshot taken ${timeAgo(status.lastSyncAt)}`
                            : null,
                          holderSyncCadence !== "—"
                            ? `refreshed ${holderSyncCadence}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                    >
                      {totalHolders === 0
                        ? "No holders yet"
                        : `${Math.round(eligibleShare)}% eligible`}
                    </span>
                  )}
                  <Link
                    href="/eligibility"
                    aria-label="View all wallets"
                    className="-my-1 inline-flex items-center gap-1 py-1 underline transition-colors hover:text-foreground"
                  >
                    View all
                    <Icon name="arrow-right" className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Completed rounds — collapsible rows: #N · Pump.fun → Pay → drand → winners */}
        <section className="pb-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-col gap-1">
              <Typography type="h4">Recent draws</Typography>
              {/* Describes the rows below without repeating their numbers: the
                  collapsed row already carries #N, the pool, the age and the
                  winner avatars, so this line only explains the affordance. */}
              <Typography type="body-sm" color="muted">
                Each draw, from the Pump.fun fee to the wallets it paid. Open one
                to see the receipts.
              </Typography>
            </div>
            <Link
              href="/draws"
              aria-label="View all draws"
              className="-my-1 mr-0 inline-flex items-center gap-1 py-1 text-sm underline transition-colors hover:text-foreground sm:mr-5"
            >
              View all draws
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </div>

          <RecentDraws
            rounds={completedRounds}
            chain={chain}
            network={network}
            loading={loading}
            dbError={rounds?.dbError ?? null}
          />
        </section>

        {/* How it works — animated flow: Pump.fun → Pay → drand → winners */}
        <section id="how" className="pb-12 flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Typography type="h4">How a draw works</Typography>
            <Typography type="body-sm" color="muted" className="max-w-2xl">
              We snapshot every wallet holding {minRule}, draw {winnerCount} winners with a
              drand-seeded shuffle, and pay them in SOL. Anyone can re-run it in the browser and check
              the result.
            </Typography>
          </div>

          <HowItWorksFlow
            winners={lastRound?.winners ?? []}
            network={network}
            chainName={chain?.name}
          />

          <div className="flex max-w-2xl gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning text-(--warning-foreground)">
              <TriangleAlert size={12} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                id="flow-disclaimer"
                className="text-sm font-semibold tracking-tight text-foreground"
              >
                Disclaimer
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The animation shows how a draw works. It doesn’t show live odds. {TOKEN_NAME} is a
                lottery token, not an investment. Its price is set by the Pump.fun market, prizes are
                paid only from the creator-fee pool, and you can lose money holding it.
              </p>
              <Link
                href="/how-it-works"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-accent underline-offset-4 hover:underline"
              >
                Read the full verification guide
                <Icon name="arrow-right" className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}
