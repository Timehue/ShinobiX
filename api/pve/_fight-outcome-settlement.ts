import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
} from '../_settlement-receipts.js';
import {
    mutatePlayerSave,
    type PlayerSaveMutationResult,
} from '../save/_mutate-player-save.js';
import {
    aiFightPlayerActor,
    applyAiFightOutcomeToCharacter,
    isPveFightMember,
    resolveAiFightOutcome,
    settlementOwnsHpOnWin,
    type AiFightOutcome,
    type AiFightSession,
} from '../missions/_ai-fight-outcome.js';
import { isSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';

const OUTCOME_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

type OutcomeMutationValue = {
    outcome: AiFightOutcome;
    applied: boolean;
    replayed: boolean;
    migratedLegacyReceipt?: boolean;
};

export type PveFightOutcomeSettlement = OutcomeMutationValue & {
    ok: true;
    character?: Record<string, unknown>;
    _saveVersion?: number;
    deferredToSettlement?: boolean;
};

export type PveFightOutcomeSettlementFailure = {
    ok: false;
    status: number;
    error: string;
};

export type PveFightOutcomeSettlementResult = PveFightOutcomeSettlement | PveFightOutcomeSettlementFailure;

type MutateSave = typeof mutatePlayerSave;

export type PveFightOutcomeSettlementDeps = {
    now?: () => number;
    readLegacyReceipt?: (key: string) => Promise<unknown>;
    writeLegacyReceipt?: (key: string, value: Record<string, unknown>, ttlSeconds: number) => Promise<void>;
    mutateSave?: MutateSave;
};

function sessionId(session: AiFightSession): string {
    return isSoloPveSession(session) ? session.sessionId : session.runId;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function pveOutcomeReceiptKey(runId: string): string {
    return `pve-outcome:${runId}`;
}

export function pveOutcomeReceiptIdentity(
    session: AiFightSession,
    playerName: string,
    outcome = resolveAiFightOutcome(session),
): { requestId: string; fingerprint: string } {
    const runId = sessionId(session);
    const actor = aiFightPlayerActor(session);
    const encounter = isSoloPveSession(session)
        ? { kind: session.encounter.kind, id: session.encounter.id, bindingId: session.encounter.bindingId ?? '' }
        : { kind: 'tower', id: session.towerId, bindingId: session.runId };
    return {
        requestId: `pveoutcome_${sha256(runId).slice(0, 32)}`,
        fingerprint: sha256(JSON.stringify({
            runId,
            playerName: playerName.toLowerCase(),
            outcome,
            encounter,
            winner: session.winner,
            playerHp: Number(actor?.hp ?? -1),
            playerMaxHp: Number(actor?.maxHp ?? -1),
        })),
    };
}

/**
 * Apply the physical consequence and its idempotency receipt in one save write.
 * The legacy KV marker is treated as an already-applied result and migrated into
 * the save receipt so a retry stays safe after the old marker expires.
 */
export function applyPveOutcomeWithReceipt(params: {
    character: Record<string, unknown>;
    session: AiFightSession;
    playerName: string;
    outcome: AiFightOutcome;
    now: number;
    legacyReceiptExists?: boolean;
}): { ok: true; character: Record<string, unknown>; value: OutcomeMutationValue } | PveFightOutcomeSettlementFailure {
    const identity = pveOutcomeReceiptIdentity(params.session, params.playerName, params.outcome);
    const inspected = inspectSettlementReceipt(params.character, identity.requestId, identity.fingerprint);
    if (inspected.status === 'conflict' || inspected.status === 'invalid') {
        return { ok: false, status: 409, error: 'The fight outcome receipt is invalid or conflicts with this run.' };
    }
    if (inspected.status === 'replay') {
        return {
            ok: true,
            character: params.character,
            value: { outcome: params.outcome, applied: false, replayed: true },
        };
    }

    const legacyReplay = params.legacyReceiptExists === true;
    const settledCharacter = legacyReplay
        ? params.character
        : applyAiFightOutcomeToCharacter(
            params.character,
            params.outcome,
            aiFightPlayerActor(params.session),
            params.now,
        );
    const value: OutcomeMutationValue = {
        outcome: params.outcome,
        applied: !legacyReplay,
        replayed: legacyReplay,
        ...(legacyReplay ? { migratedLegacyReceipt: true } : {}),
    };
    return {
        ok: true,
        character: appendSettlementReceipt(settledCharacter, inspected.receipts, {
            requestId: identity.requestId,
            fingerprint: identity.fingerprint,
            value: { kind: 'pve-outcome', runId: sessionId(params.session), ...value },
            settledAt: params.now,
        }),
        value,
    };
}

/** Settle one server-owned fight outcome with atomic in-save replay evidence. */
export async function settlePveFightOutcome(
    session: AiFightSession,
    playerName: string,
    deps: PveFightOutcomeSettlementDeps = {},
): Promise<PveFightOutcomeSettlementResult> {
    if (!isPveFightMember(session, playerName)) {
        return { ok: false, status: 403, error: 'That fight belongs to another player.' };
    }
    const outcome = resolveAiFightOutcome(session);
    if (outcome === 'unknown') return { ok: true, outcome, applied: false, replayed: false };
    if (outcome === 'win' && settlementOwnsHpOnWin(session)) {
        return { ok: true, outcome, applied: false, replayed: false, deferredToSettlement: true };
    }

    const runId = sessionId(session);
    const readLegacyReceipt = deps.readLegacyReceipt ?? ((key) => kv.get(key));
    const writeLegacyReceipt = deps.writeLegacyReceipt ?? (async (key, value, ttlSeconds) => {
        await kv.set(key, value, { ex: ttlSeconds });
    });
    const mutateSave = deps.mutateSave ?? mutatePlayerSave;
    const now = deps.now?.() ?? Date.now();
    const legacyReceiptExists = !!(await readLegacyReceipt(pveOutcomeReceiptKey(runId)));

    const mutation: PlayerSaveMutationResult<OutcomeMutationValue> = await mutateSave(playerName, ({ character }) => {
        const applied = applyPveOutcomeWithReceipt({
            character,
            session,
            playerName,
            outcome,
            now,
            legacyReceiptExists,
        });
        if (!applied.ok) return applied;
        return {
            ok: true as const,
            character: applied.character,
            value: applied.value,
            // A normal replay is already durable in this exact save. Legacy
            // replay migration still writes the new in-save receipt once.
            write: !(applied.value.replayed && !applied.value.migratedLegacyReceipt),
        };
    });
    if (!mutation.ok) return mutation;

    // Compatibility marker: old deployments read this key. The in-save receipt
    // above is already durable, so a failure here is safe to retry and cannot
    // apply HP/hospitalization twice.
    await writeLegacyReceipt(pveOutcomeReceiptKey(runId), {
        runId,
        playerName,
        outcome,
        at: now,
    }, OUTCOME_RECEIPT_TTL_SECONDS);
    return {
        ok: true,
        ...mutation.value,
        character: mutation.character,
        _saveVersion: mutation._saveVersion,
    };
}

/**
 * Mission fights have no other HP writer. Story/Academy wins are already folded
 * into their reward settlement, while their losses still need reconciliation.
 */
export function soloPveNeedsAutomaticOutcome(session: SoloPveSession): boolean {
    if (session.status !== 'done') return false;
    if (session.encounter.kind === 'mission') return true;
    if (session.encounter.kind !== 'story-boss' && session.encounter.kind !== 'academy-spar') return false;
    return resolveAiFightOutcome(session) !== 'win';
}

export async function reconcileTerminalSoloPveOutcome(
    session: SoloPveSession,
    playerName: string,
    deps: PveFightOutcomeSettlementDeps = {},
): Promise<PveFightOutcomeSettlementResult | null> {
    return soloPveNeedsAutomaticOutcome(session)
        ? settlePveFightOutcome(session, playerName, deps)
        : null;
}
