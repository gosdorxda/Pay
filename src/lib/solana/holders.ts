import { Connection, PublicKey } from "@solana/web3.js";
import { getConfig, type LotteryConfig } from "../config";
import { getConnection } from "./connection";

/** Standard SPL Token program id (pump.fun tokens live here). */
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
/** Token-2022 program id (checked too, in case the mint uses the newer program). */
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6UTFLGdJKSKkocXCGnDRA"
);

export interface Holder {
  /** Holder wallet address (the token account *owner*, not the ATA). */
  owner: string;
  /** Raw token amount as an integer string (includes decimals). */
  amount: string;
  /** Token decimals. */
  decimals: number;
  /** Representative token account pubkey for this owner (for reference). */
  tokenAccount: string;
}

/**
 * Fetches non-zero token accounts for the configured mint.
 *
 * The token program is resolved DYNAMICALLY from the mint account's owner
 * (standard SPL Token vs Token-2022 vs other). This is essential because
 * pump.fun/bags.fm tokens are Token-2022, whose token accounts carry extensions
 * and are NOT a fixed 165 bytes — a hard `dataSize: 165` filter silently drops
 * every one of them and you get "0 holders".
 *
 * Uses `jsonParsed` encoding with only a mint `memcmp` filter (no dataSize), so
 * accounts of any size are returned and the RPC decodes owner + amount itself.
 */

/** Hard cap per V2 page — the RPC rejects anything above 10,000 ("Pagination
 *  limit too large. max allowed is 10000"). 1,000 keeps each response small. */
const PAGE_LIMIT = 1_000;
/** Safety net against a misbehaving RPC that never returns a null key. */
const MAX_PAGES = 500;
const FETCH_TIMEOUT_MS = 30_000;

/** One token account, as decoded from either RPC method. */
type RawTokenAccount = {
  pubkey: string;
  owner: string;
  amount: string;
};

/** Shape of a `getProgramAccountsV2` JSON-RPC response (Helius extension). */
type ProgramAccountsV2Response = {
  result?: {
    accounts?: Array<{ pubkey: string; account: { data: unknown } }>;
    /** Cursor for the next page; null when the scan is complete. */
    paginationKey?: string | null;
    count?: number;
  };
  error?: { code?: number; message?: string };
};

/**
 * Pulls the fields we care about out of a `jsonParsed` token-account payload.
 * Returns null for accounts the RPC could not parse (or non-"account" types).
 */
function parseTokenAccount(
  pubkey: string,
  data: unknown
): RawTokenAccount | null {
  const parsed = (data as { parsed?: { type?: string; info?: unknown } })
    ?.parsed;
  if (!parsed || (parsed.type && parsed.type !== "account")) return null;
  const info = parsed.info as
    | {
        owner?: string;
        tokenAmount?: { amount?: string; decimals?: number };
      }
    | undefined;
  const owner = info?.owner;
  const amount = info?.tokenAmount?.amount;
  if (!owner || amount === undefined) return null;
  return { pubkey, owner, amount };
}

/**
 * Fetches every token account of `mint` via Helius `getProgramAccountsV2`,
 * which is cursor-paginated and therefore has no "too many accounts" ceiling.
 *
 * Pagination ends only when `paginationKey` is null — an empty page can still
 * carry a key (verified against the live RPC), so the loop never stops early on
 * a zero-length page. `commitment` is passed so the snapshot matches
 * `getConnection()` ("confirmed").
 *
 * NOTE: balance/`amount` can NOT be filtered server-side — `memcmp` is an
 * equality match on a byte prefix, so it cannot express "amount ≥ X" (an
 * 8-byte LE pattern only matches that exact value). Zero-balance accounts are
 * therefore skipped in Node after the fetch.
 *
 * Returns null when the RPC does not implement the method (code -32601) so the
 * caller can fall back to the legacy one-shot query.
 */
