import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { masteryBonus } from '../_profession-mastery.js';
import { gainServerPetXp, petHappiness, PET_FEED_XP, PET_TRAINING_DURATIONS, PET_TRAINING_FOCI, removePetItem } from './_progress.js';
import { reportMissionEvent, type CompletedMissionInfo } from '../missions/_progress.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const action = String(body.action ?? ''); const petId = String(body.petId ?? '').slice(0, 64);
        if (!playerName || !petId) return res.status(400).json({ error: 'Invalid player or pet.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only update your own pet.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-progress', 30, 60_000, identity.name))) return;
        const now = Date.now();
        const result = await mutatePlayerSave<{ action: string; pet: Record<string, unknown> | null }>(playerName, ({ character }) => {
            const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
            const index = pets.findIndex((pet) => String(pet?.id ?? '') === petId); if (index < 0) return { ok: false as const, status: 404, error: 'Pet not found.' };
            const pet = pets[index]; let nextCharacter = character; let nextPet = pet;
            if (action === 'start-training') {
                const durationMs = Math.floor(Number(body.durationMs)); const focus = String(body.focus ?? '');
                if (!PET_TRAINING_DURATIONS.has(durationMs) || !PET_TRAINING_FOCI.has(focus)) return { ok: false as const, status: 400, error: 'Invalid training plan.' };
                // Finished training remains claimable until complete-training
                // removes it. Do not let a second start overwrite that reward.
                if (pet.expedition || pet.training) return { ok: false as const, status: 409, error: pet.training ? 'Collect the previous training before starting another.' : 'Pet is already busy.' };
                if (Number(pet.level) >= Number(pet.maxLevel)) return { ok: false as const, status: 409, error: 'Pet is fully trained.' };
                const rank = Math.max(0, Math.min(10, Number(character.professionRank) || 0));
                const speedPct = character.profession === 'petTamer' ? Math.min(50, 10 + rank + masteryBonus(character.profession, character.masterySpec, 'petTrainTimePct')) : 0;
                const effectiveMs = Math.max(60_000, Math.floor(durationMs * Math.max(0.5, 1 - speedPct / 100)));
                const mult = PET_TRAINING_DURATIONS.get(durationMs)! * (pet.trait === 'Loyal' ? 1.5 : 1) * (petHappiness(pet) >= 80 ? 1.15 : petHappiness(pet) >= 50 ? 1.05 : 1);
                const masteryXp = character.profession === 'petTamer' ? masteryBonus(character.profession, character.masterySpec, 'petTrainXpPct') : 0;
                const sealedXp = Math.max(15, Math.round(45 * mult * (1 + masteryXp / 100) * (focus === 'bond' ? 1.35 : 1)));
                nextPet = { ...pet, training: { type: focus, startedAt: now, endsAt: now + effectiveMs, durationMs, sealedXp } };
            } else if (action === 'complete-training') {
                const training = pet.training as Record<string, unknown> | undefined;
                if (!training || now < Number(training.endsAt)) return { ok: false as const, status: 409, error: 'Training is not complete.' };
                // Remove the property rather than persisting `training:
                // undefined`. That gives every storage adapter and the client an
                // unambiguous idle pet, so the next session can start immediately.
                const idlePet = { ...pet };
                delete idlePet.training;
                nextPet = gainServerPetXp(idlePet, Math.min(5000, Math.max(0, Number(training.sealedXp) || 0)), String(training.type ?? ''));
                if (training.type === 'bond') nextPet.happiness = Math.min(100, petHappiness(nextPet) + 5);
            } else if (action === 'feed') {
                const itemId = String(body.itemId ?? ''); const xp = PET_FEED_XP[itemId]; if (!xp) return { ok: false as const, status: 400, error: 'Invalid pet food.' };
                if (Number(pet.level) >= Number(pet.maxLevel)) return { ok: false as const, status: 409, error: 'Pet is already max level.' };
                const afterItem = removePetItem(character, itemId); if (!afterItem) return { ok: false as const, status: 409, error: 'Pet food not owned.' };
                nextCharacter = afterItem; nextPet = gainServerPetXp(pet, xp); nextPet.happiness = Math.min(100, petHappiness(nextPet) + 10);
            } else if (action === 'pet') {
                nextPet = { ...pet, happiness: Math.min(100, petHappiness(pet) + 10) };
            } else if (action === 'nickname') {
                const nickname = String(body.nickname ?? '').trim().slice(0, 24); if (!nickname) return { ok: false as const, status: 400, error: 'Nickname required.' };
                const shards = Math.max(0, Number(character.fateShards) || 0); if (shards < 10) return { ok: false as const, status: 409, error: 'Need 10 Fate Shards.' };
                nextCharacter = { ...character, fateShards: shards - 10 }; nextPet = { ...pet, nickname };
            } else if (action === 'equip') {
                const slot = String(body.slot ?? '');
                if (!['collar', 'pvp', 'pve', 'consumable'].includes(slot)) return { ok: false as const, status: 400, error: 'Invalid pet equipment slot.' };
                const itemId = typeof body.itemId === 'string' && body.itemId ? body.itemId.slice(0, 80) : undefined;
                const loadout = { ...(pet.loadout && typeof pet.loadout === 'object' ? pet.loadout as Record<string, unknown> : {}) };
                const current = typeof loadout[slot] === 'string' ? String(loadout[slot]) : undefined;
                if (itemId && itemId !== current) {
                    const owned = removePetItem(character, itemId);
                    if (!owned) return { ok: false as const, status: 409, error: 'Pet equipment is not owned.' };
                    if (slot === 'pve' || slot === 'consumable') nextCharacter = owned;
                }
                if (slot === 'consumable' && current && current !== itemId) {
                    const inventory = Array.isArray(nextCharacter.inventory) ? nextCharacter.inventory as unknown[] : [];
                    nextCharacter = { ...nextCharacter, inventory: [...inventory, current] };
                }
                if (itemId) loadout[slot] = itemId; else delete loadout[slot];
                if (slot === 'pve') { if (itemId) loadout.pveDurability = 20; else delete loadout.pveDurability; }
                nextPet = { ...pet, loadout };
            } else if (action === 'release') {
                const remaining = pets.filter((_, i) => i !== index);
                const activePetId = character.activePetId === petId ? remaining[0]?.id : character.activePetId;
                const activePetId2v2 = character.activePetId2v2 === petId ? undefined : character.activePetId2v2;
                return { ok: true as const, character: { ...character, pets: remaining, activePetId, activePetId2v2 }, value: { action, pet: null } };
            } else return { ok: false as const, status: 400, error: 'Invalid pet action.' };
            const nextPets = pets.map((entry, i) => i === index ? nextPet : entry);
            return { ok: true as const, character: { ...nextCharacter, pets: nextPets }, value: { action, pet: nextPet } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        let missionsCompleted: CompletedMissionInfo[] = [];
        if (action === 'complete-training' && result.character.profession === 'petTamer') {
            const missionResult = await reportMissionEvent({ playerName, profession: 'petTamer', kind: 'pet-tamer-pet-train' });
            missionsCompleted = missionResult.missionsCompleted;
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, missionsCompleted, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[pet/progress]', error); return res.status(500).json({ error: 'Internal server error.' }); }
}
