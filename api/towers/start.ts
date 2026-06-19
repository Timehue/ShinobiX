import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { getFloor, MIN_PARTY_SIZE, MAX_PARTY_SIZE } from './_floor-catalog.js';
import { sealTowerFighter } from './_seal.js';
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

        const floor = getFloor(Math.floor(Number(body.floor)));
        if (!floor) return res.status(400).json({ error: 'Unknown floor.' });

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
        for (let i = 0; i < memberSlugs.length; i++) {
            const slug = memberSlugs[i]!;
            const rec = await kv.get<Record<string, unknown>>(`save:${slug}`);
            const char = rec?.character as Record<string, unknown> | undefined;
            if (!char || typeof char !== 'object') {
                if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' });
                continue; // skip a missing/invalid ally
            }
            squad.push({
                id: `sq-${i}`,
                name: String(char.name ?? slug),
                ownerSlug: slug,
                ai: false, // every squad member is a LIVE player; absent ones auto-pass (AFK)
                character: sealTowerFighter(char),
            });
        }
        if (squad.length === 0) return res.status(400).json({ error: 'No valid squad members.' });

        const runId = `tower-${randomUUID().replace(/-/g, '')}`;
        const seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        const now = Date.now();
        const session = buildTowerEncounter({ floor, squad, runId, seed, partySize: squad.length, now });
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
