import { createHash } from 'node:crypto';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { debitTowerStoryEntry, refundTowerEntry, type TowerEntryCharacter } from './_entry-fee.js';

type PartyEntryReceiptValue = {
    kind: 'tower-party-entry';
    partyId: string;
    runId: string;
    state: 'reserved' | 'refunded';
    day: string;
    floorId: number;
    charged: number;
    counted: boolean;
};

const DIRECT_TOWER_ENTRY_SCOPE = 'tower-direct-entry';

export type PartyEntryReservation =
    | {
        ok: true;
        character: TowerEntryCharacter;
        charged: number;
        counted: boolean;
        replayFree: boolean;
        changed: boolean;
        replayed: boolean;
    }
    | { ok: false; code: 'insufficient-ryo'; required: number }
    | { ok: false; code: 'invalid-receipt' };

export type PartyEntryRefund =
    | { ok: true; character: TowerEntryCharacter; changed: boolean }
    | { ok: false; code: 'missing-receipt' | 'invalid-receipt' };

function identity(partyId: string, runId: string) {
    const digest = createHash('sha256').update(JSON.stringify(['tower-party-entry', partyId, runId])).digest('hex');
    return {
        requestId: `tower_party_entry_${digest.slice(0, 32)}`,
        fingerprint: `tower-party-entry:${digest}`,
    };
}

function receiptValue(raw: Record<string, unknown>, partyId: string, runId: string): PartyEntryReceiptValue | null {
    if (raw.kind !== 'tower-party-entry' || raw.partyId !== partyId || raw.runId !== runId) return null;
    if (raw.state !== 'reserved' && raw.state !== 'refunded') return null;
    if (typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day)) return null;
    const floorId = Number(raw.floorId);
    if (!Number.isSafeInteger(floorId) || floorId < 1) return null;
    const charged = Number(raw.charged);
    if (!Number.isSafeInteger(charged) || charged < 0) return null;
    if (typeof raw.counted !== 'boolean') return null;
    if (!raw.counted && charged !== 0) return null;
    return {
        kind: 'tower-party-entry', partyId, runId,
        state: raw.state, day: raw.day, floorId, charged, counted: raw.counted,
    };
}

function stamp(
    character: TowerEntryCharacter,
    receipts: Parameters<typeof appendSettlementReceipt>[1],
    partyId: string,
    runId: string,
    state: PartyEntryReceiptValue['state'],
    day: string,
    floorId: number,
    charged: number,
    counted: boolean,
    now: number,
): TowerEntryCharacter {
    const receipt = identity(partyId, runId);
    return appendSettlementReceipt(character, receipts, {
        ...receipt,
        value: { kind: 'tower-party-entry', partyId, runId, state, day, floorId, charged, counted },
        settledAt: now,
    });
}

/**
 * Reserve the host's story-Tower entry exactly once for a prepared party run.
 * A compensated retry re-reserves against the current day; an in-flight retry
 * observes the durable save-local receipt and never debits twice.
 */
export function reserveTowerPartyEntry(input: {
    character: TowerEntryCharacter;
    partyId: string;
    runId: string;
    day: string;
    floorId: number;
    now: number;
}): PartyEntryReservation {
    const receipt = identity(input.partyId, input.runId);
    const inspection = inspectSettlementReceipt(input.character, receipt.requestId, receipt.fingerprint);
    if (inspection.status === 'conflict' || inspection.status === 'invalid') return { ok: false, code: 'invalid-receipt' };
    if (inspection.status === 'replay') {
        const value = receiptValue(inspection.receipt.value, input.partyId, input.runId);
        if (!value || value.floorId !== input.floorId) return { ok: false, code: 'invalid-receipt' };
        if (value.state === 'reserved') {
            return {
                ok: true,
                character: input.character,
                charged: value.charged,
                counted: value.counted,
                replayFree: !value.counted,
                changed: false,
                replayed: true,
            };
        }
        const reserved = debitTowerStoryEntry(input.character, input.day, input.floorId);
        if (!reserved.ok) return { ok: false, code: 'insufficient-ryo', required: reserved.required };
        return {
            ok: true,
            character: stamp(
                reserved.character,
                inspection.receipts,
                input.partyId,
                input.runId,
                'reserved',
                input.day,
                input.floorId,
                reserved.charged,
                reserved.counted,
                input.now,
            ),
            charged: reserved.charged,
            counted: reserved.counted,
            replayFree: reserved.replayFree,
            changed: true,
            replayed: true,
        };
    }

    const reserved = debitTowerStoryEntry(input.character, input.day, input.floorId);
    if (!reserved.ok) return { ok: false, code: 'insufficient-ryo', required: reserved.required };
    return {
        ok: true,
        character: stamp(
            reserved.character,
            inspection.receipts,
            input.partyId,
            input.runId,
            'reserved',
            input.day,
            input.floorId,
            reserved.charged,
            reserved.counted,
            input.now,
        ),
        charged: reserved.charged,
        counted: reserved.counted,
        replayFree: reserved.replayFree,
        changed: true,
        replayed: false,
    };
}

/** Compensate only an observed durable reservation; never mint from a missing receipt. */
export function refundTowerPartyEntryReservation(input: {
    character: TowerEntryCharacter;
    partyId: string;
    runId: string;
    now: number;
}): PartyEntryRefund {
    const receipt = identity(input.partyId, input.runId);
    const inspection = inspectSettlementReceipt(input.character, receipt.requestId, receipt.fingerprint);
    if (inspection.status === 'fresh') return { ok: false, code: 'missing-receipt' };
    if (inspection.status === 'conflict' || inspection.status === 'invalid') return { ok: false, code: 'invalid-receipt' };
    const value = receiptValue(inspection.receipt.value, input.partyId, input.runId);
    if (!value) return { ok: false, code: 'invalid-receipt' };
    if (value.state === 'refunded') return { ok: true, character: input.character, changed: false };
    const refunded = refundTowerEntry(input.character, value.day, value.charged, value.counted);
    return {
        ok: true,
        character: stamp(
            refunded,
            inspection.receipts,
            input.partyId,
            input.runId,
            'refunded',
            value.day,
            value.floorId,
            value.charged,
            value.counted,
            input.now,
        ),
        changed: true,
    };
}

/** Direct starts use the same durable receipt saga, keyed only by the minted run. */
export function reserveTowerDirectEntry(input: Omit<Parameters<typeof reserveTowerPartyEntry>[0], 'partyId'>): PartyEntryReservation {
    return reserveTowerPartyEntry({ ...input, partyId: DIRECT_TOWER_ENTRY_SCOPE });
}

export function refundTowerDirectEntryReservation(input: Omit<Parameters<typeof refundTowerPartyEntryReservation>[0], 'partyId'>): PartyEntryRefund {
    return refundTowerPartyEntryReservation({ ...input, partyId: DIRECT_TOWER_ENTRY_SCOPE });
}
