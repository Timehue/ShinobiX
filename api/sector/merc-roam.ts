import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { normalizeVillageWarRecord, villageWarKey, type MercLeaseContext } from '../_war-state.js';
import { wrMercTierById } from '../_war-economy.js';
import { activeContestOnSector } from '../_sector-war-store.js';
import { contestGarrisonReady, type SectorWarSession } from '../_sector-war.js';
import { deployOneMerc, deployMercVillageWar } from '../_merc-auto.js';
import { bandsServing, mercBandKey } from '../_war-merc.js';
import {
    combatContestLive,
    listVillageWarInstances,
    sectorContestContext,
    villageWarActing,
    villageWarContext,
    villageWarFor,
} from '../_merc-context.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import {
    type HostileBand,
    synthRoamingMercs,
    parseMercNpcId,
    mercVillageSlug,
    isMercTargetOnCooldown,
} from '../_merc-roam.js';

/*
 * /api/sector/merc-roam — POST only. The roaming-mercenary encounter surface
 * (Phase 5 — roaming rebuild; owner redesign 2026-10-08).
 *
 * A hired merc band roams as visible wanderer-style NPCs that pick fights with
 * its enemy's players. Every band serves the ONE war it was hired for
 * (api/_merc-context.ts), and WHERE it roams follows that war:
 *   - sector war : the DEFENDING village's band patrols its contested Combat
 *                  sector and is hostile to the ATTACKING village's players there.
 *   - village war: the band FOLLOWS the enemy village's players — present in
 *                  whatever sector they are in (legacy, unbound bands included).
 *
 * Actions (body.action):
 *   - roster : read-only — the merc NPCs roaming `sector` that are hostile to the
 *              caller's village, so the client can render them like wanderers.
 *   - engage : the caller ran into merc `mercId` → resolve the fight SERVER-SIDE
 *              (deployOneMerc / deployMercVillageWar) and apply it. The outcome is
 *              never trusted from the client, and a player can't dodge a loss by
 *              not reporting it (the autonomous cron is the backstop).
 *
 * Server-gated: 404 when the default-on Sector Map campaign is disabled.
 */

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;

type RoamingBand = HostileBand & {
    hirer: string;
    bandKey: string;
    contestId?: string;
    instance?: string;
    war?: { id: string; generation: number };
};

/** The bands of `village` that serve `context` right now. */
async function bandsOf(village: string, context: MercLeaseContext, now: number) {
    const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    return bandsServing(rec.mercLeases, context, now);
}

/** The bands hostile to `viewerVillage` that roam `sector` right now: the enemy's
 *  bands for the viewer's live village war (they follow the viewer anywhere), and
 *  — when the viewer's village ATTACKS this Combat sector — the defender's bands
 *  hired for that contest. A band serves one war, so the two never double-count. */
async function hostileBandsFor(
    sector: number,
    viewerVillage: string,
    now: number,
    preloadedContest?: SectorWarSession | null,
): Promise<RoamingBand[]> {
    const out: RoamingBand[] = [];

    // 1. Village war — the enemy's bands follow the viewer's players everywhere,
    // but only once the war is hot and not frozen by a settling strike.
    const war = villageWarFor(await listVillageWarInstances(now), viewerVillage);
    if (war && villageWarActing(war)) {
        const enemy = war.villages.find((v) => v !== viewerVillage);
        if (enemy) {
            for (const band of await bandsOf(enemy, villageWarContext(war), now)) {
                const tier = wrMercTierById(band.tierId);
                if (!tier) continue;
                out.push({
                    village: enemy, tierId: band.tierId, level: tier.level, count: band.count, context: 'village',
                    hirer: band.player, bandKey: mercBandKey(band), war: { id: war.id, generation: war.generation },
                });
            }
        }
    }

    // 2. Sector war — the viewer's village ATTACKS this Combat sector, so the
    // DEFENDER's bands hired for this contest patrol it.
    const contest = preloadedContest === undefined ? await activeContestOnSector(sector) : preloadedContest;
    if (combatContestLive(contest, now) && contest.attackerVillage === viewerVillage) {
        const context = sectorContestContext(contest);
        for (const band of await bandsOf(contest.defenderVillage, context, now)) {
            const tier = wrMercTierById(band.tierId);
            if (!tier || context.kind !== 'sector') continue;
            out.push({
                village: contest.defenderVillage, tierId: band.tierId, level: tier.level, count: band.count, context: 'sector',
                hirer: band.player, bandKey: mercBandKey(band), contestId: contest.id, instance: context.instance,
            });
        }
    }
    return out;
}

