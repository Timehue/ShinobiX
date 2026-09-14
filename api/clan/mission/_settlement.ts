import {kv} from '../../_storage.js';
import {commitEconomicReceipt, EconomicReceiptStorageError, reserveEconomicReceipt, type EconomicReceiptRecord} from '../../_economic-receipt.js';
import {addClanXpServer} from '../_mission-catalog.js';

export type MissionGrant = {clanXp: number; treasury: Record<string, number>; pointAmount: number; pointMembers: string[]};
type MissionProof = MissionGrant & {key: string; fingerprint: string; ownerId: string; weekKey: string; missionKey: string; createdAt: number};
export const MISSION_PROOFS_FIELD = 'clanMissionSettlements';
const RETAIN_MS = 21 * 86_400_000;

function grantFrom(raw: unknown): MissionGrant {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid sealed clan mission grant.');
    const grant = raw as MissionGrant;
    if (!Number.isSafeInteger(grant.clanXp) || grant.clanXp < 0
        || !Number.isSafeInteger(grant.pointAmount) || grant.pointAmount < 0
        || !grant.treasury || typeof grant.treasury !== 'object' || Array.isArray(grant.treasury)
        || Object.values(grant.treasury).some(n => !Number.isSafeInteger(n) || n < 0)
        || !Array.isArray(grant.pointMembers) || grant.pointMembers.some(n => typeof n !== 'string' || !n)) {
        throw new Error('Invalid sealed clan mission grant.');
    }
    return grant;
}
export function missionProofs(record: Record<string, unknown>): MissionProof[] {
    const raw = record[MISSION_PROOFS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('Invalid clan mission settlement evidence.');
    return raw.map(value => {
        const proof = value as MissionProof;
        grantFrom(proof);
        if (!proof.key || !proof.fingerprint || !proof.weekKey || !proof.missionKey || !Number.isFinite(proof.createdAt)) throw new Error('Invalid clan mission settlement identity.');
        return proof;
    });
}

/** Called under the existing clan lock. CAS also fences a worker whose lease expired. */
export async function settleMissionCredit(
    clan: Record<string, unknown>,
    opts: {clanKey: string; key: string; fingerprint: string; weekKey: string; missionKey: string; ttlSeconds: number; prepare: () => MissionGrant | null},
) {
    const result = (record: Record<string, unknown>, grant: MissionGrant, newProtocol: boolean) => ({
        ok: true as const, xp: Number(record.xp ?? 0) || 0, level: Number(record.level ?? 1) || 1,
        treasury: (record.treasury ?? {}) as Record<string, unknown>,
        pointAmount: grant.pointAmount, pointMembers: grant.pointMembers, newProtocol,
    });
    const proofs = missionProofs(clan);
    const applied = proofs.find(proof => proof.key === opts.key);
    const previous = await kv.get<EconomicReceiptRecord>(opts.key);
    if (applied) {
        // Old generic saves could contain unknown fields. A public fingerprint
        // alone cannot establish that this proof was written by this protocol.
        if (applied.fingerprint !== opts.fingerprint || !applied.ownerId
            || previous?.metadata?.protocol !== 2 || previous.fingerprint !== opts.fingerprint
            || previous.ownerId !== applied.ownerId || !['pending', 'committed'].includes(previous.state)) {
            throw new Error('Conflicting clan mission evidence.');
        }
        return result(clan, grantFrom(JSON.parse(String(previous.metadata.grant ?? ''))), true);
    }
    const recoverable = previous?.metadata?.protocol === 2 && previous.state === 'pending';
    // A legacy pending row proves only intent. Never turn its ambiguity into payment.
    if (previous?.state === 'pending' && !recoverable) throw new EconomicReceiptStorageError(opts.key, 'pending');
    if (previous?.metadata?.protocol === 2 && previous.state !== 'pending') throw new Error('Committed mission is missing its shared credit evidence.');
    let grant = recoverable
        ? grantFrom(JSON.parse(String(previous.metadata?.grant ?? '')))
        : opts.prepare();
    if (!grant) return {ok: false as const, status: 409, error: 'Clan mission not complete yet.'};
    const reservation = await reserveEconomicReceipt(kv, {
        key: opts.key, fingerprint: opts.fingerprint, ttlSeconds: opts.ttlSeconds,
        metadata: {protocol: 2, weekKey: opts.weekKey, missionKey: opts.missionKey, grant: JSON.stringify(grant)},
    });
    if (reservation.status === 'conflict') return {ok: false as const, status: 409, error: 'Conflicting clan mission receipt exists.'};
    if (reservation.status === 'replay' && reservation.receipt?.metadata?.protocol !== 2) return result(clan, grant, false);
    const receipt = reservation.receipt;
    if (!receipt?.ownerId || receipt.state !== 'pending') throw new Error('Mission is missing its shared credit evidence.');
    grant = grantFrom(JSON.parse(String(receipt.metadata?.grant ?? '')));
    const proof: MissionProof = {...grant, key: opts.key, fingerprint: opts.fingerprint, ownerId: receipt.ownerId, weekKey: opts.weekKey, missionKey: opts.missionKey, createdAt: Date.now()};
    const leveled = addClanXpServer(Number(clan.xp ?? 0) || 0, Number(clan.level ?? 1) || 1, grant.clanXp);
    const treasury = {...((clan.treasury ?? {}) as Record<string, unknown>)};
    for (const [currency, amount] of Object.entries(grant.treasury)) treasury[currency] = (Number(treasury[currency] ?? 0) || 0) + amount;
    const next = {...clan, xp: leveled.xp, level: leveled.level, treasury,
        [MISSION_PROOFS_FIELD]: [proof, ...proofs.filter(old => old.createdAt >= Date.now() - RETAIN_MS)]};
    try {
        if (await kv.compareSet(opts.clanKey, clan, next) !== true) throw new Error('Clan mission save conflict.');
        return result(next, grant, true);
    } catch (error) {
        // The write may have committed without an acknowledgement. Only positive,
        // co-written evidence can turn that into success.
        const saved = await kv.get<Record<string, unknown>>(opts.clanKey).catch(() => null);
        const found = saved && missionProofs(saved).find(item => item.key === opts.key && item.fingerprint === opts.fingerprint && item.ownerId === receipt.ownerId);
        if (saved && found) return result(saved, grant, true);
        throw error;
    }
}

/** Complete only after the shared grant and all eligible point writes succeeded. */
export async function finishMissionReceipt(key: string, fingerprint: string, ttlSeconds: number) {
    const receipt = await kv.get<EconomicReceiptRecord>(key);
    if (!receipt || receipt.fingerprint !== fingerprint || receipt.metadata?.protocol !== 2) throw new Error('Clan mission reservation is missing.');
    if (receipt.state === 'committed') return;
    if (receipt.state !== 'pending') throw new Error('Clan mission reservation is not pending.');
    await commitEconomicReceipt(kv, key, {status: 'reserved', receipt}, ttlSeconds);
}
