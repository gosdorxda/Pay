"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Clock, Minus } from "lucide-react";
import { Button, Chip } from "@heroui/react";
import { DrandBeacon } from "@/components/DrandBeacon";
import { CountUp, Icon, Skeleton, SkeletonRows } from "@/components/ui";
import { fmtSolHuman, fmtSolNum, timeAgo } from "@/lib/format";

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
  dbError: string | null;
};

const shortAddr = (a: string, h = 4, t = 4): string =>
  !a || a.length <= h + t ? a : `${a.slice(0, h)}…${a.slice(-t)}`;
const explorer = (v: string, kind: "address" | "tx", net: string): string =>
  `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${v}${
    net === "devnet" ? "?cluster=devnet" : ""
  }`;
const fmtTime = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

/**
 * Median interval (ms) between consecutive draws, derived from each round's
 * `startedAt`. Returns null when fewer than two usable timestamps exist.
 * Powers the "Draw interval" header stat — it reflects the real cadence of the
 * schedule (e.g. an every-5-minutes lottery lands at ~5 min) without needing the
 * raw cron string, which isn't part of the rounds payload.
 */
function medianDrawIntervalMs(rounds: { startedAt: string }[]): number | null {
  if (rounds.length < 2) return null;
  const ts = rounds
    .map((r) => Date.parse(r.startedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < ts.length; i++) diffs.push(ts[i] - ts[i - 1]);
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[mid] : Math.round((diffs[mid - 1] + diffs[mid]) / 2);
}

/** Concise human duration from milliseconds, e.g. 300000 → "5 min". */
function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

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
    return "A prize was too small to create a winner’s wallet, so nothing was paid out — this round needs a bigger prize pool.";
  }
  if (s.includes("failed on-chain") || s.includes("insufficientfunds")) {
    return "The payout transaction failed on-chain, so this draw didn’t pay out.";
  }
  if (s.includes("block height exceeded") || s.includes("has expired")) {
    return "The payout transaction expired before it could confirm — no SOL left the wallet, so this draw didn’t pay out.";
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
  const [visibleCount, setVisibleCount] = useState(5);

  const fetchRounds = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const r = await fetch("/api/rounds", { cache: "no-store" });
      setData((await r.json()) as RoundsResponse);
      setErr(null);
    } catch (e) {
      // A failed background refresh keeps the last good snapshot on screen; only
      // a first load owns the error state.
      if (!silent) {
        setErr((e as Error).message);
        setData(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* First load, then a quiet 15 s refresh — the same window the API caches, so a
     tab left open keeps "Latest draw" honest and picks up newly settled rounds
     without flashing the skeletons. Skipped while the tab is in the background. */
  useEffect(() => {
    fetchRounds();
    const id = window.setInterval(() => {
      if (!document.hidden) fetchRounds(true);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [fetchRounds]);

  const net = data?.network ?? "mainnet";
  const chain = data?.chain;
  const visibleRounds = data?.rounds.slice(0, visibleCount) ?? [];

  // Summary stats for the header bar. `totalPaid` counts only winners whose
  // payout actually landed (payoutTx set · the tx is atomic, so this is money
  // that moved), and both figures describe the loaded page of rounds — the API
  // caps it at the latest 50, which the note under the card spells out.
  const totalRounds = data?.rounds.length ?? 0;
  const totalPaid =
    data?.rounds.reduce(
      (sum, r) =>
        sum +
        r.winners.reduce((s, w) => s + (w.payoutTx ? w.amountSol : 0), 0),
      0,
    ) ?? 0;
  const latestRound = data?.rounds[0] ?? null;
  const latestDrawTime = latestRound?.completedAt ?? latestRound?.startedAt ?? null;
  const drawIntervalMs = medianDrawIntervalMs(data?.rounds ?? []);

  return (
    <div className={className}>
      {/* Summary stats card */}
      {data && !loading && (
        <div className="mb-6 overflow-hidden rounded-lg border border-(--border)">
          <div className="grid grid-cols-2 gap-px bg-(--border) sm:grid-cols-4">
            <Stat
              label="Draws"
              value={<CountUp value={totalRounds} />}
              caption="settled rounds"
            />
            <Stat
              label="Paid out"
              value={<CountUp value={totalPaid} format={(n) => fmtSolNum(n)} />}
              caption="SOL to winners"
            />
            <Stat
              label="Draw interval"
              value={fmtDuration(drawIntervalMs)}
              caption="median gap between rounds"
            />
            <Stat
              label="Latest draw"
              value={timeAgo(latestDrawTime)}
              caption={latestRound ? `draw #${latestRound.roundNumber}` : "no draws yet"}
            />
          </div>
          <div className="border-t border-(--border) px-4 py-2 sm:px-5">
            <p className="text-xs text-muted">
              Showing up to 50 settled draws.
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
              <StatSkeleton label="Paid out" />
              <StatSkeleton label="Draw interval" />
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

      {visibleRounds.map((r) => (
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

      {data && !loading && data.rounds.length > visibleCount && (
        <Button
          variant="outline"
          size="md"
          className="self-center my-2"
          onPress={() => setVisibleCount((c) => c + 5)}
        >
          Load more ({data.rounds.length - visibleCount} remaining)
        </Button>
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