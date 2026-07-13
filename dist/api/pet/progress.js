"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
const _progress_js_1 = require("./_progress.js");
const _progress_js_2 = require("../missions/_progress.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        const petId = String(body.petId ?? '').slice(0, 64);
        if (!playerName || !petId)
            return res.status(400).json({ error: 'Invalid player or pet.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only update your own pet.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-progress', 30, 60_000, identity.name)))
            return;
        const now = Date.now();
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const pets = Array.isArray(character.pets) ? character.pets : [];
            const index = pets.findIndex((pet) => String(pet?.id ?? '') === petId);
            if (index < 0)
                return { ok: false, status: 404, error: 'Pet not found.' };
            const pet = pets[index];
            let nextCharacter = character;
            let nextPet = pet;
            if (action === 'start-training') {
                const durationMs = Math.floor(Number(body.durationMs));
                const focus = String(body.focus ?? '');
                if (!_progress_js_1.PET_TRAINING_DURATIONS.has(durationMs) || !_progress_js_1.PET_TRAINING_FOCI.has(focus))
                    return { ok: false, status: 400, error: 'Invalid training plan.' };
                if (pet.expedition || (pet.training && now < Number(pet.training.endsAt)))
                    return { ok: false, status: 409, error: 'Pet is already busy.' };
                if (Number(pet.level) >= Number(pet.maxLevel))
                    return { ok: false, status: 409, error: 'Pet is fully trained.' };
                const rank = Math.max(0, Math.min(10, Number(character.professionRank) || 0));
                const speedPct = character.profession === 'petTamer' ? Math.min(50, 10 + rank + (0, _profession_mastery_js_1.masteryBonus)(character.profession, character.masterySpec, 'petTrainTimePct')) : 0;
                const effectiveMs = Math.max(60_000, Math.floor(durationMs * Math.max(0.5, 1 - speedPct / 100)));
                const mult = _progress_js_1.PET_TRAINING_DURATIONS.get(durationMs) * (pet.trait === 'Loyal' ? 1.5 : 1) * ((0, _progress_js_1.petHappiness)(pet) >= 80 ? 1.15 : (0, _progress_js_1.petHappiness)(pet) >= 50 ? 1.05 : 1);
                const masteryXp = character.profession === 'petTamer' ? (0, _profession_mastery_js_1.masteryBonus)(character.profession, character.masterySpec, 'petTrainXpPct') : 0;
                const sealedXp = Math.max(15, Math.round(45 * mult * (1 + masteryXp / 100) * (focus === 'bond' ? 1.35 : 1)));
                nextPet = { ...pet, training: { type: focus, startedAt: now, endsAt: now + effectiveMs, durationMs, sealedXp } };
            }
            else if (action === 'complete-training') {
                const training = pet.training;
                if (!training || now < Number(training.endsAt))
                    return { ok: false, status: 409, error: 'Training is not complete.' };
                nextPet = (0, _progress_js_1.gainServerPetXp)({ ...pet, training: undefined }, Math.min(5000, Math.max(0, Number(training.sealedXp) || 0)), String(training.type ?? ''));
                if (training.type === 'bond')
                    nextPet.happiness = Math.min(100, (0, _progress_js_1.petHappiness)(nextPet) + 5);
            }
            else if (action === 'feed') {
                const itemId = String(body.itemId ?? '');
                const xp = _progress_js_1.PET_FEED_XP[itemId];
                if (!xp)
                    return { ok: false, status: 400, error: 'Invalid pet food.' };
                if (Number(pet.level) >= Number(pet.maxLevel))
                    return { ok: false, status: 409, error: 'Pet is already max level.' };
                const afterItem = (0, _progress_js_1.removePetItem)(character, itemId);
                if (!afterItem)
                    return { ok: false, status: 409, error: 'Pet food not owned.' };
                nextCharacter = afterItem;
                nextPet = (0, _progress_js_1.gainServerPetXp)(pet, xp);
                nextPet.happiness = Math.min(100, (0, _progress_js_1.petHappiness)(nextPet) + 10);
            }
            else if (action === 'pet') {
                nextPet = { ...pet, happiness: Math.min(100, (0, _progress_js_1.petHappiness)(pet) + 10) };
            }
            else if (action === 'nickname') {
                const nickname = String(body.nickname ?? '').trim().slice(0, 24);
                if (!nickname)
                    return { ok: false, status: 400, error: 'Nickname required.' };
                const shards = Math.max(0, Number(character.fateShards) || 0);
                if (shards < 10)
                    return { ok: false, status: 409, error: 'Need 10 Fate Shards.' };
                nextCharacter = { ...character, fateShards: shards - 10 };
                nextPet = { ...pet, nickname };
            }
            else if (action === 'equip') {
                const slot = String(body.slot ?? '');
                if (!['collar', 'pvp', 'pve', 'consumable'].includes(slot))
                    return { ok: false, status: 400, error: 'Invalid pet equipment slot.' };
                const itemId = typeof body.itemId === 'string' && body.itemId ? body.itemId.slice(0, 80) : undefined;
                const loadout = { ...(pet.loadout && typeof pet.loadout === 'object' ? pet.loadout : {}) };
                const current = typeof loadout[slot] === 'string' ? String(loadout[slot]) : undefined;
                if (itemId && itemId !== current) {
                    const owned = (0, _progress_js_1.removePetItem)(character, itemId);
                    if (!owned)
                        return { ok: false, status: 409, error: 'Pet equipment is not owned.' };
                    if (slot === 'pve' || slot === 'consumable')
                        nextCharacter = owned;
                }
                if (slot === 'consumable' && current && current !== itemId) {
                    const inventory = Array.isArray(nextCharacter.inventory) ? nextCharacter.inventory : [];
                    nextCharacter = { ...nextCharacter, inventory: [...inventory, current] };
                }
                if (itemId)
                    loadout[slot] = itemId;
                else
                    delete loadout[slot];
                if (slot === 'pve') {
                    if (itemId)
                        loadout.pveDurability = 20;
                    else
                        delete loadout.pveDurability;
                }
                nextPet = { ...pet, loadout };
            }
            else if (action === 'release') {
                const remaining = pets.filter((_, i) => i !== index);
                const activePetId = character.activePetId === petId ? remaining[0]?.id : character.activePetId;
                const activePetId2v2 = character.activePetId2v2 === petId ? undefined : character.activePetId2v2;
                return { ok: true, character: { ...character, pets: remaining, activePetId, activePetId2v2 }, value: { action, pet: null } };
            }
            else
                return { ok: false, status: 400, error: 'Invalid pet action.' };
            const nextPets = pets.map((entry, i) => i === index ? nextPet : entry);
            return { ok: true, character: { ...nextCharacter, pets: nextPets }, value: { action, pet: nextPet } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        let missionsCompleted = [];
        if (action === 'complete-training' && result.character.profession === 'petTamer') {
            const missionResult = await (0, _progress_js_2.reportMissionEvent)({ playerName, profession: 'petTamer', kind: 'pet-tamer-pet-train' });
            missionsCompleted = missionResult.missionsCompleted;
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, missionsCompleted, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[pet/progress]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
