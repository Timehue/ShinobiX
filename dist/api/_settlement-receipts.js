"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_SETTLEMENT_RECEIPT_LIMIT = exports.SERVER_SETTLEMENT_RECEIPTS_FIELD = void 0;
exports.parseSettlementRequestId = parseSettlementRequestId;
exports.inspectSettlementReceipt = inspectSettlementReceipt;
exports.appendSettlementReceipt = appendSettlementReceipt;
exports.SERVER_SETTLEMENT_RECEIPTS_FIELD = 'serverSettlementReceipts';
exports.SERVER_SETTLEMENT_RECEIPT_LIMIT = 50;
function parseSettlementRequestId(raw) {
    if (typeof raw !== 'string')
        return null;
    const value = raw.trim();
    return value.length >= 16 && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
function parseReceipt(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const value = raw;
    const requestId = parseSettlementRequestId(value.requestId);
    if (!requestId || typeof value.fingerprint !== 'string' || !value.fingerprint || value.fingerprint.length > 240)
        return null;
    if (!value.value || typeof value.value !== 'object' || Array.isArray(value.value))
        return null;
    const settledAt = Number(value.settledAt);
    if (!Number.isFinite(settledAt) || settledAt <= 0)
        return null;
    return { requestId, fingerprint: value.fingerprint, value: value.value, settledAt };
}
function inspectSettlementReceipt(character, requestId, fingerprint) {
    const raw = character[exports.SERVER_SETTLEMENT_RECEIPTS_FIELD];
    if (raw !== undefined && !Array.isArray(raw))
        return { status: 'invalid', receipts: [] };
    const receipts = [];
    for (const entry of raw ?? []) {
        const parsed = parseReceipt(entry);
        if (!parsed)
            return { status: 'invalid', receipts: [] };
        receipts.push(parsed);
    }
    const existing = receipts.find((receipt) => receipt.requestId === requestId);
    if (!existing)
        return { status: 'fresh', receipts };
    if (existing.fingerprint !== fingerprint)
        return { status: 'conflict', receipts };
    return { status: 'replay', receipt: existing, receipts };
}
function appendSettlementReceipt(character, receipts, receipt) {
    return {
        ...character,
        [exports.SERVER_SETTLEMENT_RECEIPTS_FIELD]: [receipt, ...receipts.filter((entry) => entry.requestId !== receipt.requestId)]
            .slice(0, exports.SERVER_SETTLEMENT_RECEIPT_LIMIT),
    };
}
