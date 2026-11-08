import { PublicKey } from "@solana/web3.js";
import { getConfig } from "./config";
import { prisma } from "./prisma";

/**
 * Draw exclusion list ("blacklist") — server-only.
 *
 * Some accounts hold the token on-chain but are NOT players: the bonding curve
 * (pump.fun OR the bags.fm Meteora DBC curve), AMM/LP pool authorities and
 * vaults, program vaults, treasury wallets. Paying a prize into one of those
 * would burn the SOL into a curve that nobody controls (or hand it straight
 * back to liquidity), so they must never be counted as eligible — let alone
 * drawn.
 *
 * How it composes with the draw (important for the fairness story):
 *   eligible pool  =  snapshot wallets  −  platform wallet  −  this list
 *                     (balance >= MIN_TOKEN_ELIGIBLE, per-wallet sums)
 *   winners        =  Fisher–Yates(eligible pool, drand seed)
 * The filter runs BEFORE the shuffle, so an excluded address has no index in
 * the array and the beacon simply cannot select it. It is not "skipped by the
 * randomness" — it was never a candidate. The exact list used is snapshotted on
 * `LotteryRound.excludedAddresses` so historical rounds stay reproducible after
 * an admin edits the blacklist later.
 *
 * Two venue stacks are supported (the deployment moved from pump.fun to
 * bags.fm, which launches via Meteora's Dynamic Bonding Curve and graduates to
 * Meteora DAMM v2):
 *   • pump.fun legacy: `bonding-curve` PDA on 6EF8…F6P + PumpSwap pool
 *     authority PDA — pure derivations from TOKEN_MINT (sync).
 *   • bags.fm: the DBC VirtualPool / DAMM v2 Pool hold the token in VAULT
 *     accounts that can NOT be derived from the mint alone, so they are looked
 *     up ON-CHAIN (paginated getProgramAccountsV2, cached) and added to the
 *     exclusion set by `getDrawExclusions` (async — every caller already is).
 */

export interface ExcludedWalletRow {
  address: string;
  label: string | null;
  createdAt: Date;
}

/** Hard cap so a runaway paste can't bloat every draw's snapshot payload. */
export const MAX_EXCLUDED_WALLETS = 500;
export const MAX_EXCLUSION_LABEL = 80;

/**
 * Venue programs whose per-mint accounts hold the token but are never players.
 * The addresses are DERIVED from TOKEN_MINT, so they follow the token through
 * graduation (curve → AMM pool) with no admin action and can't be forgotten.
 *
 * Legacy pump.fun stack …
 */
const PUMP_FUN_CURVE_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_SWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

/** … and the bags.fm stack (Meteora programs, per docs.bags.fm/principles/program-ids). */
const METEORA_DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

/** Field offsets inside Meteora's account layouts (from the bags-sdk IDLs). */
const DBC_BASE_MINT_OFFSET = 72; // VirtualPool.base_mint
const DBC_BASE_VAULT_OFFSET = 104; // VirtualPool.base_vault
const DBC_QUOTE_VAULT_OFFSET = 136; // VirtualPool.quote_vault
const DAMM_TOKEN_A_MINT_OFFSET = 8; // Pool.token_a_mint
const DAMM_TOKEN_B_MINT_OFFSET = 40; // Pool.token_b_mint
const DAMM_TOKEN_A_VAULT_OFFSET = 72; // Pool.token_a_vault
const DAMM_TOKEN_B_VAULT_OFFSET = 104; // Pool.token_b_vault

export type VenueKind = "bonding-curve" | "pool-authority" | "venue-vault";

export interface VenueAccount {
  address: string;
  kind: VenueKind;
  /** Short human name — safe to show publicly ("pump.fun bonding curve"). */
  label: string;
  /** Compact chip tag: "bonding curve" / "pool authority". */
  tag: string;
  /** One-line "why this is never a player" — safe to show publicly. */
  reason: string;
}

