// Match the existing economic journal window; keep applied-side evidence longer
// than any request can authorize a new write, including clock skew at admission.
export const CLAN_EXCHANGE_RECOVERY_MS = 90 * 86_400_000;
export const CLAN_EXCHANGE_RECEIPT_RETENTION_MS = 100 * 86_400_000;

/** Timestamp is only an admission/expiry bound, never purchase eligibility. */
export function clanExchangeIntentTime(raw: unknown): number | null {
    if (typeof raw !== 'string' || !/^cex-\d{13}-[a-f0-9]{32}$/.test(raw)) return null;
    const value = Number(raw.split('-')[1]);
    return Number.isSafeInteger(value) ? value : null;
}
