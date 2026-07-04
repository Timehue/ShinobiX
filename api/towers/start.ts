import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { getFloor, MIN_PARTY_SIZE, MAX_PARTY_SIZE } from './_floor-catalog.js';
import { getSpireFloor, spireBossForFloor, isValidSpireTier, spireRequiresFullSquad } from './_spire-catalog.js';
import { resolveAscensionModifiers, weeklySpireBlessing, type AscensionSeal } from './_modifiers.js';
import { weekIndex } from '../missions/_weekly-board.js';
import { sealTowerFighter, sealTowerItemCharges } from './_seal.js';
import { buildTowerEncounter, type SquadMemberInput } from './_encounter.js';
import { startRound, runAiUntilHuman } from './_engine.js';
import { makeRng } from './_sim.js';
import { writeSession, setTowerInvite, bumpDailyStartCount, MAX_TOWER_STARTS_PER_DAY } from './_tower-store.js';
import { stampTurnClock } from './_tower-mp.js';

/*
 * POST /api/towers/start — begin a Battle Towers run.
 *
 * Server-authoritative: the host + each ally are snapshotted from their AUTHORITATIVE save
 * and sealed combat-safe (sealTowerFighter); the host is the live human, allies are AI. The
 * seed + encounter are server-minted, persisted under tower:<runId>, and the AI is advanced
 * to the host's first turn. Body: { hostName, floor, allies?: string[] }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = safeName(String(body.hostName ?? ''));
        if (!hostName) return res.status(400).json({ error: 'Invalid host name.' });
        if (!enforceRateLimit(req, res, 'towers-start', 6, 60_000, hostName)) return;

        const identity = await authedPlayerOrAdmin(req, hostName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName) return res.status(403).json({ error: 'Can only start your own runs.' });

        // Endless Spire (dedicated ascension boss gauntlet) vs the 10 story floors. Spire
        // resolves the floor from getSpireFloor(tier) — NEVER the story FLOOR_CATALOG.
        const mode: 'story' | 'spire' = String(body.mode ?? 'story') === 'spire' ? 'spire' : 'story';
        const spireTier = Math.floor(Number(body.ascensionTier));
        if (mode === 'spire' && !isValidSpireTier(spireTier)) return res.status(400).json({ error: 'Invalid spire tier.' });

        const floor = mode === 'spire' ? getSpireFloor(spireTier) : getFloor(Math.floor(Number(body.floor)));
        if (!floor) return res.status(400).json({ error: mode === 'spire' ? 'Unknown spire tier.' : 'Unknown floor.' });

        // The host's client-computed combat extras the SAVE doesn't persist (pvpItems +
        // equipment-derived passives). Sealed (clamped) into the host fighter only — borrowed
        // allies seal from their own save (jutsu + stats; their derived passives default).
        const hostLoadout = (body.hostLoadout && typeof body.hostLoadout === 'object') ? body.hostLoadout as Record<string, unknown> : {};

        // Borrowed allies (friends/clan/public) → AI snapshots. De-dupe + cap the party.
        const allyNames: string[] = Array.isArray(body.allies) ? body.allies.map((a: unknown) => safeName(String(a))).filter(Boolean) : [];
        const memberSlugs = [...new Set([hostName, ...allyNames])].slice(0, MAX_PARTY_SIZE);
        if (memberSlugs.length < MIN_PARTY_SIZE && allyNames.length > 0) {
            // host wanted a squad but it collapsed to 1 — still allowed (solo), just note via partySize below
        }

        // Atomic daily mint cap (counts attempts, like raid-start).
        const started = await bumpDailyStartCount(hostName);
        if (!identity.admin && started > MAX_TOWER_STARTS_PER_DAY) {
            return res.status(429).json({ error: 'Daily Battle Towers start limit reached.' });
        }

        const squad: SquadMemberInput[] = [];
        let hostAscensionUnlocked = 0; // host's highest spire tier cleared (unlock gate)
        for (let i = 0; i < memberSlugs.length; i++) {
            const slug = memberSlugs[i]!;
            const rec = await kv.get<Record<string, unknown>>(`save:${slug}`);
            const char = rec?.character as Record<string, unknown> | undefined;
            if (!char || typeof char !== 'object') {
                if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' });
                continue; // skip a missing/invalid ally
            }
            if (slug === hostName) hostAscensionUnlocked = Math.max(0, Math.floor(Number(char.battleTowerAscension) || 0));
            squad.push({
                id: `sq-${i}`,
                name: String(char.name ?? slug),
                ownerSlug: slug,
                ai: false, // every squad member is a LIVE player; absent ones auto-pass (AFK)
                // Seal from the FULL save record (rec) so the equipped jutsu loadout resolves
                // from equippedJutsuIds + savedBloodlines/creatorJutsus (the save has no ready
                // `jutsu` array) — identical to a PvP fighter. The host also supplies the
                // client-computed pvpItems + passives. itemCharges caps consumables.
                character: sealTowerFighter(char, rec, slug === hostName ? hostLoadout : {}),
                itemCharges: sealTowerItemCharges(char),
            });
        }
        if (squad.length === 0) return res.status(400).json({ error: 'No valid squad members.' });

        // Endless Spire gates (server-authoritative): you may enter at most one tier above your
        // highest cleared, and — when the humans-only flag is on — only with a full squad.
        let ascension: AscensionSeal | undefined;
        let spireBossId: string | undefined;
        if (mode === 'spire') {
            if (!identity.admin && spireTier > hostAscensionUnlocked + 1) {
                return res.status(403).json({ error: `Spire floor ${spireTier} is locked — clear floor ${hostAscensionUnlocked + 1} first.` });
            }
            if (spireRequiresFullSquad() && !identity.admin && squad.length < MAX_PARTY_SIZE) {
                return res.status(403).json({ error: 'The Endless Spire requires a full squad.' });
            }
            spireBossId = spireBossForFloor(spireTier);
            // Weekly Blessing: a player-favourable affix sealed ONCE at entry from THIS week's index
            // (handler-side clock; resolveAscensionModifiers stays pure). A run started this week keeps
            // its blessing across a week rollover, and settle needs no recompute.
            const blessing = weeklySpireBlessing(weekIndex(Date.now()));
            ascension = resolveAscensionModifiers(spireTier, spireBossId ?? 'sovereign', floor.roundBudget, blessing.modifier);
        }

        const runId = `tower-${randomUUID().replace(/-/g, '')}`;
        const seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        const now = Date.now();
        const session = buildTowerEncounter({ floor, squad, runId, seed, partySize: squad.length, now, ascension, spireBossId });
        startRound(session);
        runAiUntilHuman(session, floor, makeRng(seed)); // advance to the first human's turn (or auto-resolve)
        stampTurnClock(session, now);                   // start the AFK clock for whoever is up
        await writeSession(session);

        // Invite each ally → point them at this runId so they can discover + join it.
        for (const slug of memberSlugs) {
            if (slug !== hostName) await setTowerInvite(slug, runId).catch(() => undefined);
        }

        return res.status(200).json({ runId, session });
    } catch (err) {
        console.error('[towers/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
