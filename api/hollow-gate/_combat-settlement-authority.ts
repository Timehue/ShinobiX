import { createHash } from 'node:crypto';
import type { HollowGateCombatBinding, HollowGateCombatReward } from './_combat-session.js';
import type { HollowGateRunToken } from './_run-token.js';
import type { SoloPveSession } from '../solo-pve/_session.js';

export const HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD = 'hollowGateCombatSettlements';
export const HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS = 8 * 24 * 60 * 60;
const EXPIRED_HISTORY_LIMIT = 200;
const ACTIVE_SETTLEMENT_HARD_LIMIT = 2_048;

export type HollowGateCombatReceipt = {
    version: 3;
    won: boolean;
    revived?: boolean;
    escaped?: boolean;
    petDefeat?: boolean;
    reward: HollowGateCombatReward;
    elementalShards: number;
    settledAt: number;
};

/**
 * Version 4 is a durable pre-save journal. `won: true` is an intentional
 * legacy-worker tripwire: the rolling v2 handler does not understand v4 and
 * will enter its reward path, where the deliberately absent top-level
 * `reward` fails closed before either the run or binding can advance. The v4
 * handler reads only the sealed `receipt` below. Do not add a top-level reward
 * projection without also removing all v2 workers from service.
 */
export type HollowGateCombatPreparation = {
    version: 4;
    state: 'prepared';
    won: true;
    playerName: string;
    tokenHash: string;
    binding: HollowGateCombatBinding;
    receipt: HollowGateCombatReceipt;
    run: HollowGateRunToken;
    settlementSession: SoloPveSession | null;
    survivingHp: number;
    petIds: string[];
    fingerprint: string;
};

export type HollowGateCombatSettlementMarker = {
    version: 1;
    runId: string;
    fingerprint: string;
    receipt: HollowGateCombatReceipt;
    committedAt: number;
    expiresAt: number;
};

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function hollowGateCombatSettlementFingerprint(params: {
    playerName: string;
    token: string;
    binding: HollowGateCombatBinding;
    receipt: HollowGateCombatReceipt;
}): string {
    const { binding, receipt } = params;
    return sha256(JSON.stringify({
        version: 1,
        playerName: params.playerName.toLowerCase(),
        token: params.token,
        runId: binding.runId,
        floor: binding.floor,
        nodeId: binding.nodeId,
        kind: binding.kind,
        combatMode: binding.combatMode,
        receipt,
    }));
}

export function isHollowGateCombatReceipt(value: unknown): value is HollowGateCombatReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const receipt = value as Partial<HollowGateCombatReceipt>;
    return receipt.version === 3
        && typeof receipt.won === 'boolean'
        && !!receipt.reward && typeof receipt.reward === 'object' && !Array.isArray(receipt.reward)
        && Number.isFinite(Number(receipt.elementalShards)) && Number(receipt.elementalShards) >= 0
        && Number.isFinite(Number(receipt.settledAt)) && Number(receipt.settledAt) > 0;
}

function preparationFingerprint(value: Omit<HollowGateCombatPreparation, 'fingerprint'>): string {
    return sha256(JSON.stringify({
        version: value.version,
        state: value.state,
        won: value.won,
        playerName: value.playerName.toLowerCase(),
        tokenHash: value.tokenHash,
        binding: value.binding,
        receipt: value.receipt,
        run: value.run,
        settlementSession: value.settlementSession,
        survivingHp: value.survivingHp,
        petIds: value.petIds,
    }));
}

export function createHollowGateCombatPreparation(params: {
    playerName: string;
    token: string;
    binding: HollowGateCombatBinding;
    receipt: HollowGateCombatReceipt;
    run: HollowGateRunToken;
    settlementSession: SoloPveSession | null;
    survivingHp: number;
    petIds: string[];
}): HollowGateCombatPreparation {
    const base: Omit<HollowGateCombatPreparation, 'fingerprint'> = {
        version: 4,
        state: 'prepared',
        won: true,
        playerName: params.playerName,
        tokenHash: sha256(params.token),
        binding: structuredClone(params.binding),
        receipt: structuredClone(params.receipt),
        run: structuredClone(params.run),
        settlementSession: params.settlementSession ? structuredClone(params.settlementSession) : null,
        survivingHp: Math.max(0, Math.floor(Number(params.survivingHp) || 0)),
        petIds: [...new Set(params.petIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128))],
    };
    return { ...base, fingerprint: preparationFingerprint(base) };
}

