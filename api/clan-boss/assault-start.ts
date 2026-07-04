import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { getFloor } from '../towers/_floor-catalog.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import { makeRng } from '../towers/_sim.js';
import { writeSession, setTowerInvite } from '../towers/_tower-store.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { saveAssault } from './_assault.js';
import {
    CB_ASSAULT_HP_CAP, CB_MAX_PARTY, CLAN_BOSS_BY_ID, clanBossAttemptsLeft, clanBossPickId,
    clanBossProgressKey, clanBossWeekId, clanSlug, loadClanBossProgress, loadClanBossWeek,
    newClanBossProgress, reserveAttempt, saveClanBossProgress,
} from './_storage.js';

/*
 * POST /api/clan-boss/assault-start — begin a co-op assault on THIS week's clan boss.
 *
 * Reserves one of the host's weekly attempts, then mints a Battle-Towers session on
 * the week's clan-boss floor (host + up to 2 clanmate allies). The fight then runs
 * through the EXISTING /api/towers/action loop + battle screen; api/clan-boss/
 * assault-settle banks the server-computed damage into the clan's pool. Gated off by
 * default — 404 unless ENABLE_CLAN_BOSS==='1'. Body: { hostName, allies?: string[] }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = safeName(String(body.hostName ?? ''));
        if (!hostName) return res.status(400).json({ error: 'Invalid host name.' });
        if (!enforceRateLimit(req, res, 'clan-boss-assault-start', 10, 60_000, hostName)) return;

        const identity = await authedPlayerOrAdmin(req, hostName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName) return res.status(403).json({ error: 'Can only start your own assault.' });

        const hostRec = await kv.get<Record<string, unknown>>(`save:${hostName}`);
        const hostChar = hostRec?.character as Record<string, unknown> | undefined;
        if (!hostChar) return res.status(400).json({ error: 'Your save was not found.' });
        const clanName = typeof hostChar.clan === 'string' ? hostChar.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to raid the clan boss.' });

        const now = Date.now();
        const weekId = clanBossWeekId(now);
        const week = await loadClanBossWeek(weekId);
        if (!week || week.endsAt <= now) return res.status(400).json({ error: 'No clan boss is active right now.' });

        const boss = CLAN_BOSS_BY_ID[clanBossPickId(weekId)];
        const floor = boss ? getFloor(boss.floorId) : undefined;
        if (!boss || !floor) return res.status(500).json({ error: 'Clan boss floor missing.' });

        // Clan record → roster (member count for the pool; ally membership check).
        const clanRec = await kv.get<{ members?: Array<{ name?: unknown }> }>(`save:clan-${clanSlug(clanName)}`);
        const members = Array.isArray(clanRec?.members) ? clanRec!.members! : [];
        const memberCount = members.length || 1;
        const memberSet = new Set(members.map(m => safeName(String(m?.name ?? ''))).filter(Boolean));

        // Party = host + clanmate allies (de-duped, capped). Non-clanmates are dropped.
        const allyNames: string[] = Array.isArray(body.allies) ? body.allies.map((a: unknown) => safeName(String(a))).filter(Boolean) : [];
        const clanmateAllies = allyNames.filter(a => a !== hostName && (memberSet.size === 0 || memberSet.has(a)));
        const memberSlugs = [...new Set([hostName, ...clanmateAllies])].slice(0, CB_MAX_PARTY);

        // Seal every party member from their authoritative save (host also supplies the
        // client-computed pvpItems/passives). All are LIVE humans; absent ones AFK-pass.
        const hostLoadout = (body.hostLoadout && typeof body.hostLoadout === 'object') ? body.hostLoadout as Record<string, unknown> : {};
        const squad: SquadMemberInput[] = [];
        for (let i = 0; i < memberSlugs.length; i++) {
            const slug = memberSlugs[i]!;
            const rec = slug === hostName ? hostRec : await kv.get<Record<string, unknown>>(`save:${slug}`);
            const char = rec?.character as Record<string, unknown> | undefined;
            if (!char) { if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' }); continue; }
            squad.push({
                // Contiguous ids even when an ally save is skipped above.
                id: `sq-${squad.length}`, name: String(char.name ?? slug), ownerSlug: slug, ai: false,
                character: sealTowerFighter(char, rec!, slug === hostName ? hostLoadout : {}),
                itemCharges: sealTowerItemCharges(char),
            });
        }
        if (squad.length === 0) return res.status(400).json({ error: 'No valid party members.' });
        const partySlugs = squad.map(s => s.ownerSlug);

        // Reserve the host's attempt (+ credit breadth) atomically under the progress
        // lock. Re-check attempts + not-already-killed inside the lock.
        const progressKey = clanBossProgressKey(weekId, clanName);
        const reserved = await withKvLock(progressKey, async () => {
            const progress = (await loadClanBossProgress(weekId, clanName)) ?? newClanBossProgress(clanName, week, memberCount);
            if (progress.killedAt || progress.pool <= 0) return { ok: false as const, error: 'Your clan already defeated this week\'s boss.' };
            if (clanBossAttemptsLeft(progress, hostName) <= 0) return { ok: false as const, error: 'You\'ve used all your assaults this week.' };
            const next = reserveAttempt(progress, hostName, partySlugs, now);
            await saveClanBossProgress(next);
            return { ok: true as const, pool: next.pool };
        }, { failClosed: true });
        if (!reserved.ok) return res.status(400).json({ error: reserved.error });

        // Mint the tower session on the clan-boss floor.
        const runId = `cboss-${randomUUID().replace(/-/g, '')}`;
        const seed = randomInt(1, 0x7fffffff);
        const session = buildTowerEncounter({ floor, squad, runId, seed, partySize: squad.length, now });
        // Override the boss's HP to the SHARED pool (capped per assault) so it's the
        // persistent clan boss being chipped — not a fresh chunk. buildTowerEncounter
        // already party-scaled the boss's damage; we only replace its HP. The final
        // assault (small remainder) becomes the killable finisher.
        const bossHp = Math.max(1, Math.min(reserved.pool, CB_ASSAULT_HP_CAP));
        const bossActor = session.actors.find(a => a.id === session.phaseState.bossId);
        if (bossActor) { bossActor.hp = bossHp; bossActor.maxHp = bossHp; }
        startRound(session);
        runAiUntilHuman(session, floor, makeRng(seed));
        stampTurnClock(session, now);
        await writeSession(session);
        // Invite EVERY party member — incl. the host — so anyone (incl. the host after
        // an accidental exit) can rediscover + rejoin an unfinished assault via
        // fetchMyRun, rather than losing the reserved attempt. Clan-boss runs use the
        // `cboss-` runId prefix, which the Battle Towers lobby filters out so they only
        // surface in the Clan Boss tab.
        for (const slug of memberSlugs) await setTowerInvite(slug, runId).catch(() => undefined);

        // Tag the run as a clan-boss assault so settle knows where to bank it.
        await saveAssault({ runId, weekId, clanName, host: hostName, party: partySlugs, bossId: boss.id, createdAt: now });

        return res.status(200).json({ runId, session, boss: { id: boss.id, name: boss.name, icon: boss.icon } });
    } catch (err) {
        console.error('[clan-boss/assault-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
