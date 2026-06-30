import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage, homeVillageForSector } from '../_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    canAssignWinCondition,
    WIN_CONDITIONS,
    type WinCondition,
} from '../_war-state.js';

/*
 * /api/village/war-win-condition — POST only
 *
 * The seated Kage (or admin) sets a single home sector's sector-war win-condition
 * (Combat / Card). Enforces the max-7-per-type diversity rule (§17.2) via
 * canAssignWinCondition. Pet is rejected until its server-authoritative sim is
 * wired (Phase 7) — a client-claimed pet result must never flip territory.
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch).
 * Body: { playerName, village, sector, winCondition }.
 */

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        const winCondition = String(body.winCondition ?? '') as WinCondition;
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
        if (!(WIN_CONDITIONS as readonly string[]).includes(winCondition)) {
            return res.status(400).json({ error: 'Unknown win-condition.' });
        }
        // Pet sector wars require the server-side sim (Phase 7); until then a
        // client-claimed pet result could flip territory — disallow assigning it.
        if (winCondition === 'pet') {
            return res.status(409).json({ error: 'Pet-battle sectors are not available yet.' });
        }
        // The sector must be a home sector of this village.
        if (homeVillageForSector(sector) !== village) {
            return res.status(400).json({ error: 'That sector is not one of your home sectors.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-wincondition', 30, 60_000, identity.name))) return;

        if (!identity.admin) {
            const kageState = await kv.get<{ seatedKage?: string }>(kageKey(village));
            if (safeName(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can set sector win-conditions.' });
            }
        }

        const warKey = villageWarKey(village);
        const result = await withKvLock(warKey, async () => {
            const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
            if (!canAssignWinCondition(record, sector, winCondition)) {
                return { ok: false as const, error: 'max-7' };
            }
            record.sectors[String(sector)].winCondition = winCondition;
            await kv.set(warKey, record);
            return { ok: true as const, sector, winCondition };
        }, { failClosed: true });

        if (!result.ok) {
            return res.status(409).json({ error: `No more than 7 of 8 sectors may share a win-condition.` });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[village/war-win-condition]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
