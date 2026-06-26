import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { masteryBonus } from '../_profession-mastery.js';
import { bumpSaveVersion } from '../save/_save-version.js';

// jutsuId must be a sane slug — lowercase letters/digits/dashes only, length-
// bounded. Stops injection of weird KV keys or path-traversal-ish values.
const JUTSU_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

// Honor Seal cost per jutsu-level increment, indexed by the *current* level
// (the one you're leveling FROM). 30→31 = 20 Seals, etc. Per docs/professions.md.
const SEAL_COSTS_BY_FROM_LEVEL: Record<number, number> = {
    30: 20,
    31: 25,
    32: 30,
    33: 35,
    34: 40,
    35: 45,
    36: 50,
    37: 55,
    38: 60,
    39: 65,
};

const MIN_LEVEL = 30;
const MAX_LEVEL = 40; // Seal path stops at 40 — 40→50 still requires PvP.

// Vanguard Rank 8+ pays 90% of the listed cost (10% discount).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

function computeCost(fromLevel: number, profession: unknown, professionRank: unknown, masterySpec: unknown): number {
    let cost = SEAL_COSTS_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (cost === 0) return 0;
    if (profession === 'vanguard' && Number(professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        cost = cost * VANGUARD_DISCOUNT_MULT;
    }
    // Vanguard mastery (Quartermaster → Efficient Forging): extra Seal discount,
    // capped at the resolver's max. Stacks multiplicatively with the rank-8 cut.
    const masteryPct = Math.min(50, masteryBonus(profession, masterySpec, 'sealTrainCostPct'));
    if (masteryPct > 0) cost = cost * (1 - masteryPct / 100);
    return Math.max(1, Math.ceil(cost));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate limit: 1 Seal-train per 30s per player. Going faster would let a
    // player race through 30→40 (10 levels) in five minutes flat which trivializes
    // the spec's "skip the PvP grind" intent. 30s also keeps the per-save XP cap
    // meaningful.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'train-with-seals', 1, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase();
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!jutsuId) return res.status(400).json({ error: 'Missing jutsuId.' });
        if (!JUTSU_ID_PATTERN.test(jutsuId)) {
            return res.status(400).json({ error: 'Invalid jutsuId format.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only spend your own Seals.' });
        }

        const key = `save:${playerName}`;
        // Wrap the read-modify-write under lock:save:<name> so two concurrent
        // train-with-seals calls (or one of these + a normal auto-save) can't
        // both read the same balance + mastery row, both apply the same +1
        // level, and the player end up at +2 levels for one cost (or 0
        // levels for two costs depending on write order).
        const lockResult = await withKvLock(key, async () => {
            const record = await kv.get<Record<string, unknown>>(key);
            if (!record) return { status: 404 as const, body: { error: 'Player not found.' } };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { status: 404 as const, body: { error: 'Character not found.' } };

            const mastery = (char.jutsuMastery as Array<{ jutsuId: string; level: number; xp: number }> | undefined) ?? [];
            const idx = mastery.findIndex(m => m.jutsuId === jutsuId);
            if (idx === -1) return { status: 404 as const, body: { error: 'You have not learned that jutsu.' } };

            const current = mastery[idx];
            const fromLevel = Number(current.level ?? 0);
            // Honor Seal training only opens once the jutsu has been hand-grinded
            // to Lv 30 via ryo training. This prevents Seal-rich players from
            // skipping the entire early jutsu progression. Bloodline-locked
            // jutsu (and any element-gated jutsu) ARE eligible — once you've
            // legitimately trained one to 30, Seals can carry it the rest of
            // the way. The same-village / level / clan restrictions of the
            // bloodline don't change anything for this endpoint.
            if (fromLevel < MIN_LEVEL) {
                return { status: 400 as const, body: { error: `Honor Seal training is only available at level ${MIN_LEVEL}+. Train this jutsu to ${MIN_LEVEL} with ryo first.` } };
            }
            if (fromLevel >= MAX_LEVEL) {
                return { status: 400 as const, body: { error: `Levels ${MAX_LEVEL}+ still require PvP training.` } };
            }

            const cost = computeCost(fromLevel, char.profession, char.professionRank, char.masterySpec);
            if (cost <= 0) return { status: 400 as const, body: { error: 'No cost defined for that level.' } };

            const balance = Number(char.honorSeals ?? 0);
            if (balance < cost) {
                return { status: 402 as const, body: { error: 'Not enough Honor Seals.', cost, balance } };
            }

            // Apply: debit Seals, increment jutsu level.
            const newMastery = [...mastery];
            newMastery[idx] = { ...current, level: fromLevel + 1 };
            const updated = {
                ...record,
                character: {
                    ...char,
                    honorSeals: balance - cost,
                    jutsuMastery: newMastery,
                },
            };
            bumpSaveVersion(updated);
            await kv.set(key, mergePreservingImages(updated, record));

            return {
                status: 200 as const,
                body: {
                    ok: true,
                    jutsuId,
                    newLevel: fromLevel + 1,
                    sealsSpent: cost,
                    honorSealsRemaining: balance - cost,
                },
            };
        });
        return res.status(lockResult.status).json(lockResult.body);
    } catch (err) {
        console.error('[jutsu/train-with-seals]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
