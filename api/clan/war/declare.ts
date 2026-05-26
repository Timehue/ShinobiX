import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    CLAN_WAR_HP_MAX,
    clanInActiveWar,
    clanWarCooldownKey,
    clanWarKey,
    clanWarPairId,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    loadClanContext,
    canActAsClanLeadership,
    type ClanWar,
} from './_storage.js';

// POST /api/clan/war/declare
// Body: { toClan: string }
//
// Gates:
//   • Authed player must be Founder / Leader / Officer of their clan
//   • Their clan must not be in an active war
//   • Target clan must exist, must not be in an active war
//   • Target clan cannot be the same as actor's clan
//   • Pair-cooldown: same two clans cannot re-war within 7 days of
//     the previous war ending
//
// Server-managed: war record + HP (500/500), war crate ID, declaredBy.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-war-declare', 4, 60 * 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const toClan = String(body?.toClan ?? '').trim();
        if (!toClan) return res.status(400).json({ error: 'Missing toClan.' });

        // Pull actor's clan context. Admin may declare on behalf of any
        // clan via the `fromClan` body field (testing); regular players
        // must use their own clan.
        const ctx = await loadClanContext(identity.admin ? String(body?.fromClan ?? '') : identity.name);
        const fromClan = identity.admin ? (String(body?.fromClan ?? '') || ctx.clan) : ctx.clan;
        if (!fromClan) return res.status(400).json({ error: 'You must be in a clan to declare war.' });
        if (fromClan === toClan) return res.status(400).json({ error: 'Cannot declare war on your own clan.' });

        if (!identity.admin && !canActAsClanLeadership(ctx.role)) {
            return res.status(403).json({ error: 'Only Clan Founder, Leader, or Officer can declare war.' });
        }

        // Resolve the target clan record + its village. This also acts
        // as the "does the clan exist?" check.
        const toClanSlug = `clan-${toClan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const toClanRecord = await kv.get<{ village?: string; members?: unknown[] }>(`save:${toClanSlug}`);
        if (!toClanRecord) return res.status(404).json({ error: 'Target clan not found.' });
        const toVillage = String(toClanRecord.village ?? '');

        // Cooldown check.
        const cd = await kv.get(clanWarCooldownKey(fromClan, toClan));
        if (cd) return res.status(409).json({ error: 'These two clans were at war within the last 7 days.' });

        // Single-war-per-clan rule (each clan).
        if (await clanInActiveWar(fromClan)) return res.status(409).json({ error: `${fromClan} is already in a clan war.` });
        if (await clanInActiveWar(toClan)) return res.status(409).json({ error: `${toClan} is already in a clan war.` });

        const sortedClans: [string, string] = [fromClan, toClan].sort((a, b) => a.localeCompare(b)) as [string, string];
        const id = clanWarPairId(fromClan, toClan);
        const key = clanWarKey(fromClan, toClan);

        const result = await withKvLock(key, async () => {
            // Re-check under the lock to avoid two simultaneous declares
            // for the same pair both succeeding.
            const existing = await kv.get<ClanWar>(key);
            if (existing && !existing.endedAt) {
                return { status: 409 as const, body: { error: 'War already exists for this clan pair.', war: existing } };
            }
            const now = Date.now();
            const war: ClanWar = {
                id,
                clans: sortedClans,
                villages: {
                    [fromClan]: ctx.village,
                    [toClan]: toVillage,
                },
                hp: {
                    [fromClan]: CLAN_WAR_HP_MAX,
                    [toClan]: CLAN_WAR_HP_MAX,
                },
                startedAt: now,
                updatedAt: now,
                declaredBy: identity.admin ? 'admin' : (ctx.name || identity.name),
                pendingChallenges: [],
                completedChallenges: [],
                warCrateId: `clan-war-crate-${id}`,
            };
            await kv.set(key, war);
            return { status: 200 as const, body: { war } };
        });
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[clan/war/declare]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
