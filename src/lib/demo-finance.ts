/**
 * PLACEHOLDER finance data still in use on /treasury.
 *
 * The platform and fee tx tables are derived from the draw ledger
 * (`payoutTx` + winner amounts); what is left here is sample-only: the fee rows
 * shown before any draw has been paid (`DEMO_FEE_TXS`). Every consumer MUST
 * label those rows as sample data in the UI, and never mix them with real rows
 * in one table. Shapes mirror the planned indexer/ledger responses so wiring the
 * real source only swaps the array.
 *
 * The buyback ledger used to live here. It is now a hand-maintained JSON file
 * (`data/buyback.json`, read/written through `@/lib/buyback` + `/api/buyback`
 * and edited in Admin → Buyback), because the buys and burns are executed
 * manually and a whole document beats a table + input form for a few rows a
 * month.
 */

export type DemoWalletTx = {
  /** Base58-looking transaction signature (fake). */
  signature: string;
  /** ISO timestamp. Fixed (not `Date.now()`) so SSR and hydration agree. */
  at: string;
  /** Human label, e.g. "Winner payout · draw #42". */
  label: string;
  /** SOL moved: negative = out of the wallet, positive = in. */
  amountSol: number;
};

/** Sample fee-wallet inflows (one per draw). Used only when the draws table has
 *  no recorded fee or buyback spend yet. Labels mirror the real rows produced in
 *  `app/treasury` ("Earned from draw #N"), so the Sample chip is the only thing
 *  that gives them away. */
export const DEMO_FEE_TXS: DemoWalletTx[] = [
  {
    signature: "4Lm9Qw3Xr6Tb2Vc7Nd1Hs8Jf5Ga3Ye9Pu4Zi2Rt7Wq5Xc1Vb8Nm3Ks6Jd4Hf2Lp9Qa7Sd5Ef3Gh8",
    at: "2026-10-20T09:15:00.000Z",
    label: "Earned from draw #42",
    amountSol: 0.42,
  },
  {
    signature: "8Nc2Vb6Km9Xr3Ta7Qp1Hs4Jf8Ga2Ye6Pu5Zi9Rt4Wq7Xc3Vb1Nm8Ks2Jd6Hf4Lp7Qa3Sd1Ef9Gh5",
    at: "2026-10-19T09:15:00.000Z",
    label: "Earned from draw #41",
    amountSol: 0.31,
  },
  {
    signature: "3Ws7Xc1Vb5Nm9Ks3Jd8Hf2Lp6Qa9Sd4Ef7Gh1Jk5Mn2Bv8Cx4Zq7Wr1Ty6Ui9Op3As5Df2Gh8",
    at: "2026-10-18T09:15:00.000Z",
    label: "Earned from draw #40",
    amountSol: 0.27,
  },
];
