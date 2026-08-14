import { kv } from '../_storage.js';
import { isDeepStrictEqual } from 'node:util';
import { withKvLock, type LockOptions } from '../_lock.js';
import { compareWriteSoloPveSession, readSoloPveSession, soloPveSessionKey } from './_store.js';
import type { SoloPveSession } from './_session.js';
import { readActiveSoloPveItemActionIntent } from './_item-action-intent.js';
import {
    finalizeSoloPveCompanionUsage,
    releaseSoloPveSummonLeaseValue,
    settleSoloPveCompanionUsage,
    type SoloPveCompanionChargeResult,
    type SoloPveCompanionFinalizeResult,
} from './_pet-battle-authority.js';
import {
    soloPveUsesCommonUsageAuthority,
    unsettledSoloPveItemUsage,
    usesSoloPveUsageAuthorityV1,
} from './_usage-receipts.js';

type SoloPveLock = <T>(target: string, fn: () => Promise<T>, options?: LockOptions) => Promise<T>;

export type SoloPveUsageAuthorityResult =
    | { ok: true; session: SoloPveSession; replayed: boolean; character?: Record<string, unknown>; _saveVersion?: number }
    | { ok: false; status: number; error: string };

type CompanionRecoveryDeps = {
    read?: (sessionId: string) => Promise<SoloPveSession | null>;
    write?: (session: SoloPveSession) => Promise<void>;
    commit?: (expected: SoloPveSession, next: SoloPveSession) => Promise<boolean>;
    lock?: SoloPveLock;
    settleCompanion?: (session: SoloPveSession) => Promise<SoloPveCompanionChargeResult>;
    finalizeCompanion?: (session: SoloPveSession) => Promise<SoloPveCompanionFinalizeResult>;
    releaseCompanion?: (session: SoloPveSession) => Promise<boolean>;
    readItemIntent?: (sessionId: string) => ReturnType<typeof readActiveSoloPveItemActionIntent>;
};

/** Recover the durable session->save companion charge saga before any reward. */
export async function ensureSoloPveCompanionCostSettled(
    supplied: SoloPveSession,
    playerName: string,
    deps: CompanionRecoveryDeps = {},
): Promise<SoloPveUsageAuthorityResult> {
    if (!supplied.companionUsage) return { ok: true, session: supplied, replayed: true };
    if (!usesSoloPveUsageAuthorityV1(supplied)) {
        return { ok: true, session: supplied, replayed: true };
    }
    if (!supplied.companionCostAuthority) {
        return { ok: false, status: 409, error: 'The companion summon has no valid cost authority.' };
    }
    const read = deps.read ?? readSoloPveSession;
    const commit = deps.commit ?? (deps.write
        ? async (_expected: SoloPveSession, next: SoloPveSession): Promise<boolean> => {
            try {
                await deps.write!(next);
                return true;
            } catch (error) {
                const readback = await read(next.sessionId).catch(() => null);
                if (isDeepStrictEqual(readback, next)) return true;
                throw error;
            }
        }
        : (expected: SoloPveSession, next: SoloPveSession) => compareWriteSoloPveSession(expected, next));
    const lock = deps.lock ?? withKvLock;
    const settleCompanion = deps.settleCompanion ?? ((session) => settleSoloPveCompanionUsage(session));
    const finalizeCompanion = deps.finalizeCompanion ?? ((session) => finalizeSoloPveCompanionUsage(session));
    const releaseCompanion = deps.releaseCompanion ?? ((session) => {
        const authority = session.companionCostAuthority;
        return authority
            ? releaseSoloPveSummonLeaseValue(kv, session.ownerSlug, authority.leaseValue)
            : Promise.resolve(false);
    });

    return lock(soloPveSessionKey(supplied.sessionId), async () => {
        let session = await read(supplied.sessionId);
        if (!session || session.ownerSlug.toLowerCase() !== playerName.toLowerCase()) {
            return { ok: false as const, status: 409, error: 'The companion session authority is unavailable.' };
        }
        const authority = session.companionCostAuthority;
        if (!session.companionUsage || !authority) {
            return { ok: false as const, status: 409, error: 'The companion summon has no valid cost authority.' };
        }
        let replayed = true;
        if (authority.settlementState === 'pending') {
            const charged = await settleCompanion(session);
            if (!charged.ok) return charged;
            replayed = charged.replayed;
            const settled: SoloPveSession = {
                ...session,
                companionCostAuthority: {
                    ...authority,
                    settlementState: 'settled',
                    chargedAt: charged.chargedAt,
                },
            };
            try {
                if (!(await commit(session, settled))) {
                    const readback = await read(session.sessionId);
                    if (!readback
                        || readback.companionCostAuthority?.settlementState !== 'settled'
                        || readback.companionCostAuthority.leaseValue !== authority.leaseValue) {
                        return { ok: false as const, status: 409, error: 'The companion settlement lost session authority.' };
                    }
                    session = readback;
                } else {
                    session = settled;
                }
            } catch (writeError) {
                const readback = await read(session.sessionId).catch(() => null);
                if (!readback
                    || readback.companionCostAuthority?.settlementState !== 'settled'
                    || readback.companionCostAuthority.leaseValue !== authority.leaseValue) throw writeError;
                session = readback;
            }
        }
        const finalized = await finalizeCompanion(session);
        if (!finalized.ok) return finalized;
        if (!(await releaseCompanion(session))) throw new Error('solo-pve-summon-lease-release-failed');
        return { ok: true as const, session, replayed };
    }, { failClosed: true, ttlSec: 15 });
}

