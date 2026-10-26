"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Clock, Minus } from "lucide-react";
import { Button, Chip } from "@heroui/react";
import { DrandBeacon } from "@/components/DrandBeacon";
import { CountUp, Icon, Skeleton, SkeletonRows } from "@/components/ui";
import { fmtDateTimeUtc, fmtSolHuman, fmtSolNum, timeAgo } from "@/lib/format";

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
type Chain = {
  name: string;
  hash: string;
  publicKey: string;
  scheme: string;
  period: number;
  verifyBaseUrl: string;
};
type RoundsResponse = {
  network: string;
  chain: Chain;
  rounds: Round[];
  /** Rows matching the current filter (not the page). */
  total: number;
  totals: {
    all: number;
    completed: number;
    failed: number;
    skipped: number;
    /** SOL actually sent to winners, all-time. */
    paidSol: number;
  };
  latest: { roundNumber: number; status: string; at: string | null } | null;
  limit: number;
  offset: number;
  hasMore: boolean;
  dbError: string | null;
};

/** Rows per page. Server-paginated, so this is a page size, not a window cap. */
const PAGE_SIZE = 10;

const shortAddr = (a: string, h = 4, t = 4): string =>
  !a || a.length <= h + t ? a : `${a.slice(0, h)}…${a.slice(-t)}`;
const explorer = (v: string, kind: "address" | "tx", net: string): string =>
  `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${v}${
    net === "devnet" ? "?cluster=devnet" : ""
  }`;
const fmtTime = (iso: string | null): string => fmtDateTimeUtc(iso);

/** Tailwind classes for a circular rank badge, tiered like a podium.
 *  Subtle tints (gold / silver / bronze) instead of saturated gradients so
 *  they sit calmly inside the HeroUI theme instead of fighting it. */
const rankBadge = (rank: number): string => {
  switch (rank) {
    case 1:
      return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
    case 2:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    case 3:
      return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
    default:
      return "bg-default text-muted ring-1 ring-(--border)";
  }
};

/** DB status values are lowercase machine strings — show them as normal words. */
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  sent: "Paid",
  pending: "Pending",
  drawing: "In progress",
  skipped: "Skipped",
  failed: "Failed",
};
const statusLabel = (status: string): string =>
  STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

/**
 * The engine stores a technical reason on skipped rounds (e.g.
 * "Prize pool 0 SOL (balance at/below reserve) — round skipped"). Visitors don't
 * need that log line, so map the two known cases to plain sentences and keep the
 * raw text only as a fallback.
 */
function skipReason(raw: string | null): string {
  if (!raw) return "There was nothing in the prize pool to pay out.";
  const s = raw.toLowerCase();
  if (s.includes("below minimum")) {
    return "The prize pool didn’t reach the minimum needed for a draw.";
  }
  if (s.includes("at/below reserve") || s.includes("0 sol")) {
    return "There was nothing in the prize pool to pay out.";
  }
  return raw;
}

/**
 * Same idea for failed draws: the stored message is an operator log line like
 * `payout tx 5Dh6… failed on-chain: {"InsufficientFundsForRent":{…}}`. Show one
 * plain sentence and keep the raw text on `title` for anyone who wants details.
 */
function failureReason(raw: string | null): string {
  if (!raw) return "Something went wrong and this draw didn’t finish.";
  const s = raw.toLowerCase();
  if (s.includes("rent-exempt minimum")) {
    return "A prize was too small to create a winner’s wallet, so nothing was paid out, this round needs a bigger prize pool.";
  }
  if (s.includes("failed on-chain") || s.includes("insufficientfunds")) {
    return "The payout transaction failed on-chain, so this draw didn’t pay out.";
  }
  if (s.includes("block height exceeded") || s.includes("has expired")) {
    return "The payout transaction expired before it could confirm, no SOL left the wallet, so this draw didn’t pay out.";
  }
  if (s.includes("not retrievable")) {
    return "The payout transaction couldn’t be read back from the network, so this draw is unconfirmed.";
  }
  return raw;
}

/** Maps a round/winner status string to a soft chip with a leading status icon. */
function StatusChip({ status, className }: { status: string; className?: string }) {
  const color: "success" | "danger" | "warning" | "default" =
    status === "completed" || status === "sent"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "skipped"
          ? "default"
          : "warning";
  return (
    <Chip size="sm" variant="soft" color={color} className={className}>
      {color === "success" ? (
        <CircleCheck size={14} aria-hidden="true" />
      ) : color === "danger" ? (
        <CircleX size={14} aria-hidden="true" />
      ) : color === "default" ? (
        <Minus size={14} aria-hidden="true" />
      ) : (
        <Clock size={14} aria-hidden="true" />
      )}
      <Chip.Label>{statusLabel(status)}</Chip.Label>
    </Chip>
  );
}

