import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin, bodyNameMatchesAuth } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { checkEvolve, evolvePet, type PetLike } from './_evolution.js';

// Server-authoritative starter-pet evolution.
//
// Trust model (CLAUDE.md hard rule — never trust the client for currency/
// outcomes): the client cannot send the evolved stats. The server looks up the
// pet on the player's OWN save, validates the level gate + required item +
// expected tier, consumes ONE evolution stone from the inventory, and writes
// the evolved pet computed from the sealed spec (_evolution.ts). The whole
// read-modify-write runs under the per-save lock with { failClosed: true } so a
// double-submit (or contention) can never evolve twice or consume two stones.
//
// The stone itself is bought in the Grand Marketplace with Fate Shards (the
// existing client shop flow); this endpoint only verifies possession + spends
// the stone, then upgrades the pet.

const EVOLVE_RATE_LIMIT_MS = 3_000; // one evolve attempt per 3s per player

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'pet-evolve', 10, 60_000, peekName)) return;
    if (!enforceRateLimit(req, res, 'pet-evolve-burst', 1, EVOLVE_RATE_LIMIT_MS, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const petId = String(body.petId ?? '');
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!petId) return res.status(400).json({ error: 'Missing petId.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!bodyNameMatchesAuth(identity, playerName)) {
            return res.status(403).json({ error: 'Can only evolve your own pets.' });
        }

        const saveKey = `save:${playerName}`;

        const result = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record) return { error: 'no-save' as const };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { error: 'no-character' as const };

            const pets = Array.isArray(char.pets) ? (char.pets as PetLike[]) : [];
            const idx = pets.findIndex((p) => String(p?.id ?? '') === petId);
            if (idx < 0) return { error: 'no-pet' as const };

            const inventory = Array.isArray(char.inventory) ? (char.inventory as unknown[]).map(String) : [];

            const check = checkEvolve(pets[idx], inventory);
            if (!check.ok || !check.spec || !check.line || !check.nextStage) {
                return { reject: { code: check.code ?? 'not-evolvable', message: check.message ?? 'Cannot evolve.' } };
            }

            // Consume exactly ONE of the required stone.
            const itemIdx = inventory.indexOf(check.spec.requiredItem);
            if (itemIdx < 0) {
                return { reject: { code: 'missing-item' as const, message: `Missing required item (${check.spec.requiredItem}).` } };
            }
            const nextInventory = inventory.slice();
            nextInventory.splice(itemIdx, 1);

            const evolved = evolvePet(pets[idx], check.nextStage, check.line);
            const nextPets = pets.slice();
            nextPets[idx] = evolved;

            const updatedChar = { ...char, pets: nextPets, inventory: nextInventory };
            const updated = { ...record, character: updatedChar };
            await kv.set(saveKey, mergePreservingImages(updated, record));
            return { ok: true as const, pet: evolved, stage: check.nextStage };
        }, { failClosed: true });

        if ('error' in result) {
            const code = result.error === 'no-save' || result.error === 'no-character' || result.error === 'no-pet' ? 404 : 500;
            return res.status(code).json({ error: result.error });
        }
        if ('reject' in result && result.reject) {
            const rej = result.reject;
            // 409 for state conflicts (already evolved / wrong tier), 400 otherwise.
            const status = rej.code === 'max-evolved' || rej.code === 'wrong-tier' ? 409 : 400;
            return res.status(status).json({ error: rej.message, code: rej.code });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[pet/evolve]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
