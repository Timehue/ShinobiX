"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _evolution_js_1 = require("./_evolution.js");
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
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'pet-evolve', 10, 60_000, peekName))
        return;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'pet-evolve-burst', 1, EVOLVE_RATE_LIMIT_MS, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const petId = String(body.petId ?? '');
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!petId)
            return res.status(400).json({ error: 'Missing petId.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!(0, _auth_js_1.bodyNameMatchesAuth)(identity, playerName)) {
            return res.status(403).json({ error: 'Can only evolve your own pets.' });
        }
        const saveKey = `save:${playerName}`;
        const result = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            if (!record)
                return { error: 'no-save' };
            const char = record.character;
            if (!char)
                return { error: 'no-character' };
            const pets = Array.isArray(char.pets) ? char.pets : [];
            const idx = pets.findIndex((p) => String(p?.id ?? '') === petId);
            if (idx < 0)
                return { error: 'no-pet' };
            const inventory = Array.isArray(char.inventory) ? char.inventory.map(String) : [];
            const check = (0, _evolution_js_1.checkEvolve)(pets[idx], inventory);
            if (!check.ok || !check.spec || !check.line || !check.nextStage) {
                return { reject: { code: check.code ?? 'not-evolvable', message: check.message ?? 'Cannot evolve.' } };
            }
            // Consume exactly ONE of the required stone.
            const itemIdx = inventory.indexOf(check.spec.requiredItem);
            if (itemIdx < 0) {
                return { reject: { code: 'missing-item', message: `Missing required item (${check.spec.requiredItem}).` } };
            }
            const nextInventory = inventory.slice();
            nextInventory.splice(itemIdx, 1);
            const evolved = (0, _evolution_js_1.evolvePet)(pets[idx], check.nextStage, check.line);
            const nextPets = pets.slice();
            nextPets[idx] = evolved;
            const updatedChar = { ...char, pets: nextPets, inventory: nextInventory };
            const updated = { ...record, character: updatedChar };
            (0, _save_version_js_1.bumpSaveVersion)(updated);
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
            return { ok: true, pet: evolved, stage: check.nextStage };
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
    }
    catch (err) {
        console.error('[pet/evolve]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