/** The bonding curve + AMM authorities for the configured mint. */
export function getVenueAccounts(
  mint = process.env.TOKEN_MINT
): VenueAccount[] {
  if (!mint) return [];
  try {
    const mintKey = new PublicKey(mint);
    const derive = (
      programId: string,
      seeds: (string | Buffer)[],
      kind: VenueKind,
      tag: string,
      label: string,
      reason: string
    ): VenueAccount => ({
      address: PublicKey.findProgramAddressSync(
        seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s)),
        new PublicKey(programId)
      )[0].toBase58(),
      kind,
      tag,
      label,
      reason,
    });
    return [
      // ---- pump.fun (legacy stack — kept harmless: if the mint was not
      // launched there, these PDAs simply never hold the token) ----
      derive(
        PUMP_FUN_CURVE_PROGRAM,
        ["bonding-curve", mintKey.toBuffer()],
        "bonding-curve",
        "bonding curve",
        "pump.fun bonding curve",
        "The bonding curve holds the token as liquidity while the coin is minted — it is not a player, and a prize sent here would be locked in the curve."
      ),
      derive(
        PUMP_SWAP_PROGRAM,
        ["pool-authority", mintKey.toBuffer()],
        "pool-authority",
        "pool authority",
        "PumpSwap pool authority",
        "The PumpSwap pool authority holds the token as AMM liquidity — it is not a player, and a prize sent here would just flow back into the pool."
      ),
      // ---- bags.fm (Meteora stack) ----
      // `pool_authority` is a GLOBAL PDA (no mint seed), so it covers every
      // delegated DAMM v2 pool. The per-pool token vaults are discovered
      // on-chain — see `getVenueExclusionAddresses`.
      derive(
        METEORA_DAMM_V2_PROGRAM,
        ["pool_authority"],
        "pool-authority",
        "pool authority",
        "Meteora DAMM v2 pool authority",
        "The DAMM v2 pool authority signs every swap of a graduated bags.fm pool — it is not a player, and a prize sent here would just flow back into the pool."
      ),
    ];
  } catch {
    // Bad/missing TOKEN_MINT: the draw's own eligibility read will fail loudly.
    return [];
  }
}

/** address → venue account, for tagging rows without a DB round trip. */
export function getVenueAccountMap(
  mint = process.env.TOKEN_MINT
): Map<string, VenueAccount> {
  return new Map(getVenueAccounts(mint).map((v) => [v.address, v]));
}

/** Venue accounts discovered on-chain: label for the admin/holder chip. */
function venueVaultAccount(address: string): VenueAccount {
  return {
    address,
    kind: "venue-vault",
    tag: "venue vault",
    label: "bags.fm liquidity vault",
    reason:
      "This vault belongs to the bags.fm bonding curve / AMM pool and holds the token as liquidity — it is not a player, and a prize sent here would be locked in the pool.",
  };
}

/* ------------------------------------------------------------------ */
/* On-chain venue discovery (bags.fm / Meteora DBC + DAMM v2)          */
/* ------------------------------------------------------------------ */

type CachedVenues = { addresses: string[]; fetchedAt: number };
const venueCache = new Map<string, CachedVenues>();
const VENUE_CACHE_MS = 5 * 60_000;
const VENUE_FETCH_TIMEOUT_MS = 20_000;
const VENUE_PAGE_LIMIT = 1_000;
const VENUE_MAX_PAGES = 200;

