import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getConfig } from "../config";

let _connection: Connection | null = null;
let _payer: Keypair | null = null;
let _treasury: Keypair | null | undefined;

/** Helius RPC connection used by the backend (confirmed commitment). */
export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(getConfig().rpcUrl, "confirmed");
  }
  return _connection;
}

/** Platform/hot wallet keypair — pays for & signs all backend Solana txs. */
export function getPlatformKeypair(): Keypair {
  if (!_payer) {
    _payer = Keypair.fromSecretKey(getConfig().platformWalletSecret);
  }
  return _payer;
}

/** Optional platform fee treasury keypair. Returns null when
 *  PLATFORM_TREASURY_SECRET is unset (legacy: fee stays on the platform wallet). */
export function getTreasuryKeypair(): Keypair | null {
  if (_treasury === undefined) {
    const secret = getConfig().platformTreasurySecret;
    _treasury = secret ? Keypair.fromSecretKey(secret) : null;
  }
  return _treasury;
}

/** Treasury wallet public key, or null when not configured. */
export function getTreasuryPubkey(): PublicKey | null {
  const kp = getTreasuryKeypair();
  return kp ? kp.publicKey : null;
}
