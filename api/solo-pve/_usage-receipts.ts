import { createHash } from 'node:crypto';
import type { SoloPveSession } from './_session.js';

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stableUsage(entries: Record<string, number>): Array<[string, number]> {
    return Object.entries(entries)
        .map(([id, count]) => [id, Math.max(0, Math.floor(Number(count) || 0))] as [string, number])
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => a.localeCompare(b));
}

export function soloPveCompanionUsageReceiptIdentity(session: SoloPveSession): {
    requestId: string;
    fingerprint: string;
} {
    const authority = session.companionCostAuthority;
    const usage = session.companionUsage;
    return {
        requestId: `pvesummon_${sha256(session.sessionId).slice(0, 32)}`,
        fingerprint: sha256(JSON.stringify({
            version: 1,
            sessionId: session.sessionId,
            ownerSlug: session.ownerSlug.toLowerCase(),
            moveToken: authority?.moveToken ?? '',
            petId: usage?.petId ?? '',
            pveGearId: usage?.pveGearId ?? '',
            consumableId: usage?.consumableId ?? '',
        })),
    };
}

export function soloPveUsesCommonUsageAuthority(session: SoloPveSession): boolean {
    return session.encounter.kind === 'generic-ai'
        || session.encounter.kind === 'mission'
        || session.encounter.kind === 'story-boss'
        || session.encounter.kind === 'academy-spar'
        || session.encounter.kind === 'endless-wave'
        || session.encounter.kind === 'hollow-gate'
        || session.encounter.kind === 'weekly-boss';
}

/** Only server-created post-migration sessions carry this sealed marker. */
export function usesSoloPveUsageAuthorityV1(session: SoloPveSession): boolean {
    return soloPveUsesCommonUsageAuthority(session) && session.usageAuthorityVersion === 1;
}

export function soloPveOutcomeReceiptRequestId(sessionId: string): string {
    return `pveoutcome_${sha256(sessionId).slice(0, 32)}`;
}

export function hasSettledSoloPveCompanionCostAuthority(session: SoloPveSession): boolean {
    const authority = session.companionCostAuthority;
    const legacyLease = `solo-pve-summon:${session.sessionId}`;
    const moveLease = authority?.moveToken
        ? `${legacyLease}:${authority.moveToken}`
        : '';
    return authority?.version === 1
        && authority.settlementState === 'settled'
        && Number.isFinite(authority.chargedAt)
        && Number(authority.chargedAt) > 0
        && (authority.leaseValue === legacyLease || authority.leaseValue === moveLease)
        && /^[A-Za-z0-9_-]{8,96}$/.test(authority.moveToken);
}

export function soloPveItemActionReceiptIdentity(params: {
    session: SoloPveSession;
    moveToken: string;
    itemId: string;
    count: number;
}): { markerId: string; fingerprint: string } {
    const { session, moveToken, itemId } = params;
    const count = Math.max(1, Math.floor(Number(params.count) || 1));
    return {
        markerId: `${session.sessionId}:${moveToken}`,
        fingerprint: sha256(JSON.stringify({
            version: 1,
            sessionId: session.sessionId,
            ownerSlug: session.ownerSlug.toLowerCase(),
            moveToken,
            itemId,
            count,
        })),
    };
}

export function unsettledSoloPveItemUsage(session: SoloPveSession): Record<string, number> | null {
    const required = stableUsage(session.itemsUsed);
    if (required.length === 0) return {};
    const paid = new Map<string, number>();
    const seenMoves = new Set<string>();
    for (const authority of session.itemCostAuthorities ?? []) {
        if (authority?.version !== 1
            || !Number.isFinite(authority.chargedAt)
            || authority.chargedAt <= 0
            || !/^[A-Za-z0-9_-]{8,96}$/.test(authority.moveToken)
            || seenMoves.has(authority.moveToken)
            || authority.leaseValue !== `solo-pve-item:${session.sessionId}:${authority.moveToken}`
            || !authority.itemId
            || !Number.isSafeInteger(authority.count)
            || authority.count <= 0) return null;
        seenMoves.add(authority.moveToken);
        paid.set(authority.itemId, (paid.get(authority.itemId) ?? 0) + authority.count);
    }
    return Object.fromEntries(required
        .map(([itemId, count]) => [itemId, Math.max(0, count - (paid.get(itemId) ?? 0))] as const)
        .filter(([, count]) => count > 0));
}

export function hasSettledSoloPveItemCostAuthority(session: SoloPveSession): boolean {
    const unsettled = unsettledSoloPveItemUsage(session);
    return unsettled !== null && Object.keys(unsettled).length === 0;
}
