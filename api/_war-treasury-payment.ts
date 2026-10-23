import { appendSettlementReceipt, settlementFingerprint, settlementTransactionId, type SettlementReceipt } from './_durable-settlement.js';
import { villageWarSlug } from './_war-state.js';

/*
 * Proof of a treasury payment for war escalation (2026-10 rebalance, #6): a merc
 * hire's treasury ryo, or a war preparation's treasury ryo and Bone Charms.
 *
 * The proof rides the village row's existing server-owned `settlementReceipts`
 * journal (pinned by api/_village-state-validate.ts), so no field is added. It
 * is written in the SAME all-or-nothing commit (kv.compareSetMany) as the
 * treasury debit and the war-record write that grants the band or the tier:
 * the two rows can never disagree about whether the purchase happened.
 * Modelled on api/_war-structure-payment.ts.
 */

export const WAR_TREASURY_PAYMENT_RECEIPT_LIMIT = 100;

export type WarTreasuryPurchaseKind = 'merc' | 'prep';
export type WarTreasuryPurchase = {
    kind: WarTreasuryPurchaseKind;
    village: string;
    /** The hire id, or `<instance>:<key>:<tier>` for a preparation. */
    ref: string;
    ryo: number;
    boneCharms: number;
};

export function warTreasuryPaymentId(kind: WarTreasuryPurchaseKind, village: string, ref: string): string {
    return `war-treasury:${settlementTransactionId(`war-${kind}`, `${village}:${ref}`)}`;
}

/** The stored proof of this purchase, or null when the village paid nothing for it yet. */
export function findWarTreasuryPayment(state: Record<string, unknown> | null | undefined, kind: WarTreasuryPurchaseKind, village: string, ref: string): WarTreasuryPurchase | null {
    const receipts = state?.settlementReceipts;
    if (!Array.isArray(receipts)) return null;
    const id = warTreasuryPaymentId(kind, village, ref);
    const receipt = receipts.find((r) => r && typeof r === 'object' && (r as SettlementReceipt).transactionId === id) as
        (SettlementReceipt & { purchase?: WarTreasuryPurchase }) | undefined;
    const purchase = receipt?.purchase;
    if (!purchase || purchase.kind !== kind || purchase.village !== village || purchase.ref !== ref
        || receipt.fingerprint !== settlementFingerprint(purchase)) return null;
    return { ...purchase };
}

/** The village row with the treasury debited and the proof appended. Pure. */
export function withWarTreasuryPayment(state: Record<string, unknown>, purchase: WarTreasuryPurchase, appliedAt: number): Record<string, unknown> {
    const treasury = (state.treasury && typeof state.treasury === 'object' ? state.treasury : {}) as Record<string, unknown>;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const debited = {
        ...state,
        treasury: {
            ...treasury,
            ryo: num(treasury.ryo) - purchase.ryo,
            ...(purchase.boneCharms > 0 ? { boneCharms: num(treasury.boneCharms) - purchase.boneCharms } : {}),
        },
    };
    const receipt: SettlementReceipt & { purchase: WarTreasuryPurchase } = {
        transactionId: warTreasuryPaymentId(purchase.kind, purchase.village, purchase.ref),
        fingerprint: settlementFingerprint(purchase),
        resource: 'ryo',
        amount: purchase.ryo,
        appliedAt,
        purchase: { ...purchase },
    };
    return appendSettlementReceipt(debited, receipt, 'settlementReceipts', WAR_TREASURY_PAYMENT_RECEIPT_LIMIT);
}

/** A row's treasury balances, floored at 0. */
export function treasuryBalances(state: Record<string, unknown> | null | undefined): { ryo: number; boneCharms: number } {
    const treasury = (state?.treasury && typeof state.treasury === 'object' ? state.treasury : {}) as Record<string, unknown>;
    const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
    return { ryo: whole(treasury.ryo), boneCharms: whole(treasury.boneCharms) };
}

/** The village row that holds the treasury (the key api/village/war-structure.ts uses). */
export function villageTreasuryKey(village: string): string {
    return `game:village-state:${villageWarSlug(village)}`;
}
