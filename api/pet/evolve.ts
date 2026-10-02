import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin, bodyNameMatchesAuth } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { checkEvolve, evolvePet, type PetLike } from './_evolution.js';
import { activeBreedingParentIds } from './_pet-busy.js';

// Server-authoritative starter-pet evolution.
//
// Trust model (CLAUDE.md hard rule — never trust the client for currency/
// outcomes): the client cannot send the evolved stats. The server looks up the
// pet on the player's OWN save, validates the level gate + required item +
// expected tier, consumes ONE evolution stone from the inventory, and writes
// the evolved pet computed from the sealed spec (_evolution.ts). The whole
// read-modify-write commits through mutatePlayerSave (the per-save lock with
// failClosed, and an exact compare-and-set) so a double-submit (or contention)
// can never evolve twice or consume two stones.
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

        type Outcome =
            | { error: 'no-pet' }
            | { reject: { code: string; message: string } }
            | { ok: true; pet: PetLike; stage: NonNullable<ReturnType<typeof checkEvolve>['nextStage']> };
        // The stone is consumed in the same write as the evolution, so re-running
        // the whole mutation after a lost compare-and-set evolves the pet once.
        const committed = await retryOnSaveVersionConflict(() => mutatePlayerSave<Outcome>(playerName, ({ character: char }) => {
            const refuse = (value: Outcome) => ({ ok: true as const, write: false, character: char, value });
            const pets = Array.isArray(char.pets) ? (char.pets as PetLike[]) : [];
            const idx = pets.findIndex((p) => String(p?.id ?? '') === petId);
            if (idx < 0) return refuse({ error: 'no-pet' });
            if (activeBreedingParentIds(char).has(petId)) {
                return refuse({ reject: { code: 'pet-is-breeding', message: 'This pet is in the Shinobi Hatchery.' } });
            }

            const inventory = Array.isArray(char.inventory) ? (char.inventory as unknown[]).map(String) : [];

            const check = checkEvolve(pets[idx], inventory);
            if (!check.ok || !check.spec || !check.line || !check.nextStage) {
                return refuse({ reject: { code: check.code ?? 'not-evolvable', message: check.message ?? 'Cannot evolve.' } });
            }

            // Consume exactly ONE of the required stone.
            const itemIdx = inventory.indexOf(check.spec.requiredItem);
            if (itemIdx < 0) {
                return refuse({ reject: { code: 'missing-item', message: `Missing required item (${check.spec.requiredItem}).` } });
            }
            const nextInventory = inventory.slice();
            nextInventory.splice(itemIdx, 1);

            const evolved = evolvePet(pets[idx], check.nextStage, check.line);
            const nextPets = pets.slice();
            nextPets[idx] = evolved;

            return {
                ok: true,
                character: { ...char, pets: nextPets, inventory: nextInventory },
                value: { ok: true, pet: evolved, stage: check.nextStage },
            };
        }));
        if (!committed.ok) {
            if (committed.status === 404) {
                return res.status(404).json({ error: committed.code === 'character-not-found' ? 'no-character' : 'no-save' });
            }
            return res.status(committed.status).json({ error: committed.error });
        }
        // Return the new version: bumping it without telling the client leaves the
        // client's `_baseSaveVersion` stale, so its next autosave 409s and the
        // conflict path replaces local state with the server snapshot (progress
        // silently reverts). authFetch adopts any `_saveVersion` in a response body
        // monotonically, so including it here is enough.
        const result = 'ok' in committed.value
            ? { ...committed.value, _saveVersion: committed._saveVersion }
            : committed.value;

        if ('error' in result) return res.status(404).json({ error: result.error });
        if ('reject' in result && result.reject) {
            const rej = result.reject;
            // 409 for state conflicts (already evolved / wrong tier), 400 otherwise.
            const status = rej.code === 'max-evolved' || rej.code === 'wrong-tier' || rej.code === 'pet-is-breeding' ? 409 : 400;
            return res.status(status).json({ error: rej.message, code: rej.code });
        }
        return res.status(200).json(result);
    } catch (err) {
        if (isPlayerSaveVersionConflict(err)) return res.status(503).json(SAVE_VERSION_CONFLICT_REPLY);
        console.error('[pet/evolve]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