async function fetchTokenAccountsV2(
  rpcUrl: string,
  program: PublicKey,
  mint: PublicKey
): Promise<RawTokenAccount[] | null> {
  const filters = [{ memcmp: { offset: 0, bytes: mint.toBase58() } }];

  const out: RawTokenAccount[] = [];
  let paginationKey: string | null = null;
  let pages = 0;

  do {
    const res = await fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "holders",
        method: "getProgramAccountsV2",
        params: [
          program.toBase58(),
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
            limit: PAGE_LIMIT,
            filters,
            ...(paginationKey ? { paginationKey } : {}),
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `getProgramAccountsV2 failed: HTTP ${res.status} ${res.statusText}`
      );
    }

    const json = (await res.json()) as ProgramAccountsV2Response;
    if (json.error) {
      // Method not implemented / disabled on this RPC → caller falls back.
      if (json.error.code === -32601) return null;
      throw new Error(
        `getProgramAccountsV2 failed: ${
          json.error.message ?? "unknown RPC error"
        }`
      );
    }

    for (const a of json.result?.accounts ?? []) {
      const parsed = parseTokenAccount(a.pubkey, a.account.data);
      if (!parsed) continue;
      out.push(parsed);
    }

    paginationKey = json.result?.paginationKey ?? null;
    pages++;
  } while (paginationKey && pages < MAX_PAGES);

  return out;
}

/**
 * Legacy, non-paginated fetch. Kept as a fallback for RPCs without
 * `getProgramAccountsV2`; some providers reject it outright on busy token
 * programs ("Too many accounts requested (Large number of pubkeys)").
 */
async function fetchTokenAccountsLegacy(
  connection: Connection,
  program: PublicKey,
  mint: PublicKey
): Promise<RawTokenAccount[]> {
  const accounts = await connection.getParsedProgramAccounts(program, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
  });

  const out: RawTokenAccount[] = [];
  for (const a of accounts) {
    const parsed = parseTokenAccount(a.pubkey.toBase58(), a.account.data);
    if (!parsed) continue;
    out.push(parsed);
  }
  return out;
}

async function fetchHolders(cfg: LotteryConfig): Promise<Holder[]> {
  const connection = getConnection();
  const mint = new PublicKey(cfg.tokenMint);

  // Resolve the program that owns this mint (Token / Token-2022 / ...).
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(
      `Mint ${mint.toBase58()} was not found on ${cfg.network}. Check TOKEN_MINT and SOLANA_NETWORK.`
    );
  }
  const tokenProgram = mintInfo.owner;

  // Preferred path: paginated getProgramAccountsV2 (no account-count ceiling).
  // Falls back to the legacy one-shot query when the RPC lacks the method.
  const raw = await fetchTokenAccountsV2(cfg.rpcUrl, tokenProgram, mint).catch(
    (e) => {
      console.warn(
        `[holders] getProgramAccountsV2 unavailable: ${(e as Error).message}`
      );
      return null;
    }
  );

  const accounts = raw ?? (await fetchTokenAccountsLegacy(connection, tokenProgram, mint));

  const holders: Holder[] = [];
  for (const a of accounts) {
    if (BigInt(a.amount) <= 0n) continue; // skip zero/closed accounts
    holders.push({
      owner: a.owner,
      amount: a.amount,
      decimals: cfg.tokenDecimals,
      tokenAccount: a.pubkey,
    });
  }
  return holders;
}

/**
 * When no holders are found, inspects the mint on-chain to pinpoint WHY, so a
 * misconfiguration (wrong mint / wrong network) or a fetch problem (RPC not
 * returning getProgramAccounts results) is surfaced instead of "0 holders".
 *
 * Uses getTokenSupply as the authoritative "is this a real SPL token" check
 * (it only succeeds for token mints) and names the owning program without
 * hard-failing on programs outside our two known constants.
 */
