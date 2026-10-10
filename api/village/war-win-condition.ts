import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { heldSectorListForVillage } from '../_war-held-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    canAssignWinCondition,
    sectorConfigFor,
    WIN_CONDITIONS,
    type WinCondition,
} from '../_war-state.js';
import { villageWarMapEnabled } from '../_release-flags.js';

/*
 * /api/village/war-win-condition — POST only
 *
 * The seated Kage (or admin) sets the sector-war win-condition (Combat / Card /
 * Pet) of a sector the village HOLDS right now, home or captured: the current
 * holder sets a sector's rules (owner ruling 2026-10-08), and a village that lost
 * a sector no longer can. Enforces the max-7-per-type diversity rule (§17.2) over
 * the sectors it holds, via canAssignWinCondition.
 *
 * Server-gated: 404 when the default-on Sector Map campaign is disabled.
 * Body: { playerName, village, sector, winCondition }.
 */

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

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
        // (Pet sector wars are now server-resolved via api/village/sector-pet →
        // api/_pet-sim, byte-identical parity-tested — so Pet is a first-class,
        // cheat-proof win-condition and freely assignable, same as Combat/Card.)

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-wincondition', 30, 60_000, identity.name))) return;

        if (!identity.admin) {
            const kageState = await kv.get<{ seatedKage?: string }>(kageKey(village));
            const actor = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
            if (actor?.character?.village !== village || safeName(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can set sector win-conditions.' });
            }
        }

        // The sector must be one this village holds right now.
        const held = await heldSectorListForVillage(village);
        if (!held.includes(sector)) {
            return res.status(400).json({ error: 'Your village does not hold that sector. Its holder sets its rules.' });
        }

        const warKey = villageWarKey(village);
        const result = await withKvLock(warKey, async () => {
            const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
            if (!canAssignWinCondition(record, sector, winCondition, held)) {
                return { ok: false as const, error: 'max-7' };
            }
            record.sectors[String(sector)] = { ...sectorConfigFor(record, sector), winCondition };
            await kv.set(warKey, record);
            return { ok: true as const, sector, winCondition };
        }, { failClosed: true });

        if (!result.ok) {
            return res.status(409).json({ error: 'No more than 7 of the sectors you hold may share a win-condition.' });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[village/war-win-condition]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
