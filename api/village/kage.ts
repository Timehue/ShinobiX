import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

type VillageKageState = {
    kageSystemUnlocked: boolean;
    seatedKage?: string;
    firstLiberator?: string;
    unlockedAt?: number;
};

function kageKey(village: string) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';

    if (req.method === 'GET') {
        try {
            if (!village) return res.status(400).json({ error: 'Missing village.' });
            const state = await kv.get<VillageKageState>(kageKey(village)) ?? { kageSystemUnlocked: false };
            res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
            return res.status(200).json(state);
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        // All Kage mutations require authentication.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Tight per-player cap — legitimate kage actions are once-in-a-while.
        // Admins skip (admin reset scripts may legitimately fire many fast).
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-kage', 10, 60_000, identity.name))) return;

        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { village: bodyVillage, playerName, action } = body as {
                village?: string;
                playerName?: string;
                action?: 'unlock' | 'seat' | 'reset';
            };
            const v = (bodyVillage ?? '').trim() || village;
            if (!v || !playerName) return res.status(400).json({ error: 'Missing village or playerName.' });

            // Players may only act as themselves (or admin can act for anyone).
            if (!identity.admin && identity.name !== safeName(playerName)) {
                return res.status(403).json({ error: 'Cannot perform Kage actions as another player.' });
            }

            const key = kageKey(v);

            // The unlock/seat/reset mutations are read-modify-writes on a shared,
            // permission-bearing key (the seated Kage authorizes village-treasury
            // transfers, and `firstLiberator` is permanent). Without a lock, two
            // players racing the once-per-village `unlock` both read
            // `kageSystemUnlocked:false`, both pass, and last-writer-wins can seat
            // the race loser + brand the wrong firstLiberator. Wrap the whole
            // read-check-write under the kage-key lock and re-read inside it so
            // the second writer observes the first's commit. failClosed: a KV
            // hiccup aborts (caller retries) rather than racing this state.
            const result = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                const current = await kv.get<VillageKageState>(key) ?? { kageSystemUnlocked: false };

                if (action === 'unlock') {
                    if (current.kageSystemUnlocked) {
                        // Already unlocked — return current without changing the seated kage
                        return { status: 200, body: current };
                    }

                    // ── Server-side requirement gate ──────────────────────────
                    // Only a player who has completed the level-100 Kage story
                    // fight should be able to unlock the Kage system. Verify
                    // their saved character data in KV to prevent exploits
                    // (e.g. calling this endpoint directly from devtools).
                    if (!identity.admin) {
                        const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const char = (save as Record<string, unknown> | null)?.character as Record<string, unknown> | undefined;
                        if (!char) {
                            return { status: 400, body: { error: 'Character save not found.' } };
                        }
                        const level = Number(char.level ?? 0);
                        const storyProgress = Number(char.storyProgress ?? 0);
                        // The kage finale story step is the level-100 boss fight
                        // (the 9th milestone at index 8). After defeating it the
                        // client increments storyProgress to 9. Level must also
                        // be ≥ 100.
                        if (level < 100) {
                            return { status: 403, body: { error: `Must be level 100 to unlock the Kage system (current: ${level}).` } };
                        }
                        if (storyProgress < 9) {
                            return { status: 403, body: { error: `Must complete the village story to unlock the Kage system (progress: ${storyProgress}/9).` } };
                        }
                    }

                    const next: VillageKageState = {
                        kageSystemUnlocked: true,
                        seatedKage: playerName,
                        firstLiberator: playerName,
                        unlockedAt: Date.now(),
                    };
                    await kv.set(key, next);
                    return { status: 200, body: next };
                }

                if (action === 'reset') {
                    // Admin-only: reset the Kage system back to NPC / sealed state.
                    if (!identity.admin) {
                        return { status: 403, body: { error: 'Only admins can reset the Kage system.' } };
                    }
                    const next: VillageKageState = {
                        kageSystemUnlocked: false,
                    };
                    await kv.set(key, next);
                    return { status: 200, body: next };
                }

                if (action === 'seat') {
                    if (!current.kageSystemUnlocked) {
                        return { status: 400, body: { error: 'Kage system not unlocked for this village.' } };
                    }
                    // Only the current seated Kage or an admin may install a new Kage.
                    const currentKage = safeName(current.seatedKage ?? '');
                    if (!identity.admin && identity.name !== currentKage) {
                        return { status: 403, body: { error: 'Only the seated Kage or admin can change the Kage.' } };
                    }

                    // Verify the candidate actually belongs to this village. Stops the
                    // seated Kage from installing someone from a different village.
                    const candidateNorm = safeName(playerName);
                    if (!identity.admin) {
                        try {
                            const candSave = await kv.get<Record<string, unknown>>(`save:${candidateNorm}`);
                            const candChar = (candSave?.character ?? null) as Record<string, unknown> | null;
                            if (!candChar) {
                                return { status: 400, body: { error: 'Candidate save not found.' } };
                            }
                            const candVillage = (candChar.village as string | undefined) ?? '';
                            if (candVillage.trim() !== v.trim()) {
                                return { status: 403, body: { error: 'Candidate is not a member of this village.' } };
                            }
                        } catch {
                            return { status: 500, body: { error: 'Unable to verify candidate.' } };
                        }
                    }

                    // firstLiberator gate: once a firstLiberator exists, only they
                    // (or the seated Kage who chose to step down) can be re-seated
                    // when the seat is empty. We accept the seated-Kage path above
                    // and ensure that admin / seated Kage actions still proceed
                    // here; the firstLiberator is preserved in the next-state.
                    const next: VillageKageState = {
                        ...current,
                        seatedKage: playerName,
                        firstLiberator: current.firstLiberator ?? playerName,
                    };
                    await kv.set(key, next);
                    return { status: 200, body: next };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            }, { failClosed: true });

            return res.status(result.status).json(result.body);
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