async function diagnoseMint(
  mint: PublicKey,
  connection: Connection,
  cfg: ReturnType<typeof getConfig>
): Promise<{ shouldThrow: boolean; message: string }> {
  const mintAddr = mint.toBase58();
  const net = cfg.network;

  // 1. Does the mint account exist on this RPC/network?
  const mintInfo = await connection.getAccountInfo(mint).catch(() => null);
  if (!mintInfo) {
    return {
      shouldThrow: true,
      message: `0 holders; mint ${mintAddr} was NOT FOUND on ${net} (or the RPC failed to read it). Verify TOKEN_MINT is correct and SOLANA_NETWORK (${net}) matches where the token actually lives.`,
    };
  }

  const ownerProgram = mintInfo.owner.toBase58();
  const isStandard = ownerProgram === TOKEN_PROGRAM_ID.toBase58();
  const isT2022 = ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58();
  const progNote = isStandard
    ? "Token program"
    : isT2022
    ? "Token-2022 program"
    : `program ${ownerProgram}`;

  // 2. getTokenSupply only succeeds for SPL token mints — failure means this
  //    address is not a token mint (TOKEN_MINT may point at a non-token acct).
  const supplyResp = await connection.getTokenSupply(mint).catch(() => null);
  if (!supplyResp) {
    return {
      shouldThrow: true,
      message: `0 holders; ${mintAddr} is owned by ${progNote}, and getTokenSupply failed — TOKEN_MINT may not be an SPL token mint. Verify the address.`,
    };
  }
  const supplyAmount = supplyResp.value.amount;
  if (BigInt(supplyAmount) > 0n) {
    return {
      shouldThrow: true,
      message: `0 holders even though ${mintAddr} (${progNote}) has supply ${supplyAmount} on ${net}. Your RPC returned no token accounts via getProgramAccountsV2 (and the legacy getProgramAccounts fallback failed too). Fix: check SOLANA_RPC_URL points at a Helius endpoint whose plan allows getProgramAccountsV2, then re-run the sync.`,
    };
  }
  return {
    shouldThrow: false,
    message: `${mintAddr} (${progNote}) is valid but has 0 supply (no tokens minted / no holders yet).`,
  };
}

/**
 * Snapshots every non-zero holder of the configured Pay token mint.
 *
 * Uses the paginated `getProgramAccountsV2` (falling back to legacy
 * `getProgramAccounts` when the RPC lacks it) on whichever token program owns
 * the mint — resolved dynamically, so standard Token AND Token-2022 (pump.fun /
 * bags.fm tokens) both work. Filtered by mint only: no fixed `dataSize`, because
 * Token-2022 accounts carry variable-length extensions (a 165-byte filter drops
 * every one of them and yields "0 holders"). A wallet holding the token across
 * multiple accounts is merged into one entry with summed balance.
 */
export async function snapshotHolders(): Promise<{
  holders: Holder[];
  totalHolders: number;
  fetchedAt: Date;
}> {
  const cfg = getConfig();
  // The token program is resolved dynamically inside fetchHolders, so both
  // Token and Token-2022 (extension-carrying) accounts are covered.
  const raw = await fetchHolders(cfg);

  // 0 holders despite a valid mint — diagnose WHY (RPC not returning accounts,
  // wrong network, etc.) instead of an opaque "0 holders".
  if (raw.length === 0) {
    const diag = await diagnoseMint(
      new PublicKey(cfg.tokenMint),
      getConnection(),
      cfg
    );
    if (diag.shouldThrow) {
      throw new Error(diag.message);
    }
    console.warn(`[holders] ${diag.message}`);
  }

  // Merge by wallet owner, summing balances across multiple token accounts.
  const byOwner = new Map<
    string,
    { amount: bigint; decimals: number; tokenAccount: string }
  >();
  for (const h of raw) {
    const cur = byOwner.get(h.owner);
    const amt = BigInt(h.amount);
    if (cur) {
      cur.amount += amt;
    } else {
      byOwner.set(h.owner, {
        amount: amt,
        decimals: h.decimals,
        tokenAccount: h.tokenAccount,
      });
    }
  }

  const holders: Holder[] = Array.from(byOwner.entries()).map(
    ([owner, v]) => ({
      owner,
      amount: v.amount.toString(),
      decimals: v.decimals,
      tokenAccount: v.tokenAccount,
    })
  );

  return {
    holders,
    totalHolders: holders.length,
    fetchedAt: new Date(),
  };
}
