import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { awardClanPointsToPlayerSave, clanPointWeekKey } from '../../_clan-points.js';
import { isEconomicReceiptStorageError } from '../../_economic-receipt.js';
import { settleMissionCredit, finishMissionReceipt, missionProofs } from './_settlement.js';
import { territoryRewardsSuspended } from '../../_territory-lifecycle.js';
import {
    CLAN_MISSION_TARGETS,
    CLAN_MISSION_REWARDS,
    clanMissionProgressServer,

    scaledClanXp,
    isClanMissionKey,
    type ClanMissionKey,
} from '../_mission-catalog.js';

/*
 * /api/clan/mission/claim
 *
 *   GET  ?clan=<name>            → { claimed: ClanMissionKey[] }  (open, like clan reads)
 *   POST { playerName, clan, missionKey } → claim a completed clan mission once
 *
 * Server-authoritative: the client never sends progress or reward amounts. The
 * server recomputes the mission's progress from the trusted clan record
 * (member contributions, treasury) + the canonical world:territory:* sectors,
 * verifies it meets the target, then credits the SHARED clan treasury + clan XP
 * under the clan-save lock. A weekly server reservation seals the grant;
 * shared credit and its protected proof share a CAS write, so interrupted
 * claims can resume personal credit without applying the shared grant twice.
 *
 * Gated at clan MEMBERSHIP (same model as treasury/donate + territory/collect-
 * supply): the reward lands in the shared pool, not personal inventory, so a
 * non-leader who crafts the request can only help their own clan. The UI shows
 * the Claim button to leadership only.
 */

const TERRITORY_KEY_PREFIX = 'world:territory:';
const AUDIT_LOG_PREFIX = 'audit:clan-mission-claim:';
// Weekly-repeatable: the claim latch + listing set are keyed by ISO week, so a
// clan can claim each mission once PER WEEK (a steady, member-scaled clan-XP
// faucet toward hall growth). The ~10-day TTL lets a finished week's keys
// auto-expire — next week uses a fresh key, so the mission is claimable again.
const CLAIM_TTL = 10 * 24 * 60 * 60;

function claimedSetKey(slug: string, weekKey: string): string { return `clan:missions-claimed:${slug}:${weekKey}`; }
function claimLatchKey(slug: string, weekKey: string, key: ClanMissionKey): string { return `clan:mission-claimed:${slug}:${weekKey}:${key}`; }

type ClanMissionMember = {
    name?: string;
    battleContrib?: number;
    missionContrib?: number;
    eventContrib?: number;
    level?: number;
};

type ClanMissionTerritory = Record<string, unknown> & { ownerClan?: string; guards?: unknown[] };

const CLAN_MISSION_POINT_AMOUNTS: Partial<Record<ClanMissionKey, number>> = {
    battle: 40,
    mission: 50,
    guard: 35,
    anbu: 40,
    raid: 75,
};

function pointEligibleMembers(
    clanRec: Record<string, unknown>,
    clanName: string,
    territories: ClanMissionTerritory[],
    missionKey: ClanMissionKey,
): string[] {
    const amount = CLAN_MISSION_POINT_AMOUNTS[missionKey];
    if (!amount) return [];
    const members = Array.isArray(clanRec.members) ? clanRec.members as ClanMissionMember[] : [];
    const guardNames = new Set<string>();
    const now = Date.now();
    for (const territory of territories) {
        if (String(territory.ownerClan ?? '') !== clanName
            || territoryRewardsSuspended(territory, now)
            || !Array.isArray(territory.guards)) continue;
        for (const guard of territory.guards) {
            const name = typeof guard === 'string'
                ? guard
                : String((guard as Record<string, unknown> | null)?.name ?? '');
            const slug = safeName(name);
            if (slug) guardNames.add(slug);
        }
    }

    const names: string[] = [];
    for (const member of members) {
        const name = safeName(String(member.name ?? ''));
        if (!name) continue;
        const battle = Number(member.battleContrib ?? 0) || 0;
        const mission = Number(member.missionContrib ?? 0) || 0;
        const event = Number(member.eventContrib ?? 0) || 0;
        const level = Number(member.level ?? 0) || 0;
        const eligible =
            (missionKey === 'battle' && battle > 0)
            || (missionKey === 'mission' && mission > 0)
            || (missionKey === 'guard' && (level >= 5 || guardNames.has(name)))
            || (missionKey === 'anbu' && (battle > 0 || event > 0 || guardNames.has(name)))
            || (missionKey === 'raid' && event > 0);
        if (eligible && !names.includes(name)) names.push(name);
        if (names.length >= 50) break;
    }
    return names;
}

