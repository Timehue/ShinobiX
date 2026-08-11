import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { LockOptions } from '../_lock.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { applySoloPveAction, type SoloPveEngineOptions } from './_engine.js';
import {
    SOLO_PVE_MOVE_TOKEN_HISTORY,
    SOLO_PVE_SESSION_TTL_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    type SoloPveAction,
    type SoloPveCombatEvent,
    type SoloPveRejectionEvent,
    type SoloPveSession,
    type SoloPvePendingItemAction,
} from './_session.js';
import {
    compareWriteSoloPveSession,
    readSoloPveSession,
    soloPveSessionKey,
} from './_store.js';
import {
    claimAuthoritativeSoloPveCompanion,
    finalizeSoloPveCompanionUsage,
    releaseSoloPveSummonLeaseValue,
    settleSoloPveCompanionUsage,
    type SoloPveCompanionChargeResult,
    type SoloPveCompanionFinalizeResult,
    type SoloPveSummonClaim,
} from './_pet-battle-authority.js';
import {
    claimSoloPveItemActionLease,
    finalizeSoloPveItemActionUsage,
    releaseSoloPveItemActionLease,
    settleSoloPveItemActionUsage,
    soloPveItemCostAuthority,
    type SoloPveItemActionLease,
    type SoloPveItemChargeResult,
    type SoloPveItemFinalizeResult,
} from './_item-usage-authority.js';
import type { SoloPveItemCostAuthority } from './_session.js';
import {
    claimSoloPveItemActionIntent,
    createSoloPveItemActionIntent,
    readActiveSoloPveItemActionIntent,
    releaseSoloPveItemActionIntent,
    type SoloPveItemActionIntent,
} from './_item-action-intent.js';
import {
    soloPveUsesCommonUsageAuthority,
    unsettledSoloPveItemUsage,
    usesSoloPveUsageAuthorityV1,
} from './_usage-receipts.js';

export type SoloPveLock = <T>(
    target: string,
    fn: () => Promise<T>,
    options?: LockOptions,
) => Promise<T>;

export type SoloPveActionCommand = {
    sessionId: string;
    ownerSlug: string;
    expectedVersion: number;
    moveToken: string;
    action: SoloPveAction;
};

export type SoloPveActionServiceResult = {
    status: number;
    body: {
        applied?: boolean;
        duplicate?: boolean;
        reason?: string;
        error?: string;
        event?: SoloPveCombatEvent | SoloPveRejectionEvent;
        session?: SoloPveSession;
    };
};

export type SoloPveActionServiceDeps = {
    read?: (sessionId: string) => Promise<SoloPveSession | null>;
    write?: (session: SoloPveSession) => Promise<void>;
    commit?: (expected: SoloPveSession, next: SoloPveSession) => Promise<boolean>;
    lock?: SoloPveLock;
    now?: () => number;
    engineOptions?: SoloPveEngineOptions;
    claimCompanion?: (session: SoloPveSession, now: number, moveToken: string) => Promise<SoloPveSummonClaim>;
    settleCompanion?: (session: SoloPveSession) => Promise<SoloPveCompanionChargeResult>;
    finalizeCompanion?: (session: SoloPveSession) => Promise<SoloPveCompanionFinalizeResult>;
    releaseCompanion?: (session: SoloPveSession) => Promise<boolean>;
    claimItem?: (session: SoloPveSession, moveToken: string) => Promise<SoloPveItemActionLease | null>;
    settleItem?: (session: SoloPveSession, authority: Omit<SoloPveItemCostAuthority, 'chargedAt'>) => Promise<SoloPveItemChargeResult>;
    finalizeItem?: (session: SoloPveSession, authority: SoloPveItemCostAuthority) => Promise<SoloPveItemFinalizeResult>;
    releaseItem?: (session: SoloPveSession, authority: Pick<SoloPveItemCostAuthority, 'moveToken'>) => Promise<boolean>;
    claimItemIntent?: (intent: SoloPveItemActionIntent) => Promise<boolean>;
    readItemIntent?: (sessionId: string) => Promise<SoloPveItemActionIntent | null | 'invalid'>;
    releaseItemIntent?: (intent: SoloPveItemActionIntent) => Promise<boolean>;
};

