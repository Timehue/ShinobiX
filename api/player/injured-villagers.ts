import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { professionRankForXp } from '../missions/_progress.js';
import { battleLockFlagsForPlayers, settleSaveRecord } from '../_elapsed-state.js';
import { parsePublicPlayerIndexEntry } from './_public-index.js';
import { masteryHasCapstone } from '../_profession-mastery.js';

// Rank 10 Healer perk: see all injured players in your village anywhere in
// the world (HP < maxHp), not just those in the hospital. Returns a small
// projection so it's cheap to render in the Hospital UI.
const HEALER_WORLDWIDE_RANK = 10;
const HP_INJURED_THRESHOLD = 0.99; // <99% HP counts as injured
// Persistent player index — every saved player is upserted here atomically with
// their save (see api/save/[name].ts + api/player/roster.ts). Deriving save keys
// from it avoids a full save:* keyspace scan (recursive disk-overlay walk) on
// every Healer poll.
const REGISTRY_KEY = 'player:registry';

/**
 * True only when stored vitals prove the player is above the injured threshold
 * whatever settlement does. settleSaveRecord only regenerates HP
 * (_elapsed-state.ts regenVital: min(floor(maxHp), floor(hp) + n) with n >= 1)
 * and never changes maxHp, so for integer vitals the HP ratio can only rise or
 * clamp to full. Anything unusual (missing, fractional, non-positive) returns
 * false and takes the full read, exactly as before.
 */
export function certainlyHealthyVitals(row: Record<string, unknown> | null | undefined): boolean {
    const hp = row?.hp;
    const maxHp = row?.maxHp;
    return typeof hp === 'number' && typeof maxHp === 'number'
        && Number.isInteger(hp) && Number.isInteger(maxHp)
        && hp >= 0 && maxHp > 0 && hp / maxHp > HP_INJURED_THRESHOLD;
}

type InjuredEntry = {
    name: string;
    level: number;
    village: string;
    hp: number;
    maxHp: number;
    hospitalized: boolean;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const healerName = safeName(String(req.query.healerName ?? ''));
        if (!healerName) return res.status(400).json({ error: 'Invalid healer name.' });

        const identity = await authedPlayerOrAdmin(req, healerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== healerName) {
            return res.status(403).json({ error: 'Can only query for your own profession.' });
        }

        // The registry read does not depend on the healer's save, so it runs
        // alongside it (as in hospital-ward.ts). It is awaited only after every
        // healer check below, so a 404/403/400 still answers exactly as before,
        // and its rejection is never unhandled.
        const registryRead = kv.hgetall<Record<string, unknown>>(REGISTRY_KEY);
        registryRead.catch(() => undefined);
        const healerRecord = await kv.get<Record<string, unknown>>(`save:${healerName}`);
        const healerChar = healerRecord?.character as Record<string, unknown> | undefined;
        if (!healerChar) return res.status(404).json({ error: 'Healer character not found.' });

        if (!identity.admin && healerChar.profession !== 'healer') {
            return res.status(403).json({ error: 'Healers only.' });
        }
        // Derive rank from professionXp server-side instead of trusting
        // the saved professionRank field. A corrupted save / admin edit
        // setting professionRank=10 directly would otherwise leak
        // world-wide injured-villager data without the player earning it.
        const trustedRank = professionRankForXp('healer', Number(healerChar.professionXp ?? 0));
        // The Village Lifeline mastery capstone grants the same world-wide reach
        // below Rank 10. /api/player/heal already honours it (heal.ts), so a
        // capstone holder could heal these targets but had no way to find them.
        const hasLifeline = masteryHasCapstone('healer', healerChar.masterySpec, 'village-lifeline');
        if (!identity.admin && trustedRank < HEALER_WORLDWIDE_RANK && !hasLifeline) {
            return res.status(403).json({ error: `World-wide visibility unlocks at Rank ${HEALER_WORLDWIDE_RANK}.` });
        }

        const healerVillage = String(healerChar.village ?? '');
        if (!healerVillage) return res.status(400).json({ error: 'Healer has no village set.' });

        // Derive player save keys from the registry (every saved player is in it)
        // instead of scanning the whole save:* keyspace, then filter to same-village
        // injured players. Same-village filter applied server-side so we never leak
        // other villages' player data through this endpoint.
        const registry = await registryRead;
        const playerSlugs = Object.entries(registry ?? {})
            .filter(([slug]) => !slug.startsWith('clan-') && !slug.toLowerCase().startsWith('admin'))
            // The index already carries each player's village, so read only the
            // saves that can match instead of every registered player's full
            // save (~100 KB each) on every Healer poll. An entry with no village
            // is still read, and the save-side village check below stays the
            // authority for every record that is read.
            .filter(([slug, entry]) => {
                const indexedVillage = parsePublicPlayerIndexEntry(entry, slug)?.village ?? '';
                return !indexedVillage || indexedVillage === healerVillage;
            })
            .map(([slug]) => slug);
        const playerKeys = playerSlugs.map(slug => `save:${slug}`);
        if (playerKeys.length === 0) {
            res.setHeader('Cache-Control', 'private, no-store'); // login-gated, per healer
            return res.status(200).json({ injured: [] });
        }

        // Rank-10 healers poll this every 20s, and it read the whole save (~100 KB)
        // of every same-village player on each poll. Read their two HP numbers
        // first: anyone already certainly healthy cannot be injured after the
        // settlement below, so only the rest need their full save.
        const vitals = await readKvProjection(kv, playerKeys, { hp: ['character', 'hp'], maxHp: ['character', 'maxHp'] });
        const candidateSlugs = playerSlugs.filter((_, index) => !certainlyHealthyVitals(vitals[index]));
        if (candidateSlugs.length === 0) {
            res.setHeader('Cache-Control', 'private, no-cache');
            return res.status(200).json({ injured: [] });
        }
        const [records, battleLocks] = await Promise.all([
            kv.mget(...candidateSlugs.map(slug => `save:${slug}`)),
            battleLockFlagsForPlayers(candidateSlugs),
        ]);
        const injured: InjuredEntry[] = [];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const rec = r as Record<string, unknown> | null;
            if (!rec) continue;
            const settled = settleSaveRecord(rec, { battleLocked: battleLocks.get(candidateSlugs[i]!) === true }).record;
            const c = settled.character as Record<string, unknown> | undefined;
            if (!c) continue;
            const name = String(c.name ?? '');
            // healerName is a safeName slug; c.name is a display name — canonicalize
            // to skip the healer's own record even when their name has a space.
            if (!name || safeName(name) === healerName) continue;
            if (c.village !== healerVillage) continue;
            const hp = Number(c.hp ?? 0);
            const maxHp = Number(c.maxHp ?? 0);
            if (maxHp <= 0) continue;
            if (hp / maxHp > HP_INJURED_THRESHOLD) continue;
            injured.push({
                name,
                level: Number(c.level ?? 1),
                village: healerVillage,
                hp,
                maxHp,
                hospitalized: !!c.hospitalized,
            });
        }

        injured.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
        // Authenticated, per-healer data: never a shared cache. The edge would
        // key it by URL alone and hand one healer's list to anyone who asks for
        // it. The browser may revalidate it (ETag), nothing more.
        res.setHeader('Cache-Control', 'private, no-cache');
        return res.status(200).json({ injured });
    } catch (err) {
        console.error('[player/injured-villagers]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
