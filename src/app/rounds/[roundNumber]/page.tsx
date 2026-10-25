"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRow,
  Typography,
} from "@heroui/react";
import { AppShell } from "@/components/AppShell";
import { Icon, Skeleton, SkeletonStat, SkeletonRows } from "@/components/ui";
import { explorerUrl, fmtSolHuman, shortAddress } from "@/lib/format";
import { reproduceWinners } from "@/lib/lottery/verify";

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
  minTokenEligible: string;
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

type RoundResp = {
  network: "mainnet" | "devnet";
  chain: Chain | null;
  round: Round;
  eligible: { address: string; amount: string }[];
  eligibleSource: "recorded" | "inferred" | "unavailable";
  eligibleSnapshotCapturedAt: string | null;
  snapshotTotalHolders: number;
  platformExclusionReproduced: boolean;
  platformAddress: string | null;
  /** Full exclusion list applied at draw time (platform wallet + blacklist). */
  excludedAddresses?: string[];
  exclusionSource?: "recorded" | "platform-only";
  error?: string;
};

type CheckState = "idle" | "running" | "pass" | "fail" | "error";
type CheckResult = { state: CheckState; detail: string };
type ChipColor = "success" | "danger" | "warning" | "default";

/** DB status -> the words we show. Never print the raw enum on the page. */
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  drawing: "In progress",
  skipped: "Skipped",
  failed: "Failed",
  sent: "Paid",
  pending: "Pending",
};
const statusLabel = (status: string): string =>
  STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

/** Where the wallet list came from — machine values, user-facing words. */
const SOURCE_LABEL: Record<string, string> = {
  recorded: "Saved with this draw",
  inferred: "Closest snapshot",
  unavailable: "Not available",
};

/**
 * The engine stores an operator log line on skipped/failed draws (e.g.
 * "Prize pool 0 SOL (balance at/below reserve) — round skipped"). Show one plain
 * sentence and keep the raw text on `title` for anyone who wants details.
 */
function roundNote(round: Round): string {
  const raw = round.error ?? "";
  const s = raw.toLowerCase();
  if (round.status === "skipped") {
    return s.includes("below minimum")
      ? "The prize pool didn’t reach the minimum needed for a draw."
      : "The prize pool was empty, so this draw picked no winners.";
  }
  if (s.includes("failed on-chain") || s.includes("insufficientfunds")) {
    return "The payout transaction failed on-chain, so this draw didn’t pay out.";
  }
  if (s.includes("payout tx")) {
    return "The payout transaction failed, so this draw didn’t pay out.";
  }
  return raw;
}


