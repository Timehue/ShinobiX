import { createHash } from 'node:crypto';
import { recordSoloPveLifecycle } from '../solo-pve/_telemetry.js';
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
    aiFightParticipantActor,
    applyAiFightOutcomeToCharacter,
    isPveFightMember,
    resolveAiFightOutcome,
    settlementOwnsHpOnWin,
    type AiFightOutcome,
    type AiFightSession,
} from '../missions/_ai-fight-outcome.js';
import { isSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveUsageCosts } from '../solo-pve/_settlement.js';
import { settleSoloPveTerminalUsage } from '../solo-pve/_usage-authority.js';

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

/**
 * Whether the legacy `pve-outcome:<runId>` marker proves THIS player was
 * settled. The marker is one key per run, shared by every participant, and it
 * used to be read as a boolean — so the first teammate to settle a shared Tower
 * run wrote a marker that made every other teammate's settlement "replay"
 * without ever applying their consequence. Only a marker naming this player
 * counts; anything else is treated as evidence about someone else.
 */
export function legacyReceiptSettledPlayer(raw: unknown, playerName: string): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const name = (raw as { playerName?: unknown }).playerName;
    return typeof name === 'string' && name.toLowerCase() === playerName.toLowerCase();
}

export function pveOutcomeReceiptIdentity(
    session: AiFightSession,
    playerName: string,
    outcome = resolveAiFightOutcome(session),
): { requestId: string; fingerprint: string } {
    const runId = sessionId(session);
    const actor = aiFightParticipantActor(session, playerName);
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
    const participant = aiFightParticipantActor(params.session, params.playerName);
    // A member with no body of their own in this run (a companion-only or
    // malformed roster) has nothing a physical outcome could be written to.
    // Refuse WITHOUT a receipt: stamping "done" over an unapplied consequence is
    // the exact failure this module exists to prevent.
    if (!legacyReplay && !participant && params.outcome !== 'unknown') {
        return { ok: false, status: 409, error: 'No fighter of yours was found in that run.' };
    }
    const usageSettledCharacter = !legacyReplay
        && isSoloPveSession(params.session)
        && params.session.encounter.kind === 'mission'
        ? applySoloPveUsageCosts(params.character, params.session)
        : params.character;
    const settledCharacter = legacyReplay
        ? params.character
        : applyAiFightOutcomeToCharacter(
            usageSettledCharacter,
            params.outcome,
            participant,
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
    // Only an IMMUTABLE terminal result may write the body. An active session
    // used to resolve here as a "forfeit" taken from its live HP, which stamped
    // a physical receipt while the owning store still held a playable fight —
    // the fight could go on, and its real terminal result then conflicted with
    // the receipt. An intentional abandon is a terminal transition in the owning
    // store (api/solo-pve/_abandon.ts) that the caller performs FIRST; this
    // settlement only ever reads what that store has already sealed.
    if (session.status !== 'done') {
        return { ok: false, status: 409, error: 'That fight has not reached a terminal result yet.' };
    }
    const outcome = resolveAiFightOutcome(session);
    if (outcome === 'unknown') {
        // A finished fight whose winner cannot be derived is precisely the
        // "unresolved combat session" the daily report alerts on. That counter
        // had no emitter, so the alert could never fire.
        if (isSoloPveSession(session)) void recordSoloPveLifecycle('combat.session_unresolved', session);
        return { ok: true, outcome, applied: false, replayed: false };
    }
    if (outcome === 'win' && settlementOwnsHpOnWin(session)) {
        return { ok: true, outcome, applied: false, replayed: false, deferredToSettlement: true };
    }

    if (isSoloPveSession(session) && session.encounter.kind === 'mission') {
        const usage = await settleSoloPveTerminalUsage(session, playerName);
        if (!usage.ok) return usage;
        session = usage.session;
    }

    const runId = sessionId(session);
    const readLegacyReceipt = deps.readLegacyReceipt ?? ((key) => kv.get(key));
    const writeLegacyReceipt = deps.writeLegacyReceipt ?? (async (key, value, ttlSeconds) => {
        // NX: the marker is one key per run. Overwriting it with a later
        // participant's name would strip the legacy-replay protection of the
        // player it originally named (a save settled before in-save receipts
        // existed has nothing else to prove it). The first writer keeps it;
        // every current-generation settle is proven by its in-save receipt.
        await kv.set(key, value, { ex: ttlSeconds, nx: true });
    });
    const mutateSave = deps.mutateSave ?? mutatePlayerSave;
    const now = deps.now?.() ?? Date.now();
    // Inspect the legacy marker's CONTENTS: it is one key per run, so a marker
    // written for a teammate proves nothing about this player.
    const legacyReceiptExists = legacyReceiptSettledPlayer(await readLegacyReceipt(pveOutcomeReceiptKey(runId)), playerName);

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
    // Settled once, on the first application only. A replay is durable in the
    // save already and must not add a second count; the recorder's nx gate is a
    // second line of defence rather than the only one.
    if (isSoloPveSession(session) && mutation.value.applied && !mutation.value.replayed) {
        void recordSoloPveLifecycle('combat.session_settled', session);
    }
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
