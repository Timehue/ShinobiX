import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { normalizeVillageWarRecord, villageWarKey } from '../_war-state.js';
import { wrMercTierById } from '../_war-economy.js';
import { activeContestOnSector } from '../_sector-war-store.js';
import { activeVillageWarEnemiesOf } from '../world-state.js';
import { deployOneMerc, deployMercVillageWar } from '../_merc-auto.js';
import {
    type HostileBand,
    synthRoamingMercs,
    parseMercNpcId,
    mercVillageSlug,
    isMercTargetOnCooldown,
} from '../_merc-roam.js';

/*
 * /api/sector/merc-roam — POST only. The roaming-mercenary encounter surface
 * (Phase 5 — roaming rebuild).
 *
 * A hired merc band roams the enemy's territory as visible wanderer-style NPCs that
 * pick fights with the enemy village's players. WHERE they roam keys off which war
 * is live (the two are mutually exclusive):
 *   - sector war : the band patrols the CONTESTED sector (attacker W vs defender V,
 *                  Combat win-condition).
 *   - village war: the band FOLLOWS V's players — present in whatever sector V is in.
 *
 * Actions (body.action):
 *   - roster : read-only — the merc NPCs roaming `sector` that are hostile to the
 *              caller's village, so the client can render them like wanderers.
 *   - engage : the caller (a defender) ran into merc `mercId` → resolve the fight
 *              SERVER-SIDE (deployOneMerc / deployMercVillageWar) and apply it. The
 *              outcome is never trusted from the client, and a defender can't dodge a
 *              loss by not reporting it (the autonomous cron is the backstop).
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch).
 */

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;

/** Active, non-empty merc leases for a village (the bands it has fielded). */
async function activeBandsOf(village: string, now: number) {
    const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    return rec.mercLeases.filter((l) => l.expiresAt > now && l.count > 0);
}

/** The bands hostile to `viewerVillage` that roam `sector` right now: village-war
 *  enemies (whose mercs follow the viewer anywhere) + the Combat sector-war attacker
 *  besieging THIS sector. Mutual exclusion means a village is in one mode or the
 *  other, so the two branches never double-count the same attacker. */
async function hostileBandsFor(
    sector: number,
    viewerVillage: string,
    now: number,
): Promise<Array<HostileBand & { hirer: string; contestId?: string }>> {
    const out: Array<HostileBand & { hirer: string; contestId?: string }> = [];

    // 1. Village-war enemies — their mercs follow the viewer's players everywhere.
    const enemies = await activeVillageWarEnemiesOf(viewerVillage);
    for (const enemy of enemies) {
        for (const band of await activeBandsOf(enemy, now)) {
            const tier = wrMercTierById(band.tierId);
            if (!tier) continue;
            out.push({ village: enemy, tierId: band.tierId, level: tier.level, count: band.count, context: 'village', hirer: band.player });
        }
    }

    // 2. The Combat sector-war attacker besieging THIS sector (defender == viewer).
    const contest = await activeContestOnSector(sector);
    if (contest && contest.winCondition === 'combat' && contest.defenderVillage === viewerVillage && !enemies.includes(contest.attackerVillage)) {
        for (const band of await activeBandsOf(contest.attackerVillage, now)) {
            const tier = wrMercTierById(band.tierId);
            if (!tier) continue;
            out.push({ village: contest.attackerVillage, tierId: band.tierId, level: tier.level, count: band.count, context: 'sector', hirer: band.player, contestId: contest.id });
        }
    }
    return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '');
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }

        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });

        switch (action) {
            case 'roster': {
                const bands = await hostileBandsFor(sector, village, Date.now());
                return res.status(200).json({ ok: true, mercs: synthRoamingMercs(bands) });
            }
            case 'engage': return await doEngage(req, res, identity, playerName, village, sector, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[sector/merc-roam]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── engage (a defender ran into a roaming merc → resolve server-side) ──────────
async function doEngage(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, viewerVillage: string, sector: number, body: Record<string, unknown>) {
    const parsed = parseMercNpcId(String(body.mercId ?? ''));
    if (!parsed) return res.status(400).json({ error: 'Bad mercenary id.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'merc-roam-engage', 30, 60_000, identity.name))) return;

    const now = Date.now();
    // A defender a merc just fought is off-limits for 15 min — clean message before
    // we try to spend one (deploy* also re-checks this atomically).
    if (await isMercTargetOnCooldown(playerName, now)) {
        return res.status(429).json({ error: 'You just fought off a mercenary — they keep their distance for a few minutes.' });
    }

    // Re-derive the bands actually roaming this sector for the caller and match the
    // engaged merc to one — server truth; the client id is only a hint.
    const band = (await hostileBandsFor(sector, viewerVillage, now))
        .find((b) => mercVillageSlug(b.village) === parsed.villageSlug && b.tierId === parsed.tierId);
    if (!band) return res.status(409).json({ error: 'That mercenary is no longer here.' });

    if (band.context === 'sector') {
        if (!band.contestId) return res.status(409).json({ error: 'No active siege on this sector.' });
        const r = await deployOneMerc({ village: band.village, tierId: band.tierId, hirer: band.hirer, sector, targetPlayer: playerName, contestId: band.contestId, mercLevel: band.level, now });
        if (!r) return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
        return res.status(200).json({ ok: true, context: 'sector', winner: r.winner, captured: r.captured, controlHp: r.controlHp, mercsRemaining: r.mercsRemaining });
    }

    const r = await deployMercVillageWar({ village: band.village, enemyVillage: viewerVillage, tierId: band.tierId, hirer: band.hirer, sector, targetPlayer: playerName, mercLevel: band.level, now });
    if (!r) return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
    return res.status(200).json({ ok: true, context: 'village', winner: r.winner, enemyWarHp: r.enemyWarHp, mercsRemaining: r.mercsRemaining });
}
