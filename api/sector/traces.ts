import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { shrineForSector, shrineTier } from '../../shared/shrines.js';
import {
    footfallKey,
    isTraceSector,
    parseShrineState,
    parseSigns,
    pruneSigns,
    shrineKey,
    trailSignsKey,
    TOP_OFFERERS_SHOWN,
} from './_traces.js';

/*
 * /api/sector/traces — GET only
 *
 * Read-only snapshot of a wild sector's social traces: today's footfall count,
 * the active trail signs, and (in shrine sectors) the shrine ledger. World-public
 * data — everything in it (player names, offerings) is already visible in-game —
 * so no auth, just a light rate limit. Writes happen in /sector/trail-sign and
 * /sector/shrine-offer.
 *
 * Query: ?sector=<1-60>[&player=<name>]  (player → which signs YOU have sparked)
 * → { ok, sector, footfallToday, signs:[{id,name,tile,text,at,sparks}],
 *     mySparked:[signId], shrine?: {id,name,region,blessing,tier,tierName,total,
 *     weekTotal,topWeek,lastWeek} }
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'sector-traces', 90, 60_000)) return;

    try {
        const sector = Math.floor(Number((req.query?.sector as string) ?? NaN));
        if (!isTraceSector(sector)) return res.status(400).json({ error: 'Invalid sector.' });
        const player = safeName(String((req.query?.player as string) ?? ''));
        const now = Date.now();

        const [footfallRaw, signsRaw] = await Promise.all([
            kv.get(footfallKey(sector, now)),
            kv.get(trailSignsKey(sector)),
        ]);
        const signs = pruneSigns(parseSigns(signsRaw), now);

        const def = shrineForSector(sector);
        let shrine: Record<string, unknown> | undefined;
        if (def) {
            const state = parseShrineState(await kv.get(shrineKey(def.id)));
            const tier = shrineTier(state.total);
            shrine = {
                id: def.id,
                name: def.name,
                region: def.region,
                blessing: def.blessing,
                tier,
                total: state.total,
                weekTotal: state.week === undefined ? 0 : state.weekTotal,
                topWeek: state.topWeek.slice(0, TOP_OFFERERS_SHOWN),
                lastWeek: state.lastWeek
                    ? { week: state.lastWeek.week, topWeek: state.lastWeek.topWeek.slice(0, TOP_OFFERERS_SHOWN) }
                    : null,
            };
        }

        return res.status(200).json({
            ok: true,
            sector,
            footfallToday: Math.max(0, Math.floor(Number(footfallRaw)) || 0),
            signs: signs.map((s) => ({ id: s.id, name: s.name, tile: s.tile, text: s.text, at: s.at, sparks: s.sparks })),
            mySparked: player ? signs.filter((s) => s.sparkedBy.includes(player)).map((s) => s.id) : [],
            ...(shrine ? { shrine } : {}),
        });
    } catch (err) {
        console.error('[sector/traces]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