export default function DrawsList({
  className = "flex flex-col",
}: {
  className?: string;
}) {
  const [data, setData] = useState<RoundsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** Zero-based page. The API does the slicing, so the browser never holds more
   *  than one page of rounds (each with winners). */
  const [page, setPage] = useState(0);

  const fetchRounds = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const r = await fetch(
          `/api/rounds?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          { cache: "no-store" }
        );
        setData((await r.json()) as RoundsResponse);
        setErr(null);
      } catch (e) {
        // A failed background refresh keeps the last good snapshot on screen;
        // only a first load owns the error state.
        if (!silent) {
          setErr((e as Error).message);
          setData(null);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page]
  );

  /* First load, then a quiet 15 s refresh — the same window the API caches, so a
     tab left open keeps the current page honest and picks up newly settled rounds
     without flashing the skeletons. Skipped while the tab is in the background. */
  useEffect(() => {
    fetchRounds();
    const id = window.setInterval(() => {
      if (!document.hidden) fetchRounds(true);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [fetchRounds]);

  /* A reset (or a fresh clone) can shrink the history under the current page.
     Clamp to the last real page instead of storing a corrected value, so the
     refetch that follows lands on a page that exists. */
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  useEffect(() => {
    if (data && page > pageCount - 1) setPage(pageCount - 1);
  }, [data, page, pageCount]);

  const net = data?.network ?? "mainnet";
  const chain = data?.chain;
  const rounds = data?.rounds ?? [];
  const totals = data?.totals;
  const latest = data?.latest ?? null;
  const firstShown = rounds.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = page * PAGE_SIZE + rounds.length;
  const listTop = useRef<HTMLDivElement>(null);

  /** Pager handler: new page, then bring the list back into view (the controls
   *  sit under it, so without this the new rows load off-screen above). */
  const goToPage = (next: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, next)));
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Every figure in the summary is all-time, straight from the API's totals —
  // nothing is derived from the 10 rows on screen any more.
  const pct = (n: number) =>
    totals && totals.all > 0 ? Math.round((n / totals.all) * 100) : 0;

  return (
    <div className={className} ref={listTop}>
      {/* Summary stats card — all-time, from the API's totals */}
      {data && !loading && (
        <div className="mb-6 overflow-hidden rounded-lg border border-(--border)">
          <div className="grid grid-cols-2 gap-px bg-(--border) sm:grid-cols-4">
            <Stat
              label="Draws"
              value={<CountUp value={totals?.all ?? 0} />}
              caption={`${totals?.completed ?? 0} completed`}
            />
            <Stat
              label="Skipped"
              value={<CountUp value={totals?.skipped ?? 0} />}
              caption={
                (totals?.failed ?? 0) > 0
                  ? `${pct(totals?.skipped ?? 0)}% · ${totals?.failed} failed`
                  : `${pct(totals?.skipped ?? 0)}% of draws`
              }
            />
            <Stat
              label="Paid out"
              value={
                <CountUp value={totals?.paidSol ?? 0} format={(n) => fmtSolNum(n)} />
              }
              caption="SOL to winners"
            />
            <Stat
              label="Latest draw"
              value={timeAgo(latest?.at ?? null)}
              caption={
                latest
                  ? `draw #${latest.roundNumber} · ${statusLabel(latest.status)}`
                  : "no draws yet"
              }
            />
          </div>
          <div className="border-t border-(--border) px-4 py-2 sm:px-5">
            <p className="text-xs text-muted">
              Every settled draw, newest first — skipped and failed rounds included.
            </p>
          </div>
        </div>
      )}

      {loading && (
        <>
          {/* Skeleton summary card mirroring the real stats layout */}
          <div className="mb-6 overflow-hidden rounded-lg border border-(--border)">
            <div className="grid grid-cols-2 gap-px bg-(--border) sm:grid-cols-4">
              <StatSkeleton label="Draws" />
              <StatSkeleton label="Skipped" />
              <StatSkeleton label="Paid out" />
              <StatSkeleton label="Latest draw" />
            </div>
          </div>
          <SkeletonRows count={3} />
        </>
      )}

      {err && (
        <div className="py-12 text-center">
          <p className="text-danger text-sm">
            Couldn’t load the draw history. Check your connection and try again.
          </p>
        </div>
      )}
      {data?.dbError && (
        <p className="text-danger text-sm py-4">
          The draw history couldn’t be read right now. Please try again in a moment.
        </p>
      )}

      {!loading && data && data.rounds.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-muted">
            No draws yet. The first one appears here as soon as it finishes.
          </p>
        </div>
      )}

      {rounds.map((r) => (
        <div
          key={r.roundNumber}
          className="rounded-lg border border-(--border) bg-surface px-5 py-4 mb-4"
        >
          {/* Round header */}
          <div className="flex flex-wrap items-center gap-3 -mx-5 px-5 pb-3 mb-3 border-b border-(--border)">
            <h2 className="text-base font-semibold tracking-tight">
              <Link
                href={`/rounds/${r.roundNumber}`}
                className="inline-flex items-center gap-1.5 transition hover:underline"
              >
                Draw #{r.roundNumber}
                {/* Internal route → thin right arrow, like "View all draws" on
                    the homepage. `arrow-up-right` is reserved for links that
                    leave the app (explorer, drand.sh). */}
                <Icon name="arrow-right" className="h-3.5 w-3.5" />
              </Link>
            </h2>
            <StatusChip status={r.status} className="ml-auto" />
          </div>

          {r.status === "skipped" ? (
            <div className="rounded-lg border border-(--border) bg-default/40 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Draw skipped</p>
              <p className="text-sm text-muted">{skipReason(r.error)}</p>
            </div>
          ) : r.status === "failed" ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3">
              <p className="text-sm font-semibold text-danger">Draw failed</p>
              <p className="text-sm text-danger" title={r.error ?? undefined}>
                {failureReason(r.error)}
              </p>
            </div>
          ) : (
            <>
          {/* Round stats grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-muted">
                Prize pool
              </span>
              <span className="text-sm font-bold">
                {fmtSolHuman(r.prizePoolSol)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-muted">
                Eligible holders
              </span>
              <span className="text-sm font-bold">{r.eligibleCount}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-muted">
                Winners
              </span>
              <span className="text-sm font-bold">{r.winners.length}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-muted">
                Drawn
              </span>
              <span
                className="text-sm font-bold"
                title={fmtTime(r.completedAt ?? r.startedAt)}
              >
                {timeAgo(r.completedAt ?? r.startedAt)}
              </span>
            </div>
          </div>

          {r.error && (
            <p className="text-danger text-sm mb-4" title={r.error}>
              This draw finished with an error logged.
            </p>
          )}

          {/* Randomness section */}
          {r.randomnessValue && r.randomnessRound ? (
            <DrandBeacon
              className="mb-5"
              beaconRound={r.randomnessRound}
              value={r.randomnessValue}
              signature={r.randomnessSignature}
              lotteryRound={r.roundNumber}
              winners={r.winners}
              chain={chain}
            />
          ) : (
            <p className="text-sm text-muted mb-5">
              No drand beacon was recorded for this draw.
            </p>
          )}

          {/* Winners — podium-styled list */}
          <div>
            <p className="text-sm text-muted mb-2">Winners and payouts</p>
            {r.winners.length > 0 ? (
              <div className="flex flex-col">
                {r.winners.map((w) => (
                  <div
                    key={w.rank}
                    className="flex items-center gap-2.5 py-1.5 border-b border-(--border) last:border-0"
                  >
                    <span
                      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${rankBadge(w.rank)}`}
                    >
                      {w.rank}
                    </span>
                    {w.rank === 1 && (
                      <span className="text-xs leading-none" title="Grand prize winner">
                        🏆
                      </span>
                    )}
                    <a
                      href={explorer(w.address, "address", net)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sm text-muted transition-colors hover:text-foreground hover:underline"
                    >
                      {shortAddr(w.address)}
                    </a>
                    <span className="ml-auto font-semibold tabular-nums text-sm">
                      {fmtSolHuman(w.amountSol)}
                    </span>
                    {w.payoutTx ? (
                      <a
                        href={explorer(w.payoutTx, "tx", net)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open the payout transaction on Solscan"
                        title={`Payout transaction · ${w.payoutTx}`}
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-default hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <Icon name="arrow-up-right" className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <StatusChip status={w.status} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No winners in this draw.</p>
            )}
          </div>
            </>
          )}
        </div>
      ))}

      {data && !loading && data.total > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-(--border) pt-4 pb-2">
          <p className="text-xs text-muted tabular-nums">
            Showing {firstShown}–{lastShown} of {data.total} settled draws
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onPress={() => goToPage(page - 1)}
              isDisabled={page === 0}
            >
              <Icon name="arrow-left" className="h-3 w-3" />
              Prev
            </Button>
            <span className="text-xs text-muted tabular-nums">
              Page {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onPress={() => goToPage(page + 1)}
              isDisabled={page >= pageCount - 1}
            >
              Next
              <Icon name="arrow-left" className="h-3 w-3 rotate-180" />
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}

function Stat({ label, value, caption }: { label: string; value: ReactNode; caption: string }) {
  return (
    <div className="bg-surface px-4 sm:px-5 py-3 flex flex-col">
      <span className="text-sm text-muted">{label}</span>
      <span className="mt-1 text-xl sm:text-2xl font-semibold tabular-nums leading-tight break-words text-foreground">
        {value}
      </span>
      <span className="mt-1 text-xs text-muted">{caption}</span>
    </div>
  );
}

function StatSkeleton({ label }: { label: string }) {
  return (
    <div className="bg-surface px-4 sm:px-5 py-3 flex flex-col">
      <span className="text-sm text-muted">{label}</span>
      <Skeleton className="mt-1 h-6 w-24" />
      <Skeleton className="mt-1 h-3 w-16" />
    </div>
  );
}