function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.toLowerCase().replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(hexValue: string): Promise<string> {
  const bytes = hexToBytes(hexValue);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const esc = (c: string | number) => '"' + String(c).replace(/"/g, '""') + '"';
  const csv = rows.map((r) => r.map(esc).join(",")).join(String.fromCharCode(10));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function RoundPage() {
  const params = useParams<{ roundNumber: string }>();
  const roundNumber = Number(params?.roundNumber ?? "");

  const [data, setData] = useState<RoundResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [shaResult, setShaResult] = useState<CheckResult | null>(null);
  const [beaconResult, setBeaconResult] = useState<CheckResult | null>(null);
  const [deriveResult, setDeriveResult] = useState<CheckResult | null>(null);
  const [eligQuery, setEligQuery] = useState("");

  useEffect(() => {
    if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
      setLoading(false);
      setFetchError("This link doesn’t point to a draw.");
      return;
    }
    let alive = true;
    setLoading(true);
    setData(null);
    setFetchError(null);
    fetch(`/api/rounds/${roundNumber}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as RoundResp;
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setFetchError(String((e as Error).message ?? e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [roundNumber]);

  const round = data?.round ?? null;
  const chain = data?.chain ?? null;
  const net = (data?.network ?? "mainnet") as "mainnet" | "devnet";

  /** Run all three independent checks whenever the round data arrives. */
  useEffect(() => {
    if (!round || !round.randomnessValue || !round.randomnessSignature) {
      setShaResult(null);
      setBeaconResult(null);
      setDeriveResult(null);
      return;
    }
    let alive = true;
    const value = round.randomnessValue;
    const sig = round.randomnessSignature;

    // Check 1 — local: randomness must equal SHA-256(signature). drand quicknet
    // defines randomness = sha256(signature), so this is a zero-trust check that
    // the two stored fields are internally consistent.
    setShaResult({ state: "running", detail: "computing SHA-256…" });
    sha256Hex(sig)
      .then((hash) => {
        if (!alive) return;
        if (hash === value.toLowerCase()) {
          setShaResult({
            state: "pass",
            detail: `SHA-256(signature) = ${hash.slice(0, 16)}… matches the stored randomness`,
          });
        } else {
          setShaResult({
            state: "fail",
            detail: `SHA-256(signature) = ${hash.slice(0, 16)}… ≠ stored randomness ${value.slice(0, 16)}…`,
          });
        }
      })
      .catch((e) => {
        if (alive) setShaResult({ state: "error", detail: (e as Error).message });
      });

    // Check 2 — external: fetch the same round from the drand public beacon
    // (CORS-open) and compare the published randomness + signature.
    if (round.randomnessRound == null || !chain) {
      setBeaconResult({
        state: "idle",
        detail: "no beacon round recorded for this draw",
      });
    } else {
      setBeaconResult({ state: "running", detail: "fetching drand.sh…" });
      fetch(`${chain.verifyBaseUrl}/${round.randomnessRound}`, {
        headers: { Accept: "application/json" },
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: { randomness?: string; signature?: string }) => {
          if (!alive) return;
          const gotRnd = (j.randomness ?? "").toLowerCase();
          const gotSig = (j.signature ?? "").toLowerCase();
          if (
            gotRnd &&
            gotRnd === value.toLowerCase() &&
            gotSig === sig.toLowerCase()
          ) {
            setBeaconResult({
              state: "pass",
              detail: `drand.sh published the same randomness + signature for beacon round ${round.randomnessRound}`,
            });
          } else {
            setBeaconResult({
              state: "fail",
              detail: `drand.sh returned randomness ${gotRnd.slice(0, 16) || "(empty)"} ≠ our stored value`,
            });
          }
        })
        .catch((e) => {
          if (alive) setBeaconResult({ state: "error", detail: (e as Error).message });
        });
    }

    // Check 3 — derivation: reproduce the winner selection client-side from
    // (randomness, eligible list) and compare rank→address to stored winners.
    // This proves the beacon wasn't bypassed when picking winners.
    const eligible = data?.eligible ?? [];
    const source = data?.eligibleSource ?? "unavailable";
    const platformOk = data?.platformExclusionReproduced ?? false;
    if (source === "unavailable" || eligible.length === 0) {
      setDeriveResult({
        state: "idle",
        detail:
          "Eligible snapshot unavailable for this draw — derivation needs the holder batch the draw selected from.",
      });
    } else {
      setDeriveResult({
        state: "running",
        detail: `reproducing the Fisher–Yates shuffle over ${eligible.length} eligible holders…`,
      });
      reproduceWinners(value, eligible.map((e) => e.address), round.winners.length)
        .then((reproduced) => {
          if (!alive) return;
          const stored = round.winners;
          let mismatches = 0;
          const max = Math.max(reproduced.length, stored.length);
          for (let i = 0; i < max; i++) {
            if (reproduced[i]?.address !== stored[i]?.address) mismatches++;
          }
          const caveats =
            (source === "inferred" ? " · snapshot inferred for this draw" : "") +
            (!platformOk
              ? " · platform-wallet exclusion not reproducible in this env"
              : "");
          if (mismatches === 0 && reproduced.length === stored.length) {
            setDeriveResult({
              state: "pass",
              detail: `Re-derived all ${stored.length} winners from the eligible pool + randomness — exact rank-for-rank match${caveats}`,
            });
          } else {
            setDeriveResult({
              state: "fail",
              detail: `Re-derived winners do NOT match stored — ${mismatches} rank(s) differ${
                source === "inferred"
                  ? " (snapshot inferred — a sync race could explain this)"
                  : ""
              }`,
            });
          }
        })
        .catch((e) => {
          if (alive) setDeriveResult({ state: "error", detail: (e as Error).message });
        });
    }

    return () => {
      alive = false;
    };
  }, [round, chain, data]);

  const checkColor = (s: CheckState): ChipColor =>
    s === "pass"
      ? "success"
      : s === "fail"
      ? "danger"
      : s === "error"
      ? "warning"
      : "default";
  const checkLabel = (s: CheckState): string =>
    s === "pass"
      ? "✓ Match"
      : s === "fail"
      ? "✗ Mismatch"
      : s === "error"
      ? "! Error"
      : s === "running"
      ? "Checking…"
      : "Waiting";

  return (
    <AppShell title="Draw">
      <main className="mx-auto max-w-7xl px-8 lg:px-10 pt-8 sm:pt-10 pb-12 flex flex-col gap-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <Typography type="h4">
              {Number.isInteger(roundNumber) && roundNumber > 0 ? `Draw #${roundNumber}` : "Draw"}
            </Typography>
            {round && (
              <Chip size="sm" variant="soft" color={round.status === "completed" ? "success" : round.status === "failed" ? "danger" : round.status === "skipped" ? "default" : "warning"}>
                {statusLabel(round.status)}
              </Chip>
            )}
          </div>
          <Typography type="body-sm" color="muted" className="mt-1.5">
            Who won, the random number that picked them, and three checks your browser can run to
            confirm nothing was edited afterwards.
          </Typography>
        </div>

        {fetchError && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" title={fetchError}>
            Couldn’t load this draw. The link may be wrong, or the server didn’t answer — try again in a moment.
          </div>
        )}

        {loading && (
          <>
            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                <SkeletonStat label="Finished" />
                <SkeletonStat label="Prize pool" />
                <SkeletonStat label="Eligible wallets" />
                <SkeletonStat label="Randomness round" />
              </div>
            </div>
            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <Skeleton className="h-5 w-48" />
              <SkeletonRows count={3} />
            </div>
          </>
        )}

        {round && (
          <>
            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <h2 className="text-base font-semibold tracking-tight">Draw summary</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
                <Field label="Finished" value={fmtDate(round.completedAt)} />
                <Field label="Prize pool" value={fmtSolHuman(round.prizePoolSol)} mono />
                <Field label="Eligible wallets" value={String(round.eligibleCount)} mono />
                <Field label="Randomness round" value={round.randomnessRound != null ? String(round.randomnessRound) : "—"} mono />
              </dl>
              {round.error && (
                <p className={round.status === "failed" ? "text-sm text-danger" : "text-sm text-muted"} title={round.error}>
                  {roundNote(round)}
                </p>
              )}
            </div>

            {round.winners.length === 0 ? (
              <p className="text-sm text-muted">This draw picked no winners.</p>
            ) : (
              <div className="table-bordered rounded-lg border border-(--border) overflow-hidden bg-surface">
                <Table variant="secondary">
                  <TableContent aria-label="Draw winners" className="text-xs font-mono">
                    <TableHeader>
                      <TableColumn className="w-12">RANK</TableColumn>
                      <TableColumn isRowHeader>WINNER</TableColumn>
                      <TableColumn style={{ textAlign: "right" }}>PAYOUT</TableColumn>
                      <TableColumn style={{ textAlign: "center" }}>STATUS</TableColumn>
                      <TableColumn>TRANSACTION</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {round.winners.map((w) => (
                        <TableRow key={w.rank}>
                          <TableCell className="text-muted font-mono">{w.rank}</TableCell>
                          <TableCell>
                            <a href={explorerUrl(w.address, "address", net)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-foreground hover:text-accent transition">
                              {shortAddress(w.address, 6, 6)}
                              <Icon name="arrow-up-right" className="h-3.5 w-3.5 text-muted" />
                            </a>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{fmtSolHuman(w.amountSol)}</TableCell>
                          <TableCell className="text-center">
                            <Chip size="sm" variant="soft" color={w.status === "sent" ? "success" : w.status === "failed" ? "danger" : "warning"}>
                              {statusLabel(w.status)}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            {w.payoutTx ? (
                              <a href={explorerUrl(w.payoutTx, "tx", net)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-foreground hover:text-accent transition">
                                {shortAddress(w.payoutTx, 6, 6)}
                                <Icon name="arrow-up-right" className="h-3.5 w-3.5 text-muted" />
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </TableContent>
                </Table>
              </div>
            )}

            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">Three checks, all in your browser</h2>
                <p className="text-sm text-muted">
                  If all three match, the draw used the number drand published and nobody edited the
                  winners afterwards.
                </p>
              </div>
              <CheckRow title="The stored number belongs to its signature" hint="Local check — the number we saved must be the SHA-256 hash of the signature we saved. An edited value fails here." result={shaResult} color={checkColor} label={checkLabel} />
              <CheckRow title="drand published the same number" hint="External check — fetches that beacon round straight from drand.sh and compares it with what we stored." result={beaconResult} color={checkColor} label={checkLabel} />
              <CheckRow title="A fresh shuffle produces the same winners" hint="Rebuilds the draw from this wallet list and the stored number, then compares wallet by wallet. A replaced winner fails here." result={deriveResult} color={checkColor} label={checkLabel} />
              {round.randomnessRound != null && chain && (
                <a href={`${chain.verifyBaseUrl}/${round.randomnessRound}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent transition hover:opacity-80 self-start">
                  See that round on drand.sh
                  <Icon name="arrow-up-right" className="h-3.5 w-3.5" />
                </a>
              )}
            </div>

            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight">The wallet list this draw used</h2>
                {data && (
                  <Chip size="sm" variant="soft" color={data.eligibleSource === "recorded" ? "success" : data.eligibleSource === "inferred" ? "warning" : "default"}>
                    {SOURCE_LABEL[data.eligibleSource] ?? data.eligibleSource}
                  </Chip>
                )}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
                <Field label="Wallets in the pool" value={String(data?.eligible.length ?? 0)} mono />
                <Field label="Wallets in the snapshot" value={String(data?.snapshotTotalHolders ?? 0)} mono />
                <Field
                  label="Wallets excluded"
                  value={String(
                    (data?.excludedAddresses ?? []).filter(
                      (a) => a !== data?.platformAddress
                    ).length
                  )}
                  mono
                />
                <Field label="Snapshot taken" value={fmtDate(data?.eligibleSnapshotCapturedAt ?? null)} />
              </dl>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono uppercase text-muted" htmlFor="elig-check">
                  Was this wallet in draw #{round.roundNumber}?
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    id="elig-check"
                    type="text"
                    value={eligQuery}
                    onChange={(e) => setEligQuery(e.target.value)}
                    placeholder="Wallet address"
                    className="flex-1 rounded-md border border-(--border) bg-surface px-3 py-2 font-mono text-sm outline-none transition focus:border-accent"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {eligQuery.trim() && data && (
                    <Chip size="sm" variant="soft" color={data.eligible.some((e) => e.address.toLowerCase() === eligQuery.trim().toLowerCase()) ? "success" : "default"}>
                      {data.eligible.some((e) => e.address.toLowerCase() === eligQuery.trim().toLowerCase()) ? "Yes — in this draw" : "No — not in this draw"}
                    </Chip>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted">
                This is the exact list the draw picked from: every wallet holding at least the minimum
                balance at snapshot time, with the platform wallet and any exclusion-list accounts
                (bonding curve, LP pools, program vaults) left out. Excluded wallets never got an
                index, so the drand seed could not select them — it only reorders this list. You can
                rebuild it from on-chain balances at that moment if you want to.
                {data && !data.platformExclusionReproduced && " · The platform-wallet exclusion couldn’t be rebuilt in this browser."}
              </p>
              <Link href="/eligibility" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground self-start">
                Browse current holders
                <Icon name="arrow-right" className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">The exact values we stored</h2>
                <p className="text-sm text-muted">Copy these if you want to check the draw somewhere else.</p>
              </div>
              <Mono label="Random number" value={round.randomnessValue} />
              <Mono label="drand signature" value={round.randomnessSignature} />
            </div>

            {chain && (
              <div className="rounded-lg border border-(--border) bg-surface px-5 py-4 flex flex-col gap-4">
                <h2 className="text-base font-semibold tracking-tight">The beacon behind every draw</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <Field label="Beacon chain" value={chain.name} mono />
                  <Field label="Signature type" value={chain.scheme} mono />
                  <Field label="New number every" value={`${chain.period}s`} mono />
                  <Field label="Live since" value="2023-08-23" mono />
                </dl>
                <Mono label="Chain ID" value={chain.hash} />
                <Mono label="Public key" value={chain.publicKey} />
                <a href={chain.verifyBaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent transition hover:opacity-80 self-start">
                  drand.sh beacon API
                  <Icon name="arrow-up-right" className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-mono uppercase text-muted">{label}</dt>
      <dd className={mono ? "font-mono tabular-nums" : ""}>{value}</dd>
    </div>
  );
}

function Mono({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-mono uppercase text-muted">{label}</span>
      <code className="block break-all rounded-md bg-default px-3 py-2 text-xs font-mono text-foreground">{value || "—"}</code>
    </div>
  );
}

function CheckRow({
  title,
  hint,
  result,
  color,
  label,
}: {
  title: string;
  hint: string;
  result: CheckResult | null;
  color: (s: CheckState) => ChipColor;
  label: (s: CheckState) => string;
}) {
  const s = result?.state ?? "idle";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <Chip size="sm" variant="soft" color={color(s)}>{label(s)}</Chip>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {result?.detail && <p className="text-xs font-mono text-muted break-all">{result.detail}</p>}
    </div>
  );
}
