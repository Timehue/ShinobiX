export const SERVER_SETTLEMENT_RECEIPTS_FIELD = 'serverSettlementReceipts';
export const SERVER_SETTLEMENT_RECEIPT_LIMIT = 50;

export type ServerSettlementReceipt = {
    requestId: string;
    fingerprint: string;
    value: Record<string, unknown>;
    settledAt: number;
};

export type SettlementReceiptInspection =
    | { status: 'fresh'; receipts: ServerSettlementReceipt[] }
    | { status: 'replay'; receipt: ServerSettlementReceipt; receipts: ServerSettlementReceipt[] }
    | { status: 'conflict'; receipts: ServerSettlementReceipt[] }
    | { status: 'invalid'; receipts: ServerSettlementReceipt[] };

export function parseSettlementRequestId(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    return value.length >= 16 && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function parseReceipt(raw: unknown): ServerSettlementReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const requestId = parseSettlementRequestId(value.requestId);
    if (!requestId || typeof value.fingerprint !== 'string' || !value.fingerprint || value.fingerprint.length > 240) return null;
    if (!value.value || typeof value.value !== 'object' || Array.isArray(value.value)) return null;
    const settledAt = Number(value.settledAt);
    if (!Number.isFinite(settledAt) || settledAt <= 0) return null;
    return { requestId, fingerprint: value.fingerprint, value: value.value as Record<string, unknown>, settledAt };
}

export function inspectSettlementReceipt(
    character: Record<string, unknown>,
    requestId: string,
    fingerprint: string,
): SettlementReceiptInspection {
    const raw = character[SERVER_SETTLEMENT_RECEIPTS_FIELD];
    if (raw !== undefined && !Array.isArray(raw)) return { status: 'invalid', receipts: [] };
    const receipts: ServerSettlementReceipt[] = [];
    for (const entry of (raw as unknown[] | undefined) ?? []) {
        const parsed = parseReceipt(entry);
        if (!parsed) return { status: 'invalid', receipts: [] };
        receipts.push(parsed);
    }
    const existing = receipts.find((receipt) => receipt.requestId === requestId);
    if (!existing) return { status: 'fresh', receipts };
    if (existing.fingerprint !== fingerprint) return { status: 'conflict', receipts };
    return { status: 'replay', receipt: existing, receipts };
}

export function appendSettlementReceipt(
    character: Record<string, unknown>,
    receipts: ServerSettlementReceipt[],
    receipt: ServerSettlementReceipt,
): Record<string, unknown> {
    return {
        ...character,
        [SERVER_SETTLEMENT_RECEIPTS_FIELD]: [receipt, ...receipts.filter((entry) => entry.requestId !== receipt.requestId)]
            .slice(0, SERVER_SETTLEMENT_RECEIPT_LIMIT),
    };
}
