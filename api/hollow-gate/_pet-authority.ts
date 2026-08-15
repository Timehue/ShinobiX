import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import {
    HOLLOW_GATE_COMBAT_TTL_SECONDS,
    HOLLOW_GATE_PET_AUTHORITY_VERSION,
    hollowGateCombatBindingKey,
    hollowGatePetAuthorityMatches,
    parseHollowGatePetResultReceipt,
    type HollowGateCombatBinding,
    type HollowGatePetResultReceipt,
} from './_combat-session.js';

// A child result must remain redeemable for exactly as long as its parent
// combat binding. Cinematic proofs live for 15 minutes and legacy Showdown
// sessions for 45 minutes; this 24-hour envelope outlasts both recovery paths.
export const HOLLOW_GATE_PET_RESULT_TTL_SECONDS = HOLLOW_GATE_COMBAT_TTL_SECONDS;

export function hollowGatePetResultKey(playerName: string, proofId: string): string {
    return `hg-pet-result:${playerName}:${proofId}`;
}

/** Retire only the short-lived cinematic lease. The durable HG result is the
 * lost-response authority and must survive child and parent cleanup. Deleting
 * the exact token before CAS-clearing its pointer makes a mid-cleanup crash
 * recoverable through the token-missing receipt replay path. */
export async function retireHollowGatePetChildLease(playerName: string, proofId: string): Promise<void> {
    await kv.del(`pet:battle-token:${playerName}:${proofId}`);
    await kv.delIfEqual(`pet:battle-active:${playerName}`, proofId);
}

export type HollowGatePetAuthorityClaim =
    | { ok: true; binding: HollowGateCombatBinding; resumed: boolean }
    | { ok: false; reason: 'invalid-proof' | 'encounter-unavailable' | 'different-child-authority' };

/**
 * Atomically retain one already-issued CINEMATIC proof for a pre-cutover Pet
 * encounter. New bindings already carry their cinematic proof, so this is
 * normally an idempotent read. There is intentionally no generic/Showdown
 * claim API: an unbound legacy parent cannot safely choose among old sibling
 * sessions after their outcomes are known.
 */
export async function claimHollowGateCinematicAuthority(params: {
    runId: string;
    playerName: string;
    proofId: string;
}): Promise<HollowGatePetAuthorityClaim> {
    if (!/^[A-Za-z0-9]{8,96}$/.test(params.proofId)) return { ok: false, reason: 'invalid-proof' };
    const bindingKey = hollowGateCombatBindingKey(params.runId);
    return withKvLock(bindingKey, async () => {
        const binding = await kv.get<HollowGateCombatBinding>(bindingKey);
        if (!binding
            || binding.runId !== params.runId
            || binding.playerName !== params.playerName
            || binding.combatMode !== 'pet'
            || binding.status !== 'active'
            || binding.settledAt) {
            return { ok: false, reason: 'encounter-unavailable' } as const;
        }
        if (binding.petAuthority) {
            return hollowGatePetAuthorityMatches(binding, 'cinematic', params.proofId)
                ? { ok: true, binding, resumed: true } as const
                : { ok: false, reason: 'different-child-authority' } as const;
        }
        const next: HollowGateCombatBinding = {
            ...binding,
            petAuthority: {
                version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
                engine: 'cinematic',
                proofId: params.proofId,
                claimedAt: Date.now(),
            },
        };
        await kv.set(bindingKey, next, { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
        return { ok: true, binding: next, resumed: false } as const;
    }, { failClosed: true });
}

/**
 * Last gate before battle-start may expose an HG child proof. Claiming the
 * parent and publishing its child lease are separated by combat construction;
 * emergency abandonment can happen in between. Rechecking under the same
 * binding lock used by abandonment prevents a revoked parent from being
 * resurrected by a late token/pointer publication.
 */
export async function validateHollowGateCinematicPublication(params: {
    runId: string;
    playerName: string;
    proofId: string;
}): Promise<boolean> {
    const bindingKey = hollowGateCombatBindingKey(params.runId);
    return withKvLock(bindingKey, async () => {
        const [binding, seal] = await Promise.all([
            kv.get<HollowGateCombatBinding>(bindingKey),
            kv.get<{ playerName?: string; hollowGate?: { runId?: string } }>(
                `pet:battle-token:${params.playerName}:${params.proofId}`,
            ),
        ]);
        const valid = hollowGatePetAuthorityMatches(binding, 'cinematic', params.proofId)
            && binding?.playerName === params.playerName
            && binding.status === 'active'
            && !binding.settledAt
            && seal?.playerName?.toLowerCase() === params.playerName.toLowerCase()
            && seal.hollowGate?.runId === params.runId;
        if (!valid) {
            await retireHollowGatePetChildLease(params.playerName, params.proofId);
        }
        return valid;
    }, { failClosed: true });
}

function sameReceiptFacts(a: HollowGatePetResultReceipt, b: HollowGatePetResultReceipt): boolean {
    return a.version === b.version
        && a.engine === b.engine
        && a.proofId === b.proofId
        && a.playerName === b.playerName
        && a.runId === b.runId
        && a.outcome === b.outcome
        && JSON.stringify(a.playerPetIds) === JSON.stringify(b.playerPetIds);
}

/** Commit, then re-read, an exact child result. No response may expose a proof
 * until the durable receipt agrees with the parent-selected engine and id. */
export async function writeHollowGatePetResult(receipt: HollowGatePetResultReceipt): Promise<boolean> {
    const bindingKey = hollowGateCombatBindingKey(receipt.runId);
    return withKvLock(bindingKey, async () => {
        const binding = await kv.get<HollowGateCombatBinding>(bindingKey);
        if (!hollowGatePetAuthorityMatches(binding, receipt.engine, receipt.proofId)
            || binding?.playerName !== receipt.playerName
            || binding.status !== 'active'
            || binding.settledAt) {
            return false;
        }
        const key = hollowGatePetResultKey(receipt.playerName, receipt.proofId);
        const existingRaw = await kv.get<unknown>(key);
        const existing = parseHollowGatePetResultReceipt(existingRaw);
        if (existing) return sameReceiptFacts(existing, receipt);

        // A retained pre-cutover result may have the same immutable outcome
        // facts but no engine/proof version. It is upgradable only after the
        // parent has already selected this exact engine + proof. Unbound legacy
        // Showdown parents never reach this helper, so the caller cannot select
        // a terminal sibling by outcome. Any disagreement fails closed.
        if (existingRaw && typeof existingRaw === 'object') {
            const legacy = existingRaw as Record<string, unknown>;
            const legacyPetIds = Array.isArray(legacy.playerPetIds)
                ? legacy.playerPetIds.filter((id): id is string => typeof id === 'string')
                : [];
            if (legacy.playerName !== receipt.playerName
                || legacy.runId !== receipt.runId
                || legacy.outcome !== receipt.outcome
                || JSON.stringify(legacyPetIds) !== JSON.stringify(receipt.playerPetIds)) {
                return false;
            }
            await kv.set(key, receipt, { ex: HOLLOW_GATE_PET_RESULT_TTL_SECONDS });
        } else {
            await kv.set(key, receipt, { nx: true, ex: HOLLOW_GATE_PET_RESULT_TTL_SECONDS });
        }
        const durable = parseHollowGatePetResultReceipt(await kv.get(key));
        return Boolean(durable && sameReceiptFacts(durable, receipt));
    }, { failClosed: true });
}