export function readHollowGateCombatPreparation(
    value: unknown,
    params: { playerName: string; token: string; runId: string },
): HollowGateCombatPreparation | null | 'invalid' {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prepared = value as Partial<HollowGateCombatPreparation>;
    if (prepared.version !== 4) return null;
    if (prepared.state !== 'prepared'
        || prepared.won !== true
        || Object.hasOwn(prepared, 'reward')
        || Object.hasOwn(prepared, 'elementalShards')
        || Object.hasOwn(prepared, 'settledAt')
        || Object.hasOwn(prepared, 'revived')
        || Object.hasOwn(prepared, 'escaped')
        || Object.hasOwn(prepared, 'petDefeat')
        || typeof prepared.playerName !== 'string' || prepared.playerName.toLowerCase() !== params.playerName.toLowerCase()
        || prepared.tokenHash !== sha256(params.token)
        || !prepared.binding || prepared.binding.runId !== params.runId
        || typeof prepared.binding.playerName !== 'string'
        || prepared.binding.playerName.toLowerCase() !== params.playerName.toLowerCase()
        || !isHollowGateCombatReceipt(prepared.receipt)
        || !prepared.run || typeof prepared.run.playerName !== 'string'
        || prepared.run.playerName.toLowerCase() !== params.playerName.toLowerCase()
        || prepared.settlementSession !== null && (!prepared.settlementSession
            || prepared.settlementSession.sessionId !== params.runId
            || prepared.settlementSession.ownerSlug.toLowerCase() !== params.playerName.toLowerCase())
        || !Number.isFinite(Number(prepared.survivingHp)) || Number(prepared.survivingHp) < 0
        || !Array.isArray(prepared.petIds) || prepared.petIds.some((id) => typeof id !== 'string' || !id || id.length > 128)
        || typeof prepared.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.fingerprint)) return 'invalid';
    const complete = prepared as HollowGateCombatPreparation;
    const { fingerprint, ...base } = complete;
    return fingerprint === preparationFingerprint(base) ? structuredClone(complete) : 'invalid';
}

export function readHollowGateCombatSettlements(
    character: Record<string, unknown>,
): HollowGateCombatSettlementMarker[] | null {
    const raw = character[HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const markers: HollowGateCombatSettlementMarker[] = [];
    const runIds = new Set<string>();
    for (const value of raw) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const marker = value as Partial<HollowGateCombatSettlementMarker>;
        if (marker.version !== 1
            || typeof marker.runId !== 'string' || marker.runId.length < 1 || marker.runId.length > 96
            || typeof marker.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(marker.fingerprint)
            || !isHollowGateCombatReceipt(marker.receipt)
            || !Number.isFinite(Number(marker.committedAt)) || Number(marker.committedAt) <= 0
            || !Number.isFinite(Number(marker.expiresAt)) || Number(marker.expiresAt) <= Number(marker.committedAt)) return null;
        if (runIds.has(marker.runId)) return null;
        runIds.add(marker.runId);
        markers.push({
            version: 1,
            runId: marker.runId,
            fingerprint: marker.fingerprint,
            receipt: structuredClone(marker.receipt),
            committedAt: Number(marker.committedAt),
            expiresAt: Number(marker.expiresAt),
        });
    }
    return markers;
}

export function findHollowGateCombatSettlement(params: {
    character: Record<string, unknown>;
    playerName: string;
    token: string;
    binding: HollowGateCombatBinding;
}): HollowGateCombatSettlementMarker | null | 'invalid' {
    const markers = readHollowGateCombatSettlements(params.character);
    if (!markers) return 'invalid';
    const marker = markers.find((entry) => entry.runId === params.binding.runId);
    if (!marker) return null;
    return marker.fingerprint === hollowGateCombatSettlementFingerprint({ ...params, receipt: marker.receipt })
        ? marker
        : 'invalid';
}

export function appendHollowGateCombatSettlement(params: {
    character: Record<string, unknown>;
    playerName: string;
    token: string;
    binding: HollowGateCombatBinding;
    receipt: HollowGateCombatReceipt;
    now: number;
}): { ok: true; character: Record<string, unknown>; marker: HollowGateCombatSettlementMarker }
    | { ok: false; error: string } {
    const markers = readHollowGateCombatSettlements(params.character);
    if (!markers) return { ok: false, error: 'The Hollow Gate combat settlement manifest is invalid.' };
    const existing = markers.find((entry) => entry.runId === params.binding.runId);
    const fingerprint = hollowGateCombatSettlementFingerprint(params);
    if (existing) {
        return existing.fingerprint === fingerprint
            ? { ok: true, character: params.character, marker: existing }
            : { ok: false, error: 'The Hollow Gate combat settlement conflicts with this run.' };
    }
    const active = markers.filter((entry) => entry.expiresAt > params.now);
    if (active.length >= ACTIVE_SETTLEMENT_HARD_LIMIT) {
        return { ok: false, error: 'Too many unresolved Hollow Gate combat settlements.' };
    }
    const marker: HollowGateCombatSettlementMarker = {
        version: 1,
        runId: params.binding.runId,
        fingerprint,
        receipt: structuredClone(params.receipt),
        committedAt: params.now,
        expiresAt: params.now + HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS * 1_000,
    };
    const expired = markers.filter((entry) => entry.expiresAt <= params.now);
    return {
        ok: true,
        marker,
        character: {
            ...params.character,
            [HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD]: [marker, ...active, ...expired.slice(0, EXPIRED_HISTORY_LIMIT - 1)],
        },
    };
}
