"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PET_FEED_XP = exports.PET_TRAINING_FOCI = exports.PET_TRAINING_DURATIONS = void 0;
exports.petHappiness = petHappiness;
exports.gainServerPetXp = gainServerPetXp;
exports.settleFinishedTraining = settleFinishedTraining;
exports.removePetItem = removePetItem;
exports.settleServerPetExpedition = settleServerPetExpedition;
const BASE = {
    standard: { hp: 320, attack: 40, defense: 28, speed: 30, jutsuPower: 320 },
    rare: { hp: 370, attack: 48, defense: 34, speed: 36, jutsuPower: 360 },
    legendary: { hp: 416, attack: 54, defense: 38, speed: 41, jutsuPower: 405 },
    mythic: { hp: 462, attack: 60, defense: 43, speed: 45, jutsuPower: 450 },
};
exports.PET_TRAINING_DURATIONS = new Map([[900_000, 1], [3_600_000, 3], [14_400_000, 8], [28_800_000, 14]]);
exports.PET_TRAINING_FOCI = new Set(['strength', 'endurance', 'agility', 'chakra', 'bond']);
exports.PET_FEED_XP = { 'pet-treat': 100, 'elemental-pet-treat': 250, 'ancient-pet-treat': 500, 'golden-apple': 2000 };
const whole = (v, fallback = 0) => Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback;
function petHappiness(pet) {
    return Math.max(0, Math.min(100, whole(pet.happiness)));
}
function gainServerPetXp(pet, amountRaw, focus) {
    let level = Math.max(1, whole(pet.level, 1));
    const maxLevel = Math.max(level, Math.min(100, whole(pet.maxLevel, 100)));
    let xp = Math.max(0, whole(pet.xp)) + Math.max(0, whole(amountRaw));
    const grew = { hp: 0, attack: 0, defense: 0, speed: 0 };
    let levelUps = 0;
    while (level < maxLevel && xp >= Math.max(100, level * 100)) {
        xp -= Math.max(100, level * 100);
        level += 1;
        levelUps += 1;
        const channel = focus === 'strength' ? 'attack'
            : focus === 'agility' ? 'speed'
                : focus === 'endurance' ? (level % 2 === 0 ? 'hp' : 'defense')
                    : ['hp', 'attack', 'defense', 'speed'][level % 4];
        grew[channel] += 1;
    }
    if (level >= maxLevel)
        xp = 0;
    if (!levelUps)
        return { ...pet, level, xp, unlockedForPve: Boolean(pet.unlockedForPve || level >= 50) };
    const rarity = String(pet.rarity);
    const base = BASE[rarity] ?? BASE.standard;
    const nextJutsus = (Array.isArray(pet.jutsus) ? pet.jutsus : []).map((entry) => {
        if (!entry || typeof entry !== 'object')
            return entry;
        const jutsu = entry;
        const power = whole(jutsu.power);
        return { ...jutsu, power: power > 0 ? Math.min(base.jutsuPower, power + Math.ceil(levelUps / 2)) : 0 };
    });
    return {
        ...pet, level, xp, unlockedForPve: Boolean(pet.unlockedForPve || level >= 50), jutsus: nextJutsus,
        hp: Math.max(1, whole(pet.hp, 1) + Math.round(base.hp * 0.04 * grew.hp)),
        attack: Math.max(1, whole(pet.attack, 1) + Math.round(base.attack * 0.04 * grew.attack)),
        defense: Math.max(1, whole(pet.defense, 1) + Math.round(base.defense * 0.04 * grew.defense)),
        speed: Math.max(1, whole(pet.speed, 1) + Math.round(base.speed * 0.04 * grew.speed)),
    };
}
/**
 * Settle a pet's training lease IF it has finished. Returns the settled pet
 * (training removed, sealed XP applied via `gainServerPetXp`, plus the bond
 * happiness nudge) and the focus of the session that paid out — or the pet
 * UNCHANGED with `settledFocus: null` when there is no training or it is still
 * running.
 *
 * This is the single settle implementation shared by BOTH the explicit
 * `complete-training` action and the self-heal path in `start-training` (which
 * settles an orphaned-but-finished session instead of trapping the pet), so the
 * reward is identical no matter which path collects it. The XP was sealed when
 * the session started, so paying it out here is exactly what the player earned —
 * no client-supplied value is ever trusted.
 *
 * The cleared training is set to `undefined` (NOT `delete`d), matching how
 * `settleServerPetExpedition` clears `expedition`. This is load-bearing: the
 * versioned save is persisted through `mergePreservingImages`, which starts from
 * the STORED record and only overrides keys the incoming payload actually
 * contains. A `delete`d key is absent from the payload, so the stored training
 * survives the merge and the claim silently reverts on the next read ("claimed
 * but it came back"). An explicit `undefined` key IS in the payload, overrides
 * the stored value, and then drops out on JSON serialization — an unambiguous
 * idle pet that actually persists.
 */
function settleFinishedTraining(pet, now) {
    const training = pet.training;
    if (!training || now < Number(training.endsAt))
        return { pet, settledFocus: null };
    const idle = { ...pet, training: undefined };
    const settled = gainServerPetXp(idle, Math.min(5000, Math.max(0, Number(training.sealedXp) || 0)), String(training.type ?? ''));
    if (training.type === 'bond')
        settled.happiness = Math.min(100, petHappiness(settled) + 5);
    return { pet: settled, settledFocus: String(training.type ?? '') };
}
function removePetItem(character, itemId) {
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    let removed = false;
    const itemStacks = stacks.map((stack) => {
        if (removed || String(stack?.itemId ?? '') !== itemId || whole(stack?.count) <= 0)
            return stack;
        removed = true;
        return { ...stack, count: whole(stack.count) - 1 };
    }).filter((stack) => whole(stack?.count) > 0);
    if (removed)
        return { ...character, itemStacks };
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const index = inventory.findIndex((entry) => entry === itemId);
    if (index < 0)
        return null;
    return { ...character, inventory: inventory.filter((_, i) => i !== index) };
}
function settleServerPetExpedition(pet, expType, durationMinutes, xpMultiplier) {
    if (Number(pet.level) >= Number(pet.maxLevel))
        return { pet: { ...pet, expedition: undefined }, xp: 0, statGain: 0 };
    const durationHours = Math.max(1, durationMinutes / 60);
    const typeXp = expType === 'forage' ? 1.45 : expType === 'ruins' ? 1.2 : 1;
    const xp = Math.max(0, Math.round(120 * durationHours * typeXp * Math.max(0, Math.min(4, xpMultiplier))));
    const statGain = Math.max(1, Math.round(durationHours));
    const prepared = {
        ...pet,
        expedition: undefined,
        attack: whole(pet.attack, 1) + statGain,
        defense: whole(pet.defense, 1) + statGain + (expType === 'ruins' ? statGain : 0),
        speed: whole(pet.speed, 1) + (expType === 'scout' ? statGain : 0),
        hp: whole(pet.hp, 1) + statGain * 5,
    };
    return { pet: gainServerPetXp(prepared, xp), xp, statGain };
}
