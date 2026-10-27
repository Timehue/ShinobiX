/** The wire identity is also persisted in server settlement receipts. */
export function parseSettlementRequestId(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    return value.length >= 16 && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
