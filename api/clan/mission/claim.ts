import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    CLAN_MISSION_TARGETS,
    CLAN_MISSION_REWARDS,
    clanMissionProgressServer,
    addClanXpServer,
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
const CLAIM_TTL = 400 * 24 * 60 * 60; // ~13 months — effectively permanent latch.

function claimedSetKey(slug: string): string { return `clan:missions-claimed:${slug}`; }
function claimLatchKey(slug: string, key: ClanMissionKey): string { return `clan:mission-claimed:${slug}:${key}`; }

async function readClaimed(slug: string): Promise<ClanMissionKey[]> {
    const raw = await kv.get<unknown>(claimedSetKey(slug)).catch(() => null);
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
            return res.status(200).json({ ok: true, claimed: await readClaimed(slug) });
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

            // Single-use latch — reserve before crediting so two racing claims
            // can't both pay out (the outer clan lock already serialises, this is
            // the durable record across calls). NX: null means already taken.
            const placed = await kv.set(claimLatchKey(slug, missionKey), '1', { nx: true, ex: CLAIM_TTL }).catch(() => 'OK' as const);
            if (placed === null) return { ok: false as const, status: 409, error: 'This clan mission was already claimed.' };

            // ── Credit clan XP + treasury ───────────────────────────────────
            const leveled = addClanXpServer(Number(clanRec.xp ?? 0) || 0, Number(clanRec.level ?? 1) || 1, reward.clanXp);
            const prevTreasury = (clanRec.treasury ?? {}) as Record<string, unknown>;
            const nextTreasury: Record<string, unknown> = { ...prevTreasury };
            for (const [cur, amt] of Object.entries(reward.treasury ?? {})) {
                nextTreasury[cur] = (Number(nextTreasury[cur] ?? 0) || 0) + Number(amt);
            }
            await kv.set(clanSaveKey, { ...clanRec, xp: leveled.xp, level: leveled.level, treasury: nextTreasury });

            return { ok: true as const, xp: leveled.xp, level: leveled.level, treasury: nextTreasury };
        }, { failClosed: true });

        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });

        // Maintain the listing set + audit (best-effort, off the claim's lock).
        const claimed = await readClaimed(slug);
        if (!claimed.includes(missionKey)) {
            await kv.set(claimedSetKey(slug), [...claimed, missionKey], { ex: CLAIM_TTL }).catch(() => undefined);
        }
        await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${missionKey}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            missionKey,
            reward,
        }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({
            ok: true,
            missionKey,
            reward,
            xp: outcome.xp,
            level: outcome.level,
            treasury: outcome.treasury,
            claimed: claimed.includes(missionKey) ? claimed : [...claimed, missionKey],
        });
    } catch (err) {
        console.error('[clan/mission/claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