/**
 * Atomically charge terminal player-item evidence once. Companion costs were
 * already charged at summon; this helper also repairs that saga before paying
 * any terminal reward.
 */
export async function settleSoloPveTerminalUsage(
    supplied: SoloPveSession,
    playerName: string,
    deps: CompanionRecoveryDeps = {},
): Promise<SoloPveUsageAuthorityResult> {
    if (!soloPveUsesCommonUsageAuthority(supplied)) return { ok: true, session: supplied, replayed: true };
    if (supplied.ownerSlug.toLowerCase() !== playerName.toLowerCase()) {
        return { ok: false, status: 403, error: 'That solo-PvE usage belongs to another player.' };
    }
    const activeItemIntent = await (deps.readItemIntent ?? readActiveSoloPveItemActionIntent)(supplied.sessionId);
    if (activeItemIntent === 'invalid') {
        return { ok: false, status: 409, error: 'The combat-item action intent is invalid.' };
    }
    if (activeItemIntent) {
        return { ok: false, status: 409, error: 'A combat-item action must finish recovering before terminal settlement.' };
    }
    const hasItemUsage = Object.values(supplied.itemsUsed).some((count) => Number(count) > 0);
    if (!supplied.companionUsage && !hasItemUsage) return { ok: true, session: supplied, replayed: true };
    if (supplied.status !== 'done' || !supplied.terminalEvidence) {
        return { ok: false, status: 409, error: 'Terminal solo-PvE usage cannot be verified.' };
    }
    // Rolling-deploy compatibility: pre-upgrade sessions have no action-time
    // seal. Their mode-specific atomic terminal receipt still owns the one-time
    // companion/item deduction, so they must neither be rejected nor marked as
    // pre-charged here.
    if (!usesSoloPveUsageAuthorityV1(supplied)) {
        return { ok: true, session: supplied, replayed: true };
    }
    // A marked session may cross an older action worker during a rolling
    // deploy. Missing authority is therefore an exact legacy cost delta, not a
    // reason to strand a terminal fight. Valid action-time receipts are still
    // honored and only the unpaid remainder is left for the mode's atomic
    // terminal payout write.
    let session = supplied;
    let replayed = true;
    if (supplied.companionUsage && supplied.companionCostAuthority) {
        const companion = await ensureSoloPveCompanionCostSettled(supplied, playerName, deps);
        if (!companion.ok) return companion;
        session = companion.session;
        replayed = companion.replayed;
    }
    const unsettledItems = unsettledSoloPveItemUsage(session);
    if (unsettledItems === null) {
        return { ok: false, status: 409, error: 'The terminal combat-item usage authority is invalid.' };
    }
    return { ok: true, session, replayed };
}
