import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { masteryBonus } from '../_profession-mastery.js';
import { applyPetSummonCost, gainServerPetXp, PET_FEED_XP, PET_TRAINING_DURATIONS, PET_TRAINING_FOCI, removePetItem, settleFinishedTraining } from './_progress.js';
import { grantPetHappiness, petFreeInteraction, settlePetHappiness } from './_happiness.js';
import {
    PET_HAPPINESS_DAILY_PET_BUDGET,
    clampHappiness,
    petHappinessTrainingMult,
} from '../../shared/pet-happiness.js';
import { reportMissionEvent, type CompletedMissionInfo } from '../missions/_progress.js';
import { recordPetBreedingProgress, type PetBreedingProgressEvent } from './_breeding-requirements.js';
import { activeBreedingParentIds, petBusyMessage, petBusyReason } from './_pet-busy.js';
import { kv } from '../_storage.js';
import { moraleForCharacter, applyMoraleToGain } from '../_war-morale.js';
import { activeTrainingPetIds, PET_TRAINING_CAP } from '../_entitlements.js';
import { applyGrowthAllocation, resetGrowthAllocation } from './_growth.js';

function defensePetIds(defense: unknown): string[] {
    if (!defense || typeof defense !== 'object') return [];
    const pets = (defense as { pets?: unknown }).pets;
    return Array.isArray(pets)
        ? pets.map((entry) => String((entry as Record<string, unknown>)?.id ?? '')).filter(Boolean)
        : [];
}

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
        const result = await mutatePlayerSave<{ action: string; pet: Record<string, unknown> | null; settledTraining?: string | null; gearBroke?: boolean; consumableSpent?: string | null }>(playerName, async ({ character }) => {
            const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
            const index = pets.findIndex((pet) => String(pet?.id ?? '') === petId); if (index < 0) return { ok: false as const, status: 404, error: 'Pet not found.' };
            // Settle the pending bond decay BEFORE anything reads happiness. We
            // hold the save mutation lock here, so this is the authoritative
            // tick even if the owner has not re-read their save since the UTC
            // rollover — no pet action can bank a missed day.
            const pet = settlePetHappiness(pets[index], now).pet;
            let nextCharacter = character; let nextPet = pet;
            if (activeBreedingParentIds(character, now).has(petId)) {
                return { ok: false as const, status: 409, error: 'This pet is in the breeding barn until the timer completes.' };
            }
            // Set when this call paid out a finished training session (either the
            // explicit collect, or the start-training self-heal below). Drives the
            // Pet Tamer "trained a pet" mission credit + the client notice.
            let settledTraining: string | null = null;
            if (action === 'start-training') {
                if (!activeTrainingPetIds(character, pets).includes(petId)) {
                    return { ok: false as const, status: 409, error: 'Only companions in your active five-pet squad can train.' };
                }
                const durationMs = Math.floor(Number(body.durationMs)); const focus = String(body.focus ?? '');
                if (!PET_TRAINING_DURATIONS.has(durationMs) || !PET_TRAINING_FOCI.has(focus)) return { ok: false as const, status: 400, error: 'Invalid training plan.' };
                // An unclaimed expedition keeps its own collect flow (report-pet-event)
                // and a sealed reward token, so it still blocks a fresh training.
                if (pet.expedition) return { ok: false as const, status: 409, error: 'Pet is already busy.' };
                // Self-heal an ORPHANED finished training. The client only offers
                // "Collect" when ITS copy of pet.training is set; a dropped
                // start-training response, a concurrent local-state overwrite, or a
                // stale cached read can leave the client showing the idle "Start"
                // form while the server still holds a finished, unclaimed session —
                // which used to trap the pet forever (start was hard-blocked and no
                // Collect button was ever shown, and at max level the Start control
                // is disabled entirely). Settle it here instead, exactly as if the
                // player had clicked Collect first, then continue. A still-RUNNING
                // session is left untouched and still blocks — that's a valid lease.
                const settle = settleFinishedTraining(pet, now);
                if (pet.training && settle.settledFocus === null) return { ok: false as const, status: 409, error: 'Collect the previous training before starting another.' };
                settledTraining = settle.settledFocus;
                const workingPet = settle.pet;
                if (Number(workingPet.level) >= Number(workingPet.maxLevel)) {
                    // A genuinely maxed pet with nothing pending can't train. But if
                    // settling the finished session just carried it to max level,
                    // PERSIST that settle (which unsticks the pet) rather than
                    // erroring — an error would roll the settle back and re-trap it.
                    if (settle.settledFocus === null) return { ok: false as const, status: 409, error: 'Pet is fully trained.' };
                    nextPet = workingPet;
                } else {
                    const otherTraining = pets.filter((entry) => String(entry.id ?? '') !== petId && Boolean(entry.training)).length;
                    if (otherTraining >= PET_TRAINING_CAP) return { ok: false as const, status: 409, error: 'All five active training slots are occupied.' };
                    const rank = Math.max(0, Math.min(10, Number(character.professionRank) || 0));
                    const speedPct = character.profession === 'petTamer' ? Math.min(50, 10 + rank + masteryBonus(character.profession, character.masterySpec, 'petTrainTimePct')) : 0;
                    const effectiveMs = Math.max(60_000, Math.floor(durationMs * Math.max(0.5, 1 - speedPct / 100)));
                    const baseXp = PET_TRAINING_DURATIONS.get(durationMs)!;
                    // Happiness ladder: 1.15 content / 1.05 steady+restless / 1
                    // unhappy — unchanged from before — plus a 0.85 malus once a
                    // pet is neglected (shared/pet-happiness.ts).
                    const mult = (workingPet.trait === 'Loyal' ? 1.5 : 1) * petHappinessTrainingMult(clampHappiness(workingPet.happiness));
                    const masteryXp = character.profession === 'petTamer' ? masteryBonus(character.profession, character.masterySpec, 'petTrainXpPct') : 0;
                    // Village war MORALE at the SEAL. Pet training is server-settled,
                    // so the client-side multiplier this used to rely on had no seam
                    // to act on and the whole XP half of both morale windows was inert.
                    const petMorale = await moraleForCharacter(character, now);
                    const sealedXp = applyMoraleToGain(
                        Math.max(15, Math.round(baseXp * mult * (1 + masteryXp / 100))),
                        petMorale.xpMult,
                    );
                    nextPet = { ...workingPet, training: { type: focus, startedAt: now, endsAt: now + effectiveMs, durationMs, sealedXp } };
                }
            } else if (action === 'complete-training') {
                // Same settle as the start-training self-heal — one implementation,
                // so the reward is identical whether the player clicks Collect or
                // the server heals an orphaned session.
                const settle = settleFinishedTraining(pet, now);
                if (settle.settledFocus === null) return { ok: false as const, status: 409, error: 'Training is not complete.' };
                settledTraining = settle.settledFocus;
                nextPet = settle.pet;
            } else if (action === 'allocate-growth') {
                const allocation = applyGrowthAllocation(pet, body.allocation);
                if (!allocation.ok) return { ok: false as const, status: 400, error: allocation.error };
                nextPet = allocation.pet;
            } else if (action === 'reset-growth') {
                if (pet.training || pet.expedition) return { ok: false as const, status: 409, error: 'Collect this companion before changing its build.' };
                if (await kv.get(`battle-lock:${playerName}`)) return { ok: false as const, status: 409, error: 'Finish or resume your active battle before changing this build.' };
                nextPet = resetGrowthAllocation(pet);
            } else if (action === 'feed') {
                const itemId = String(body.itemId ?? ''); const xp = PET_FEED_XP[itemId]; if (!xp) return { ok: false as const, status: 400, error: 'Invalid pet food.' };
                const afterItem = removePetItem(character, itemId); if (!afterItem) return { ok: false as const, status: 409, error: 'Pet food not owned.' };
                nextCharacter = afterItem;
                nextPet = Number(pet.level) >= Number(pet.maxLevel) ? { ...pet } : gainServerPetXp(pet, xp);
                // Treats cost an item, so their +10 is NOT rationed by the daily
                // free-petting budget.
                nextPet = grantPetHappiness(nextPet, 10, now);
            } else if (action === 'pet') {
                // The free interaction IS rationed: without a cap, one click
                // would undo a decay tick that cost nothing to avoid, and the
                // whole upkeep loop would be decorative. See shared/pet-happiness.ts.
                const petted = petFreeInteraction(pet, now);
                if (!petted) {
                    return {
                        ok: false as const,
                        status: 409,
                        error: `${String(pet.nickname ?? '').trim() || String(pet.name ?? '').trim() || 'This companion'} has had all the attention it can take today — free petting gives up to +${PET_HAPPINESS_DAILY_PET_BUDGET}% a day and refills at the daily reset. Treats and bond training still raise its happiness.`,
                    };
                }
                nextPet = petted;
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
                if (itemId && itemId === current) {
                    // Re-equipping the item already in the slot is a TRUE no-op.
                    // The PVE branch below used to reset `pveDurability` to 20 on
                    // every non-empty equip, so a worn item at 1 durability was
                    // repaired for free by re-selecting it — no inventory debit,
                    // because the `itemId !== current` guard above skipped the
                    // removal. Nothing changes here: durability, inventory and the
                    // save version all stay exactly as they were, so a retried
                    // replacement (whose first attempt already landed) can neither
                    // repair nor debit a second time.
                    return { ok: true as const, character, value: { action, pet, settledTraining: null }, write: false as const };
                }
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
            } else if (action === 'summon-spend') {
                // Cost of summoning the pet into a CLIENT-RUN PvE fight (Arena /
                // story boss): one point of PVE-gear durability, the gear itself
                // once it is spent, and the battle consumable. The client used to
                // apply this to character.pets directly, but `loadout` is a
                // server-owned pet field (PET_IDENTITY_FIELDS in api/save/[name].ts),
                // so the save discarded it — PVE gear never actually wore out and
                // the consumable was never actually spent. The arithmetic lives
                // here so the ledger matches what the battle log claims.
                //
                // No sealed token: this only ever DESTROYS the caller's own
                // resources, so a replay costs the attacker, not the game. The
                // route's rate limit bounds it.
                const spend = applyPetSummonCost(pet);
                nextPet = spend.pet;
                const nextPetsSpend = pets.map((entry, i) => i === index ? nextPet : entry);
                return {
                    ok: true as const,
                    character: { ...nextCharacter, pets: nextPetsSpend },
                    value: { action, pet: nextPet, gearBroke: spend.gearBroke, consumableSpent: spend.consumableSpent },
                };
            } else if (action === 'release') {
                const [activeBattle, coliseumDefense, tacticalDefense] = await Promise.all([
                    kv.get(`battle-lock:${playerName}`),
                    kv.get(`petladder:coliseum:def:${playerName}`),
                    kv.get(`petladder:tactical:def:${playerName}`),
                ]);
                if (activeBattle) return { ok: false as const, status: 409, error: 'Finish or resume your active battle before releasing a companion.' };
                const releaseBusy = petBusyReason(character, pet, now, {
                    includeActive: false,
                    includeReserve: false,
                    assignmentIds: [...defensePetIds(coliseumDefense), ...defensePetIds(tacticalDefense)],
                });
                if (releaseBusy) return { ok: false as const, status: 409, error: petBusyMessage(releaseBusy).replace('before breeding', 'before releasing it') };
                const remaining = pets.filter((_, i) => i !== index);
                const activePetId = character.activePetId === petId ? remaining[0]?.id : character.activePetId;
                const activePetId2v2 = character.activePetId2v2 === petId ? undefined : character.activePetId2v2;
                return { ok: true as const, character: { ...character, pets: remaining, activePetId, activePetId2v2 }, value: { action, pet: null } };
            } else return { ok: false as const, status: 400, error: 'Invalid pet action.' };
            const nextPets = pets.map((entry, i) => i === index ? nextPet : entry);
            let finalizedCharacter: Record<string, unknown> = { ...nextCharacter, pets: nextPets };
            let breedingEvent: PetBreedingProgressEvent | null = null;
            if (settledTraining) {
                breedingEvent = { kind: 'training', receipt: `training:${petId}:${String((pet.training as Record<string, unknown> | undefined)?.endsAt ?? now)}` };
            } else if (action === 'feed') {
                breedingEvent = { kind: 'feed' };
            } else if (action === 'pet') {
                breedingEvent = { kind: 'pet-interaction', petElement: String(pet.element ?? '') };
            }
            if (breedingEvent) finalizedCharacter = recordPetBreedingProgress(finalizedCharacter, breedingEvent, now).character;
            return { ok: true as const, character: finalizedCharacter, value: { action, pet: nextPet, settledTraining } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        let missionsCompleted: CompletedMissionInfo[] = [];
        // A settled training earns Pet Tamer "trained a pet" credit whether it was
        // collected explicitly OR healed during a start-training attempt.
        if (Boolean(result.value.settledTraining) && result.character.profession === 'petTamer') {
            const missionResult = await reportMissionEvent({ playerName, profession: 'petTamer', kind: 'pet-tamer-pet-train' });
            missionsCompleted = missionResult.missionsCompleted;
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, missionsCompleted, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[pet/progress]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
