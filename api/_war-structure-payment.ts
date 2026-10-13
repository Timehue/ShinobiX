import { appendSettlementReceipt, settlementFingerprint, settlementTransactionId, type SettlementReceipt } from './_durable-settlement.js';

export const STRUCTURE_PAYMENT_RECEIPT_LIMIT = 100;
export type StructurePayment = { village: string; structure: string; level: number; cost: number; materials: number };
export function structurePaymentId(village: string, structure: string, level: number): string {
    return `village-war-structure:${settlementTransactionId('war-structure', `${village}:${structure}:${level}`)}`;
}
export function inspectStructurePayment(state: Record<string, unknown>, village: string, structure: string, level: number):
    { status: 'fresh'; id: string } | { status: 'paid'; id: string; payment: StructurePayment } | { status: 'invalid'; id: string } {
    const id = structurePaymentId(village, structure, level);
    if (state.settlementReceipts !== undefined && !Array.isArray(state.settlementReceipts)) return { status: 'invalid', id };
    const receipt = (state.settlementReceipts as Array<SettlementReceipt & { purchase?: StructurePayment }> | undefined)
        ?.find(r => r?.transactionId === id);
    if (!receipt) return { status: 'fresh', id };
    const payment = receipt.purchase;
    if (!payment || payment.village !== village || payment.structure !== structure || payment.level !== level
        || !Number.isSafeInteger(payment.cost) || payment.cost <= 0 || !Number.isSafeInteger(payment.materials) || payment.materials < 0
        || receipt.resource !== 'honorSeals' || receipt.amount !== payment.cost || !(receipt.appliedAt > 0)
        || receipt.fingerprint !== settlementFingerprint(payment)) return { status: 'invalid', id };
    return { status: 'paid', id, payment };
}
/** The existing server-owned settlementReceipts field is pinned by village-state
 * validation. Payment and its proof land in one treasury write, including when
 * the answer to that write is lost. No new client-writable field is introduced. */
export function withStructurePayment(state: Record<string, unknown>, payment: StructurePayment): Record<string, unknown> {
    const receipt: SettlementReceipt & { purchase: StructurePayment } = {
        transactionId: structurePaymentId(payment.village, payment.structure, payment.level),
        fingerprint: settlementFingerprint(payment), resource: 'honorSeals', amount: payment.cost,
        appliedAt: Date.now(), purchase: { ...payment },
    };
    return appendSettlementReceipt(state, receipt, 'settlementReceipts', STRUCTURE_PAYMENT_RECEIPT_LIMIT);
}
