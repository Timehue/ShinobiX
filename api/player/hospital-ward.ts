import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readKvProjection } from '../_storage-projection.js';
import { REGISTRY_KEY, parsePublicPlayerIndexEntry } from './_public-index.js';

/*
 * GET /api/player/hospital-ward?playerName=<you>
 *
 * Who is lying in YOUR village's hospital right now — the patient list a Healer
 * works from, and that every villager can see (only Healers get a Heal button).
 *
 * It exists because the list used to be derived from the public roster, which
 * could not show it:
 *   - An ONLINE patient's roster row is built from their presence frame, and
 *     presence deliberately omits `hospitalized`. Every player knocked out while
 *     playing — i.e. nearly everyone — was invisible to the ward for their whole
 *     stay. Only sleeper-kill victims, who are offline by definition, ever showed.
 *   - The roster is cached for up to ~90 s (process + edge) and polled once a
 *     minute, while an admission lasts 60 s. Even a correct row arrived after
 *     the patient had checked out.
 *
 * So this reads the SAVES — the only authority on who is admitted — through a
 * narrow projection, for the caller's own village only, and is never shared-
 * cached. An offline patient stays listed: their body is still in the bed until
 * they check out or a Healer treats them, which is the window a Healer works in.
 */

const WARD_PROJECTION = {
    name: ['character', 'name'],
    level: ['character', 'level'],
    village: ['character', 'village'],
    hp: ['character', 'hp'],
    maxHp: ['character', 'maxHp'],
    hospitalized: ['character', 'hospitalized'],
    hospitalizedAt: ['character', 'hospitalizedAt'],
    hospitalizedUntil: ['character', 'hospitalizedUntil'],
} as const;

export type WardPatient = {
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    /** Admission time; 0 for a legacy admission that predates the stamp. */
    admittedAt: number;
    /** When the free checkout opens; 0 when unknown. */
    freeCheckoutAt: number;
};

function num(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only view your own village hospital.' });
        }
        // The Hospital and Healer screens poll this every ~10 s while visible.
        if (!identity.admin && !enforceRateLimit(req, res, 'hospital-ward', 30, 60_000, identity.name)) return;

        const [viewer] = await readKvProjection(kv, [`save:${playerName}`], { village: ['character', 'village'] });
        const village = typeof viewer?.village === 'string' ? viewer.village : '';
        if (!village) return res.status(404).json({ error: 'Your village could not be found.' });

        // Same derivation as injured-villagers: the registry names every saved
        // player and already carries their village, so only saves that can
        // match are read. The save-side village check below stays authoritative.
        const registry = await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY);
        const slugs = Object.entries(registry ?? {})
            .filter(([slug]) => !slug.startsWith('clan-') && !slug.toLowerCase().startsWith('admin') && slug !== playerName)
            .filter(([slug, entry]) => {
                const indexed = parsePublicPlayerIndexEntry(entry, slug)?.village ?? '';
                return !indexed || indexed === village;
            })
            .map(([slug]) => slug);

        const rows = slugs.length ? await readKvProjection(kv, slugs.map((slug) => `save:${slug}`), WARD_PROJECTION) : [];
        const patients: WardPatient[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.hospitalized !== true || row.village !== village) continue;
            const name = typeof row.name === 'string' && row.name ? row.name : slugs[i]!;
            if (safeName(name) === playerName) continue;
            patients.push({
                name,
                level: Math.max(1, num(row.level)),
                hp: num(row.hp),
                maxHp: Math.max(1, num(row.maxHp)),
                admittedAt: num(row.hospitalizedAt),
                freeCheckoutAt: num(row.hospitalizedUntil),
            });
        }
        // Longest-waiting first: the order a ward would triage in.
        patients.sort((a, b) => (a.admittedAt || Number.MAX_SAFE_INTEGER) - (b.admittedAt || Number.MAX_SAFE_INTEGER)
            || a.name.localeCompare(b.name));

        // Per-caller data: never a shared cache. See injured-villagers.ts.
        res.setHeader('Cache-Control', 'private, no-cache');
        return res.status(200).json({ village, patients });
    } catch (err) {
        console.error('[player/hospital-ward]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