export function isValidSoloPveMoveToken(value: string): boolean {
    return /^[A-Za-z0-9_-]{8,96}$/.test(value);
}
export async function executeSoloPveAction(
    command: SoloPveActionCommand,
    deps: SoloPveActionServiceDeps = {},
): Promise<SoloPveActionServiceResult> {
    if (!command.sessionId || !command.ownerSlug) {
        return { status: 400, body: { error: 'Missing solo-PvE session identity.' } };
    }
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
        return { status: 400, body: { error: 'A positive expectedVersion is required.' } };
    }
    if (!isValidSoloPveMoveToken(command.moveToken)) {
        return { status: 400, body: { error: 'A valid moveToken is required.' } };
    }

    const read = deps.read ?? readSoloPveSession;
    const commit = deps.commit ?? (deps.write
        ? async (_expected: SoloPveSession, next: SoloPveSession): Promise<boolean> => {
            try {
                await deps.write!(next);
                return true;
            } catch (error) {
                let readback: SoloPveSession | null;
                try {
                    readback = await read(next.sessionId);
                } catch {
                    throw error;
                }
                if (isDeepStrictEqual(readback, next)) return true;
                throw error;
            }
        }
        : (expected: SoloPveSession, next: SoloPveSession) => compareWriteSoloPveSession(expected, next));
    const lock = deps.lock ?? withKvLock;
    const now = deps.now ?? Date.now;
    const engineOptions: SoloPveEngineOptions = deps.engineOptions ?? {
        escapeSucceeds: () => randomInt(2) === 0,
    };
    const claimCompanion = deps.claimCompanion ?? ((session, at, moveToken) => claimAuthoritativeSoloPveCompanion(
        session,
        at,
        { moveToken },
    ));
    const settleCompanion = deps.settleCompanion ?? ((session) => settleSoloPveCompanionUsage(session));
    const finalizeCompanion = deps.finalizeCompanion ?? ((session) => finalizeSoloPveCompanionUsage(session));
    const releaseCompanion = deps.releaseCompanion ?? ((session) => {
        const authority = session.companionCostAuthority;
        return authority
            ? releaseSoloPveSummonLeaseValue(kv, session.ownerSlug, authority.leaseValue)
            : Promise.resolve(false);
    });
    const claimItem = deps.claimItem ?? ((session, moveToken) => claimSoloPveItemActionLease(
        kv,
        session.ownerSlug,
        session.sessionId,
        moveToken,
    ));
    const settleItem = deps.settleItem ?? ((session, authority) => settleSoloPveItemActionUsage(session, authority));
    const finalizeItem = deps.finalizeItem ?? ((session, authority) => finalizeSoloPveItemActionUsage(session, authority));
    const releaseItem = deps.releaseItem ?? ((session, authority) => releaseSoloPveItemActionLease(
        kv,
        session.ownerSlug,
        session.sessionId,
        authority.moveToken,
    ));
    const claimItemIntent = deps.claimItemIntent ?? ((intent) => claimSoloPveItemActionIntent(intent));
    const readItemIntent = deps.readItemIntent ?? ((sessionId) => readActiveSoloPveItemActionIntent(sessionId));
    const releaseItemIntent = deps.releaseItemIntent ?? ((intent) => releaseSoloPveItemActionIntent(intent));

    return lock(soloPveSessionKey(command.sessionId), async () => {
        let session = await read(command.sessionId);
        if (!session) return { status: 404, body: { error: 'Solo-PvE session not found.' } };
        if (session.ownerSlug.toLowerCase() !== command.ownerSlug.toLowerCase()) {
            return { status: 403, body: { error: 'This solo-PvE session belongs to another player.' } };
        }
        const sealedUsageAuthority = usesSoloPveUsageAuthorityV1(session);
        const unsettledItems = sealedUsageAuthority ? unsettledSoloPveItemUsage(session) : {};
        if (unsettledItems === null) {
            return { status: 409, body: { error: 'The combat-item usage authority is invalid.', session } };
        }
        const hasRollingLegacyGap = sealedUsageAuthority && (
            (!!session.companionUsage && !session.companionCostAuthority)
            || Object.keys(unsettledItems).length > 0
        );
        const canActivateUsageAuthority = !sealedUsageAuthority
            && soloPveUsesCommonUsageAuthority(session)
            && session.status === 'active'
            && !session.companionUsage
            && !session.companionCostAuthority
            && Object.values(session.itemsUsed).every((count) => Number(count) <= 0)
            && !(session.itemCostAuthorities?.length)
            && !session.pendingItemAction;
        const usesActionAuthority = (sealedUsageAuthority && !hasRollingLegacyGap) || canActivateUsageAuthority;

        const withoutPendingItem = (value: SoloPveSession): SoloPveSession => {
            const { pendingItemAction: _pending, ...clean } = value;
            return clean;
        };
        const itemDeltas = (before: SoloPveSession, after: SoloPveSession) => Object.entries(after.itemsUsed)
            .map(([itemId, total]) => ({
                itemId,
                count: Math.max(0, Math.floor(Number(total) || 0) - Math.max(0, Math.floor(Number(before.itemsUsed[itemId]) || 0))),
            }))
            .filter(({ count }) => count > 0);
        const materializeAction = (
            base: SoloPveSession,
            resolvedSessionRaw: SoloPveSession,
            actionAt: number,
            itemAuthority?: SoloPveItemCostAuthority,
            summonClaim?: Extract<SoloPveSummonClaim, { ok: true }> | null,
        ): SoloPveSession => {
            let resolvedSession = withoutPendingItem(resolvedSessionRaw);
            const actionUsesAuthority = usesActionAuthority
                || base.usageAuthorityVersion === 1
                || !!itemAuthority
                || !!summonClaim;
            if (summonClaim) {
                resolvedSession = {
                    ...resolvedSession,
                    companionCostAuthority: {
                        version: 1,
                        leaseValue: summonClaim.lease.value,
                        moveToken: command.moveToken,
                        settlementState: 'pending',
                    },
                };
            }
            if (itemAuthority) {
                resolvedSession = {
                    ...resolvedSession,
                    itemCostAuthorities: [
                        ...(base.itemCostAuthorities ?? []).filter((entry) => entry.moveToken !== itemAuthority.moveToken),
                        itemAuthority,
                    ].slice(-128),
                };
            }
            const nextVersion = base.version + 1;
            const terminalEvidence = resolvedSession.status === 'done' && resolvedSession.winner && resolvedSession.outcome
                ? {
                    finishedAt: actionAt,
                    finalMoveToken: command.moveToken,
                    finalVersion: nextVersion,
                    finalEventSeq: resolvedSession.eventSeq,
                    winner: resolvedSession.winner,
                    outcome: resolvedSession.outcome,
                    itemsUsed: { ...resolvedSession.itemsUsed },
                    ...(resolvedSession.companionUsage ? { companionUsage: { ...resolvedSession.companionUsage } } : {}),
                    settlementState: resolvedSession.settlementState,
                }
                : resolvedSession.terminalEvidence;
            return {
                ...resolvedSession,
                ...(actionUsesAuthority ? { usageAuthorityVersion: 1 as const } : {}),
                version: nextVersion,
                recentMoveTokens: [...base.recentMoveTokens, command.moveToken].slice(-SOLO_PVE_MOVE_TOKEN_HISTORY),
                lastActionAt: actionAt,
                expiresAt: actionAt + (resolvedSession.status === 'done'
                    ? SOLO_PVE_TERMINAL_TTL_SECONDS
                    : Math.max(
                        SOLO_PVE_SESSION_TTL_SECONDS,
                        Math.min(2 * 60 * 60, Math.floor(Number(resolvedSession.activeTtlSeconds) || SOLO_PVE_SESSION_TTL_SECONDS)),
                    )) * 1000,
                ...(terminalEvidence ? { terminalEvidence } : {}),
            };
        };

        // A crash can land the summoned session before its atomic save charge.
        // No retry, later move, terminal outcome, or reward may pass it.
        if (usesActionAuthority && session.companionCostAuthority?.settlementState === 'pending') {
            const pending = session;
            const charged = await settleCompanion(pending);
            if (!charged.ok) return { status: charged.status, body: { error: charged.error, session: pending } };
            const settled: SoloPveSession = {
                ...pending,
                companionCostAuthority: {
                    ...pending.companionCostAuthority!,
                    settlementState: 'settled',
                    chargedAt: charged.chargedAt,
                },
            };
            if (await commit(pending, settled)) {
                session = settled;
            } else {
                const latest = await read(command.sessionId);
                if (!latest
                    || latest.companionCostAuthority?.settlementState !== 'settled'
                    || latest.companionCostAuthority.leaseValue !== settled.companionCostAuthority?.leaseValue
                    || latest.companionCostAuthority.chargedAt !== settled.companionCostAuthority?.chargedAt) {
                    return { status: 409, body: { error: 'The companion settlement lost session authority.', session: latest ?? pending } };
                }
                session = latest;
            }
            const finalized = await finalizeCompanion(session);
            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error, session } };
            if (!(await releaseCompanion(session))) throw new Error('solo-pve-summon-lease-release-failed');
        } else if (usesActionAuthority && session.companionCostAuthority?.settlementState === 'settled') {
            const finalized = await finalizeCompanion(session);
            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error, session } };
            if (!(await releaseCompanion(session))) throw new Error('solo-pve-summon-lease-release-failed');
        }

        const latestItemAuthority = usesActionAuthority
            ? session.itemCostAuthorities?.[session.itemCostAuthorities.length - 1]
            : undefined;
        if (latestItemAuthority) {
            const finalized = await finalizeItem(session, latestItemAuthority);
            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error, session } };
            if (!(await releaseItem(session, latestItemAuthority))) throw new Error('solo-pve-item-lease-release-failed');
        }

        const completePendingItem = async (
            reserved: SoloPveSession,
            providedIntent?: SoloPveItemActionIntent,
        ): Promise<SoloPveActionServiceResult> => {
            let intent = providedIntent;
            const pending = intent?.pending ?? reserved.pendingItemAction;
            const requestMustMatch = !providedIntent;
            const requestedItemAction = command.action.type === 'item' || command.action.type === 'weapon'
                ? command.action
                : null;
            if (!pending
                || pending.version !== 1
                || pending.expectedVersion !== reserved.version
                || (requestMustMatch && pending.moveToken !== command.moveToken)
                || (requestMustMatch && pending.expectedVersion !== command.expectedVersion)
                || (requestMustMatch && pending.action.type !== command.action.type)
                || (requestMustMatch && !requestedItemAction)
                || (requestMustMatch && pending.action.itemId !== requestedItemAction?.itemId)
                || (requestMustMatch && pending.itemId !== requestedItemAction?.itemId)
                || pending.leaseValue !== `solo-pve-item:${reserved.sessionId}:${pending.moveToken}`
                || (intent && !isDeepStrictEqual(intent.reservedSession, reserved))) {
                return { status: 409, body: { error: 'Another combat item action is still settling.', session: reserved } };
            }
            const lease = await claimItem(reserved, pending.moveToken);
            const base = withoutPendingItem(reserved);
            const resolvedSession = intent?.resolvedSession ?? applySoloPveAction(base, pending.action, engineOptions).session;
            const resolvedEvent = intent?.event ?? resolvedSession.events[resolvedSession.events.length - 1];
            const deltas = itemDeltas(base, resolvedSession);
            if (!resolvedEvent
                || deltas.length !== 1
                || deltas[0]!.itemId !== pending.itemId
                || deltas[0]!.count !== pending.count) {
                return { status: 409, body: { error: 'The pending combat item action no longer matches its sealed intent.', session: reserved } };
            }
            if (!intent) {
                intent = createSoloPveItemActionIntent({
                    baseSession: base,
                    reservedSession: reserved,
                    resolvedSession,
                    event: resolvedEvent,
                    actionAt: pending.reservedAt,
                    pending,
                });
                if (!(await claimItemIntent(intent))) {
                    return { status: 409, body: { error: 'The combat item recovery intent could not be reserved.', session: reserved } };
                }
            }
            const provisional: Omit<SoloPveItemCostAuthority, 'chargedAt'> = {
                version: 1,
                leaseValue: pending.leaseValue,
                moveToken: pending.moveToken,
                itemId: pending.itemId,
                count: pending.count,
            };
            const charged = await settleItem(base, provisional);
            if (!charged.ok) {
                // A definitive debit rejection can safely roll the unchanged
                // reservation back. If fencing fails, retain the lease and the
                // pending intent for exact recovery instead of guessing.
                if (await commit(reserved, base)) {
                    if (!(await releaseItem(base, provisional))) throw new Error('solo-pve-item-lease-release-failed');
                    if (!(await releaseItemIntent(intent))) throw new Error('solo-pve-item-intent-release-failed');
                    return { status: charged.status, body: { error: charged.error, session: base } };
                }
                return { status: 409, body: { error: 'The rejected item action could not release its session reservation.', session: await read(command.sessionId) ?? reserved } };
            }
            if (lease && lease.value !== pending.leaseValue) {
                return { status: 409, body: { error: 'The pending combat item action lease conflicts with its intent.', session: reserved } };
            }
            const authority = soloPveItemCostAuthority({
                session: base,
                ...provisional,
                chargedAt: charged.chargedAt,
            });
            const next = materializeAction(base, resolvedSession, intent?.actionAt ?? now(), authority);
            let committed = await commit(reserved, next);
            let latest = committed ? next : await read(reserved.sessionId);
            if (!committed) {
                const latestAuthority = latest?.itemCostAuthorities?.find((entry) => entry.moveToken === authority.moveToken);
                const exactCommitted = !!latest
                    && latest.recentMoveTokens.includes(pending.moveToken)
                    && !!latestAuthority
                    && latestAuthority.leaseValue === authority.leaseValue
                    && latestAuthority.itemId === authority.itemId
                    && latestAuthority.count === authority.count
                    && latestAuthority.chargedAt === authority.chargedAt;
                if (!exactCommitted && latest) {
                    const activeIntent = await readItemIntent(intent.sessionId);
                    const canHelpForward = activeIntent !== 'invalid'
                        && !!activeIntent
                        && isDeepStrictEqual(activeIntent, intent)
                        && latest.sessionId === intent.sessionId
                        && latest.ownerSlug.toLowerCase() === intent.ownerSlug
                        && latest.createdAt === intent.baseSession.createdAt
                        && !latest.recentMoveTokens.includes(intent.moveToken);
                    if (canHelpForward) {
                        committed = await commit(latest, next);
                        latest = committed ? next : await read(intent.sessionId);
                    }
                }
                const recoveredAuthority = latest?.itemCostAuthorities?.find((entry) => entry.moveToken === authority.moveToken);
                if (!latest
                    || !latest.recentMoveTokens.includes(pending.moveToken)
                    || !recoveredAuthority
                    || recoveredAuthority.leaseValue !== authority.leaseValue
                    || recoveredAuthority.itemId !== authority.itemId
                    || recoveredAuthority.count !== authority.count
                    || recoveredAuthority.chargedAt !== authority.chargedAt) {
                    return { status: 409, body: { error: 'The charged item action remains recoverable but has not regained session authority.', session: latest ?? reserved } };
                }
            }
            const committedSession = latest ?? next;
            const committedAuthority = committedSession.itemCostAuthorities?.find((entry) => entry.moveToken === authority.moveToken) ?? authority;
            const finalized = await finalizeItem(committedSession, committedAuthority);
            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error, session: committedSession } };
            if (!(await releaseItem(committedSession, committedAuthority))) throw new Error('solo-pve-item-lease-release-failed');
            if (!(await releaseItemIntent(intent))) throw new Error('solo-pve-item-intent-release-failed');
            return committed
                ? { status: 200, body: { applied: true, event: resolvedEvent, session: committedSession } }
                : { status: 200, body: { applied: false, duplicate: true, reason: 'duplicate-move-token', session: committedSession } };
        };

        const activeItemIntent = await readItemIntent(session.sessionId);
        if (activeItemIntent === 'invalid') {
            return { status: 409, body: { error: 'The pending combat item intent is invalid.', session } };
        }
        if (activeItemIntent) {
            const recovered = await completePendingItem(activeItemIntent.reservedSession, activeItemIntent);
            const matchesRequest = activeItemIntent.moveToken === command.moveToken
                && activeItemIntent.expectedVersion === command.expectedVersion
                && activeItemIntent.pending.action.type === command.action.type
                && (command.action.type === 'item' || command.action.type === 'weapon')
                && activeItemIntent.pending.itemId === command.action.itemId;
            if (matchesRequest || recovered.status !== 200) return recovered;
            return {
                status: 409,
                body: {
                    error: 'A prior combat item action was recovered. Retry this move against the returned session version.',
                    reason: 'stale-version',
                    session: recovered.body.session,
                },
            };
        }
        if (usesActionAuthority && session.pendingItemAction) {
            return completePendingItem(session);
        }
        if (session.expiresAt <= now()) {
            return { status: 410, body: { error: 'Solo-PvE session expired.', session } };
        }
        if (session.recentMoveTokens.includes(command.moveToken)) {
            return { status: 200, body: { applied: false, duplicate: true, reason: 'duplicate-move-token', session } };
        }
        if (session.version !== command.expectedVersion) {
            return { status: 409, body: { error: 'Solo-PvE session version is stale.', reason: 'stale-version', session } };
        }

        let summonClaim: Extract<SoloPveSummonClaim, { ok: true }> | null = null;
        let actionSession = session;
        if (usesActionAuthority && command.action.type === 'summon' && session.pendingCompanion && !session.companion) {
            const claimed = await claimCompanion(session, now(), command.moveToken);
            if (!claimed.ok) return { status: claimed.status, body: { error: claimed.error, session } };
            summonClaim = claimed;
            actionSession = { ...session, pendingCompanion: structuredClone(claimed.companion) };
        }

        const resolved = applySoloPveAction(actionSession, command.action, engineOptions);
        if (!resolved.applied) {
            if (summonClaim) {
                await releaseCompanion({
                    ...session,
                    companionCostAuthority: {
                        version: 1,
                        leaseValue: summonClaim.lease.value,
                        moveToken: command.moveToken,
                        settlementState: 'pending',
                    },
                });
            }
            return { status: 200, body: { applied: false, reason: resolved.reason, event: resolved.event, session } };
        }

        const deltas = itemDeltas(session, resolved.session);
        if (deltas.length > 1) throw new Error('solo-pve-action-spent-multiple-item-types');
        if (usesActionAuthority && deltas.length === 1) {
            if (command.action.type !== 'item' && command.action.type !== 'weapon') {
                throw new Error('solo-pve-item-delta-without-item-action');
            }
            const delta = deltas[0]!;
            const lease = await claimItem(session, command.moveToken);
            if (!lease) return { status: 409, body: { error: 'Another combat item action is still settling.', session } };
            const actionAt = now();
            const pending: SoloPvePendingItemAction = {
                version: 1,
                expectedVersion: session.version,
                moveToken: command.moveToken,
                action: { type: command.action.type, itemId: command.action.itemId },
                itemId: delta.itemId,
                count: delta.count,
                leaseValue: lease.value,
                reservedAt: actionAt,
            };
            const reserved: SoloPveSession = {
                ...session,
                ...(usesActionAuthority ? { usageAuthorityVersion: 1 as const } : {}),
                pendingItemAction: pending,
            };
            if (!(await commit(session, reserved))) {
                if (!(await releaseItem(session, pending))) throw new Error('solo-pve-item-lease-release-failed');
                const latest = await read(command.sessionId) ?? session;
                return latest.recentMoveTokens.includes(command.moveToken)
                    ? { status: 200, body: { applied: false, duplicate: true, reason: 'duplicate-move-token', session: latest } }
                    : { status: 409, body: { error: 'Solo-PvE session version is stale.', reason: 'stale-version', session: latest } };
            }
            return completePendingItem(reserved);
        }

        let next = materializeAction(session, resolved.session, now(), undefined, summonClaim);
        if (!(await commit(session, next))) {
            const latest = await read(command.sessionId) ?? session;
            return latest.recentMoveTokens.includes(command.moveToken)
                ? { status: 200, body: { applied: false, duplicate: true, reason: 'duplicate-move-token', session: latest } }
                : { status: 409, body: { error: 'Solo-PvE session version is stale.', reason: 'stale-version', session: latest } };
        }

        if (summonClaim) {
            const charged = await settleCompanion(next);
            if (!charged.ok) return { status: charged.status, body: { error: charged.error, session: next } };
            const settled: SoloPveSession = {
                ...next,
                companionCostAuthority: {
                    ...next.companionCostAuthority!,
                    settlementState: 'settled',
                    chargedAt: charged.chargedAt,
                },
            };
            if (await commit(next, settled)) {
                next = settled;
            } else {
                const latest = await read(command.sessionId);
                if (!latest
                    || latest.companionCostAuthority?.settlementState !== 'settled'
                    || latest.companionCostAuthority.leaseValue !== settled.companionCostAuthority?.leaseValue
                    || latest.companionCostAuthority.chargedAt !== settled.companionCostAuthority?.chargedAt) {
                    return { status: 409, body: { error: 'The companion charge lost session authority.', session: latest ?? next } };
                }
                next = latest;
            }
            const finalized = await finalizeCompanion(next);
            if (!finalized.ok) return { status: finalized.status, body: { error: finalized.error, session: next } };
            if (!(await releaseCompanion(next))) throw new Error('solo-pve-summon-lease-release-failed');
        }
        return { status: 200, body: { applied: true, event: resolved.event, session: next } };
    }, { failClosed: true, ttlSec: 10 });
}