async function rpcV2Paginated(
  rpcUrl: string,
  program: string,
  filters: unknown[]
): Promise<Array<{ pubkey: string; data: Buffer }>> {
  const out: Array<{ pubkey: string; data: Buffer }> = [];
  let paginationKey: string | null = null;
  let pages = 0;
  do {
    const res = await fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(VENUE_FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "exclusions",
        method: "getProgramAccountsV2",
        params: [
          program,
          {
            encoding: "base64",
            commitment: "confirmed",
            limit: VENUE_PAGE_LIMIT,
            filters,
            ...(paginationKey ? { paginationKey } : {}),
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`getProgramAccountsV2: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: {
        accounts?: Array<{ pubkey: string; account: { data: [string, string] } }>;
        paginationKey?: string | null;
      };
      error?: { message?: string };
    };
    if (json.error) throw new Error(json.error.message ?? "RPC error");
    for (const a of json.result?.accounts ?? []) {
      out.push({ pubkey: a.pubkey, data: Buffer.from(a.account.data[0], "base64") });
    }
    paginationKey = json.result?.paginationKey ?? null;
    pages++;
  } while (paginationKey && pages < VENUE_MAX_PAGES);
  return out;
}

function cut32(data: Buffer, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

/**
 * Every on-chain account that holds this mint for a venue (never a player):
 * the bags.fm Meteora DBC base+quote vaults of the curve pool, and the DAMM v2
 * token vaults of any graduated pool. Paginated V2 scans only — Helius rejects
 * legacy `getProgramAccounts` on these busy programs.
 *
 * Cached in-process for 5 minutes (a venue only changes on graduation).
 * Never throws: on any failure the draw proceeds with the derivable venues
 * only, and the failure is logged.
 */
export async function getVenueExclusionAddresses(
  mint = process.env.TOKEN_MINT
): Promise<{ addresses: string[]; accounts: VenueAccount[]; error?: string }> {
  if (!mint) return { addresses: [], accounts: [] };

  const cached = venueCache.get(mint);
  if (cached && Date.now() - cached.fetchedAt < VENUE_CACHE_MS) {
    return { addresses: cached.addresses, accounts: cached.addresses.map((a) => venueVaultAccount(a)) };
  }

  const found: string[] = [];
  let error: string | undefined;
  const t0 = Date.now();

  try {
    const cfg = getConfig();
    const rpcUrl = cfg.rpcUrl;

    // DBC VirtualPool (base_mint @72) → base_vault + quote_vault
    const dbcPools = await rpcV2Paginated(rpcUrl, METEORA_DBC_PROGRAM, [
      { memcmp: { offset: DBC_BASE_MINT_OFFSET, bytes: mint } },
    ]);
    for (const { data } of dbcPools) {
      if (data.length > DBC_QUOTE_VAULT_OFFSET + 32) {
        found.push(cut32(data, DBC_BASE_VAULT_OFFSET));
        found.push(cut32(data, DBC_QUOTE_VAULT_OFFSET));
      }
    }

    // DAMM v2 Pool (token_a @8, token_b @40) → both token vaults
    const dammA = await rpcV2Paginated(rpcUrl, METEORA_DAMM_V2_PROGRAM, [
      { memcmp: { offset: DAMM_TOKEN_A_MINT_OFFSET, bytes: mint } },
    ]);
    const dammB = await rpcV2Paginated(rpcUrl, METEORA_DAMM_V2_PROGRAM, [
      { memcmp: { offset: DAMM_TOKEN_B_MINT_OFFSET, bytes: mint } },
    ]);
    for (const { data } of [...dammA, ...dammB]) {
      if (data.length > DAMM_TOKEN_B_VAULT_OFFSET + 32) {
        found.push(cut32(data, DAMM_TOKEN_A_VAULT_OFFSET));
        found.push(cut32(data, DAMM_TOKEN_B_VAULT_OFFSET));
      }
    }
  } catch (e) {
    error = (e as Error).message;
    console.warn(`[exclusions] venue lookup failed: ${error}`);
  }

  const addresses = [...new Set(found)].sort();
  venueCache.set(mint, { addresses, fetchedAt: Date.now() });
  if (process.env.NODE_ENV !== "production" || addresses.length) {
    console.log(
      `[exclusions] venue scan for ${mint.slice(0, 6)}…: ${addresses.length} vault(s) in ${Date.now() - t0}ms`
    );
  }
  return { addresses, accounts: addresses.map((a) => venueVaultAccount(a)), error };
}


/**
 * WHY an address is excluded, for the UI chips:
 *   venue  — derived from TOKEN_MINT (bonding curve / pool authority), named for
 *            the user.
 *   manual — an admin blacklist entry; the organiser's label ("Sybil cluster",
 *            "Split wallet"…) is returned so both /admin and the public holder
 *            list can show the reason next to the address. Callers that pass no
 *            `manualLabels` map get `excludedLabel: null`.
 */
export function describeExclusion(
  address: string,
  venueMap: Map<string, VenueAccount>,
  manualLabels?: Map<string, string | null>
): { excludedBy: "venue" | "manual"; excludedLabel: string | null } {
  const venue = venueMap.get(address);
  if (venue) return { excludedBy: "venue", excludedLabel: venue.label };
  return {
    excludedBy: "manual",
    excludedLabel: manualLabels?.get(address) ?? null,
  };
}

/**
 * THE complete exclusion set for the next draw: platform wallet + venue
 * accounts (derivable PDAs AND the on-chain-discovered bags.fm/Meteora vaults)
 * + the admin blacklist, deduped. Every surface that reports an eligible count
 * must use this (holders lists, /api/status, the engine) or the reported count
 * drifts from what the draw can actually pick.
 */
export async function getDrawExclusions(
  platformAddress: string | null
): Promise<string[]> {
  const [blacklist, venueVaults] = await Promise.all([
    getExcludedAddresses(),
    getVenueExclusionAddresses(),
  ]);
  return mergeExclusions(
    platformAddress,
    getVenueAccounts().map((v) => v.address),
    venueVaults.addresses,
    blacklist
  );
}

/** Trim + base58-check an address. Throws a user-facing message when invalid. */
export function normalizeWalletAddress(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Wallet address is required");
  try {
    // toBase58() also rejects the all-zero key and non-32-byte input.
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error("Not a valid Solana address (base58, 32 bytes)");
  }
}

/** Every excluded wallet, oldest first — the admin list order. */
export async function listExcludedWallets(): Promise<ExcludedWalletRow[]> {
  return prisma.excludedWallet.findMany({
    orderBy: [{ createdAt: "asc" }, { address: "asc" }],
    select: { address: true, label: true, createdAt: true },
  });
}

/** Just the addresses, for the draw / holder-count code paths. */
export async function getExcludedAddresses(): Promise<string[]> {
  const rows = await prisma.excludedWallet.findMany({
    orderBy: { address: "asc" },
    select: { address: true },
  });
  return rows.map((r) => r.address);
}

export async function addExcludedWallet(
  rawAddress: string,
  rawLabel?: string | null
): Promise<ExcludedWalletRow> {
  const address = normalizeWalletAddress(rawAddress);
  const label =
    String(rawLabel ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_EXCLUSION_LABEL) || null;

  const existing = await prisma.excludedWallet.findUnique({ where: { address } });
  if (existing) throw new Error("That address is already excluded from the draw");

  const count = await prisma.excludedWallet.count();
  if (count >= MAX_EXCLUDED_WALLETS) {
    throw new Error(`Exclusion list is full (max ${MAX_EXCLUDED_WALLETS} addresses)`);
  }

  return prisma.excludedWallet.create({
    data: { address, label },
    select: { address: true, label: true, createdAt: true },
  });
}

/** Removes one address. Returns false when it wasn't in the list. */
export async function removeExcludedWallet(rawAddress: string): Promise<boolean> {
  const address = normalizeWalletAddress(rawAddress);
  const res = await prisma.excludedWallet.deleteMany({ where: { address } });
  return res.count > 0;
}

/**
 * True for program-derived accounts: bonding curves, PDAs, pool authorities and
 * vaults are OFF the ed25519 curve, while every plain keypair wallet is on it.
 * Used only to *suggest* addresses in the admin UI — the list itself stays 100%
 * manual, because an off-curve heuristic alone can't distinguish "the curve"
 * from "a program vault that does belong to a player".
 */
export function isProgramOwnedAccount(address: string): boolean {
  try {
    // Static helper (web3.js 1.99): decodes base58 and tests the ed25519 curve.
    return !PublicKey.isOnCurve(address);
  } catch {
    return false;
  }
}

/** Union of exclusion sources, deduped + address-sorted (stable snapshots). */
export function mergeExclusions(
  ...lists: (string | null | undefined | string[])[]
): string[] {
  const set = new Set<string>();
  for (const item of lists) {
    if (!item) continue;
    if (Array.isArray(item)) {
      for (const addr of item) if (addr) set.add(addr);
    } else {
      set.add(item);
    }
  }
  return [...set].sort();
}