async function readClaimed(slug: string, weekKey: string): Promise<ClanMissionKey[]> {
    const raw = await kv.get<unknown>(claimedSetKey(slug, weekKey)).catch(() => null);
    const claimed = Array.isArray(raw) ? raw.filter(isClanMissionKey) : [];
    // The listing is a projection. Repair a missed listing write from positive
    // shared credit plus the final receipt, never from a pending intent alone.
    const clan = await kv.get<Record<string, unknown>>(clanRecordKey(slug));
    for (const proof of clan ? missionProofs(clan) : []) {
        if (proof.weekKey !== weekKey || !isClanMissionKey(proof.missionKey) || claimed.includes(proof.missionKey)) continue;
        const receipt = await kv.get<{state?: string; fingerprint?: string; ownerId?: string; metadata?: {protocol?: number}}>(proof.key);
        if (receipt?.state === 'committed' && receipt.metadata?.protocol === 2
            && receipt.fingerprint === proof.fingerprint && proof.ownerId && receipt.ownerId === proof.ownerId) claimed.push(proof.missionKey);
    }
    return claimed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ── GET — list this clan's already-claimed missions (open read) ──────
        if (req.method === 'GET') {
            const clan = typeof req.query.clan === 'string' ? req.query.clan.trim() : '';
            const slug = clanBareSlug(clan);
            if (!slug) return res.status(400).json({ error: 'Missing clan.' });
            const weekKey = clanPointWeekKey(new Date(Date.now()));
            return res.status(200).json({ ok: true, weekKey, claimed: await readClaimed(slug, weekKey) });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const missionKey = String(body.missionKey ?? '');
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });
        if (!isClanMissionKey(missionKey)) return res.status(400).json({ error: 'Invalid mission.' });
        const reward = CLAN_MISSION_REWARDS[missionKey];
        if (!reward) return res.status(400).json({ error: 'This mission has no claimable reward.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-mission-claim', 20, 60_000, identity.name))) return;

        const slug = clanBareSlug(clan);
        if (!slug) return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = clanRecordKey(clan);
        const weekKey = clanPointWeekKey(new Date(Date.now()));

        // Membership check (admin exempt) — the caller must belong to this clan.
        if (!identity.admin) {
            const donorRec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null) as Record<string, unknown> | null;
            if (!donorChar) return res.status(404).json({ error: 'Your save was not found.' });
            if (clanBareSlug(String(donorChar.clan ?? '')) !== slug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
        }

        // Load the canonical territory sectors up front (read-only; progress for
        // guard/territory/anbu depends on them). Stale-by-a-moment is fine.
        const territoryKeys = await kv.keys(`${TERRITORY_KEY_PREFIX}*`).catch(() => [] as string[]);
        const territories = territoryKeys.length
            ? ((await kv.mget<Record<string, unknown>[]>(...territoryKeys)).filter(Boolean) as Record<string, unknown>[])
            : [];

        const outcome = await withKvLock(clanSaveKey, async () => {
            const clanRec = await kv.get<Record<string, unknown>>(clanSaveKey);
            if (!clanRec) return { ok: false as const, status: 404, error: 'Clan not found.' };

            return settleMissionCredit(clanRec, {
                clanKey: clanSaveKey, key: claimLatchKey(slug, weekKey, missionKey),
                fingerprint: `clan-mission:${slug}:${weekKey}:${missionKey}`,
                weekKey, missionKey, ttlSeconds: CLAIM_TTL,
                prepare: () => {
                    const progress = clanMissionProgressServer(clanRec, String(clanRec.name ?? clan), territories, missionKey);
                    if (progress < CLAN_MISSION_TARGETS[missionKey]) return null;
                    const members = Array.isArray(clanRec.members) ? clanRec.members.length : 0;
                    return {clanXp: scaledClanXp(reward.clanXp, members), treasury: reward.treasury ?? {},
                        pointAmount: CLAN_MISSION_POINT_AMOUNTS[missionKey] ?? 0,
                        pointMembers: pointEligibleMembers(clanRec, String(clanRec.name ?? clan), territories, missionKey)};
                },
            });
        }, { failClosed: true });

        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

        // Maintain the per-week listing set + audit (best-effort, off the claim's lock).
        const claimed = await readClaimed(slug, weekKey);
        await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${weekKey}:${missionKey}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            weekKey,
            missionKey,
            reward,
        }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);

        let awardedCharacter: Record<string, unknown> | undefined;
        let awardedSaveVersion: number | undefined;
        const pointAmount = Number(outcome.pointAmount ?? 0) || 0;
        const pointMembers = Array.isArray(outcome.pointMembers) ? outcome.pointMembers : [];
        if (pointAmount > 0 && pointMembers.length > 0) {
            const actor = playerName;
            const others = pointMembers.filter((name) => name !== actor);
            await Promise.all(others.map((member) => awardClanPointsToPlayerSave(member, 'clanMissionContribution', pointAmount, {
                eventId: `mission:${slug}:${weekKey}:${missionKey}:contribution:${member}`,
                clan,
                missionKey,
                missionReceiptVersion: outcome.newProtocol ? 1 : undefined,
            })));
            if (pointMembers.includes(actor)) {
                const contribution = await awardClanPointsToPlayerSave(actor, 'clanMissionContribution', pointAmount, {
                    eventId: `mission:${slug}:${weekKey}:${missionKey}:contribution:${actor}`,
                    clan,
                    missionKey,
                    missionReceiptVersion: outcome.newProtocol ? 1 : undefined,
                });
                if (contribution.found) {
                    awardedCharacter = contribution.character;
                    awardedSaveVersion = contribution._saveVersion;
                }
            }
        }
        if (pointAmount > 0) {
            const claimAward = await awardClanPointsToPlayerSave(playerName, 'clanMissionClaim', 25, {
                eventId: `mission:${slug}:${weekKey}:${missionKey}:claim:${playerName}`,
                clan,
                missionKey,
                missionReceiptVersion: outcome.newProtocol ? 1 : undefined,
            });
            if (claimAward.found) {
                awardedCharacter = claimAward.character;
                awardedSaveVersion = claimAward._saveVersion;
            }
        }

        if (outcome.newProtocol) await finishMissionReceipt(claimLatchKey(slug, weekKey, missionKey), `clan-mission:${slug}:${weekKey}:${missionKey}`, CLAIM_TTL);
        if (!claimed.includes(missionKey)) {
            await kv.set(claimedSetKey(slug, weekKey), [...claimed, missionKey], { ex: CLAIM_TTL }).catch(() => undefined);
        }
        return res.status(200).json({
            ok: true,
            missionKey,
            reward,
            xp: outcome.xp,
            level: outcome.level,
            treasury: outcome.treasury,
            character: awardedCharacter,
            ...(awardedSaveVersion !== undefined ? { _saveVersion: awardedSaveVersion } : {}),
            claimed: claimed.includes(missionKey) ? claimed : [...claimed, missionKey],
        });
    } catch (err) {
        console.error('[clan/mission/claim]', safeLogValue(err));
        if (isEconomicReceiptStorageError(err)) {
            return res.status(503).json({ error: 'Could not reserve the clan mission reward. Please retry.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
