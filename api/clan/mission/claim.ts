import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { awardClanPointsToPlayerSave, clanPointWeekKey } from '../../_clan-points.js';
import { commitEconomicReceipt, isEconomicReceiptStorageError, reserveEconomicReceipt } from '../../_economic-receipt.js';
import {
    CLAN_MISSION_TARGETS,
    CLAN_MISSION_REWARDS,
    clanMissionProgressServer,
    addClanXpServer,
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
 * under the clan-save lock. A per-mission single-use latch (NX KV key, NOT on
 * the clan blob so the clan-save validator can't strip it) makes each clan
 * mission claimable exactly once, ever.
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

type ClanMissionTerritory = { ownerClan?: string; guards?: unknown[] };

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
    for (const territory of territories) {
        if (String(territory.ownerClan ?? '') !== clanName || !Array.isArray(territory.guards)) continue;
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
    if (!Array.isArray(raw)) return [];
    return raw.filter(isClanMissionKey);
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
            const weekKey = clanPointWeekKey();
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
        const weekKey = clanPointWeekKey();

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

            const progress = clanMissionProgressServer(clanRec, String(clanRec.name ?? clan), territories, missionKey);
            if (progress < CLAN_MISSION_TARGETS[missionKey]) {
                return { ok: false as const, status: 409, error: 'Clan mission not complete yet.' };
            }

            // Per-week single-use latch — reserve before crediting so two racing
            // claims can't both pay out (the outer clan lock already serialises,
            // this is the durable per-week record across calls). NX: null means
            // already taken THIS week.
            const receiptKey = claimLatchKey(slug, weekKey, missionKey);
            const reservation = await reserveEconomicReceipt(kv, {
                key: receiptKey,
                fingerprint: `clan-mission:${slug}:${weekKey}:${missionKey}`,
                ttlSeconds: CLAIM_TTL,
                metadata: { slug, weekKey, missionKey },
            });
            if (reservation.status === 'conflict') {
                return {
                    ok: false as const,
                    status: 409,
                    error: 'Conflicting clan mission receipt exists.',
                };
            }

            if (reservation.status === 'replay') {
                return {
                    ok: true as const,
                    xp: Number(clanRec.xp ?? 0) || 0,
                    level: Number(clanRec.level ?? 1) || 1,
                    treasury: (clanRec.treasury ?? {}) as Record<string, unknown>,
                    pointAmount: CLAN_MISSION_POINT_AMOUNTS[missionKey] ?? 0,
                    pointMembers: pointEligibleMembers(clanRec, String(clanRec.name ?? clan), territories, missionKey),
                };
            }

            // ── Credit clan XP + treasury ───────────────────────────────────
            // Clan XP is member-scaled (10–15 members = 1.0×; small clans dampened,
            // capped at 1.0×) so a tiny clan can't rush hall tiers.
            const memberCount = Array.isArray(clanRec.members) ? clanRec.members.length : 0;
            const leveled = addClanXpServer(Number(clanRec.xp ?? 0) || 0, Number(clanRec.level ?? 1) || 1, scaledClanXp(reward.clanXp, memberCount));
            const prevTreasury = (clanRec.treasury ?? {}) as Record<string, unknown>;
            const nextTreasury: Record<string, unknown> = { ...prevTreasury };
            for (const [cur, amt] of Object.entries(reward.treasury ?? {})) {
                nextTreasury[cur] = (Number(nextTreasury[cur] ?? 0) || 0) + Number(amt);
            }
            // A remote write can apply and then lose its acknowledgement. Once
            // attempted, leave the durable pending receipt replay-blocking.
            await kv.set(clanSaveKey, { ...clanRec, xp: leveled.xp, level: leveled.level, treasury: nextTreasury });
            // If commit fails after the clan write, leave the owned pending row
            // in place; it still blocks replay. Never roll it back post-mutation.
            await commitEconomicReceipt(kv, receiptKey, reservation, CLAIM_TTL);

            return {
                ok: true as const,
                xp: leveled.xp,
                level: leveled.level,
                treasury: nextTreasury,
                pointAmount: CLAN_MISSION_POINT_AMOUNTS[missionKey] ?? 0,
                pointMembers: pointEligibleMembers(clanRec, String(clanRec.name ?? clan), territories, missionKey),
            };
        }, { failClosed: true });

        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

        // Maintain the per-week listing set + audit (best-effort, off the claim's lock).
        const claimed = await readClaimed(slug, weekKey);
        if (!claimed.includes(missionKey)) {
            await kv.set(claimedSetKey(slug, weekKey), [...claimed, missionKey], { ex: CLAIM_TTL }).catch(() => undefined);
        }
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
            await Promise.allSettled(others.map((member) => awardClanPointsToPlayerSave(member, 'clanMissionContribution', pointAmount, {
                eventId: `mission:${slug}:${weekKey}:${missionKey}:contribution:${member}`,
                clan,
                missionKey,
            })));
            if (pointMembers.includes(actor)) {
                const contribution = await awardClanPointsToPlayerSave(actor, 'clanMissionContribution', pointAmount, {
                    eventId: `mission:${slug}:${weekKey}:${missionKey}:contribution:${actor}`,
                    clan,
                    missionKey,
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
            });
            if (claimAward.found) {
                awardedCharacter = claimAward.character;
                awardedSaveVersion = claimAward._saveVersion;
            }
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