/** The active contest on this sector, trimmed to what the World Map needs to
 *  decide WHICH game a sector attack opens (api/village/sector-war.ts owns the
 *  authoritative copy; this is a read-only projection and never a permission).
 *  Public by design — the declaration already rang the World Herald, so hiding
 *  the contest here would only stop a defender from finding their own war. */
function projectContestForSector(contest: SectorWarSession | null, viewerVillage: string, now: number) {
    if (!contest) return null;
    return {
        id: contest.id,
        sector: contest.sector,
        winCondition: contest.winCondition,
        attackerVillage: contest.attackerVillage,
        defenderVillage: contest.defenderVillage,
        endsAt: contest.endsAt,
        // Whether THIS viewer may fight the sector's garrison right now, decided
        // here rather than mirrored on the client. The rule has three moving
        // parts (the idle unlock, the re-form window between garrison battles,
        // and attacker-side-only) and one of them reads `appliedBattles`, which
        // is deliberately stripped from every client projection. Shipping the
        // verdict instead of the inputs means there is ONE implementation of the
        // rule; the endpoints re-derive it before minting a battle regardless, so
        // this only decides whether the button is offered.
        garrisonReady: contest.winCondition !== 'combat'
            && viewerVillage === contest.attackerVillage
            && contestGarrisonReady(contest, now),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

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

        // Village membership is authorization, never a client selector. The
        // request still carries `village` for old clients, but it cannot make a
        // player browse/engage another village's hostile bands.
        const actorSave = await kv.get<{ character?: { village?: unknown } }>(`save:${playerName}`);
        const village = String(actorSave?.character?.village ?? '').trim();
        const sector = Math.floor(Number(body.sector) || 0);
        if (!isWarVillage(village)) return res.status(403).json({ error: 'Your saved character is not in a war village.' });
        if (!identity.admin) {
            const presenceBlock = sectorPresenceBlock(playerName, sector);
            if (presenceBlock) return res.status(presenceBlock.status).json({ error: presenceBlock.error });
        }

        switch (action) {
            case 'roster': {
                const now = Date.now();
                // ONE contest read serves both answers: the merc bands (Combat only)
                // and the contest projection the World Map needs to route an attack
                // to the sector's actual win-condition. Loading it here instead of
                // inside hostileBandsFor keeps the read count identical to before.
                const contest = await activeContestOnSector(sector, now);
                const bands = await hostileBandsFor(sector, village, now, contest);
                return res.status(200).json({
                    ok: true,
                    mercs: synthRoamingMercs(bands),
                    contest: projectContestForSector(contest, village, now),
                });
            }
            case 'engage': return await doEngage(req, res, identity, playerName, village, sector, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[sector/merc-roam]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── engage (a player ran into a roaming merc → resolve server-side) ────────────
async function doEngage(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, viewerVillage: string, sector: number, body: Record<string, unknown>) {
    const parsed = parseMercNpcId(String(body.mercId ?? ''));
    if (!parsed) return res.status(400).json({ error: 'Bad mercenary id.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'merc-roam-engage', 30, 60_000, identity.name))) return;

    const now = Date.now();
    // A player a merc just fought is off-limits for 15 min — clean message before
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
        if (!band.contestId || !band.instance) return res.status(409).json({ error: 'No active sector war here.' });
        const r = await deployOneMerc({
            village: band.village, tierId: band.tierId, hirer: band.hirer, bandKey: band.bandKey,
            sector, targetPlayer: playerName, targetVillage: viewerVillage,
            contestId: band.contestId, instance: band.instance, mercLevel: band.level, now,
        });
        if (!r) return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
        return res.status(200).json({ ok: true, context: 'sector', winner: r.winner, attackerPoints: r.attackerPoints, defenderPoints: r.defenderPoints, mercsRemaining: r.mercsRemaining });
    }

    const r = await deployMercVillageWar({
        village: band.village, enemyVillage: viewerVillage, tierId: band.tierId, hirer: band.hirer, bandKey: band.bandKey,
        ...(band.war ? { war: band.war } : {}), sector, targetPlayer: playerName, mercLevel: band.level, now,
    });
    if (!r) return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
    return res.status(200).json({ ok: true, context: 'village', winner: r.winner, enemyWarHp: r.enemyWarHp, mercsRemaining: r.mercsRemaining });
}
