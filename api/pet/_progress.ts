import { normalizePetGrowth } from './_growth.js';
import { PET_EXPEDITION_TYPES, petExpeditionBasePetXp, type PetExpeditionType } from '../../shared/pet-expedition-contract.js';

const JUTSU_POWER_CAP: Record<string, number> = { standard: 320, rare: 360, legendary: 405, mythic: 450 };

/** Duration => sealed base XP. Longer timers are increasingly efficient. */
export const PET_TRAINING_DURATIONS = new Map([[900_000, 30], [3_600_000, 110], [14_400_000, 400], [28_800_000, 760]]);
// New sessions use one neutral timer. settleFinishedTraining still accepts any
// already-stored legacy type because the reward is sealed XP and focus-neutral.
export const PET_TRAINING_FOCI = new Set(['bond']);
export const PET_FEED_XP: Record<string, number> = { 'pet-treat': 100, 'elemental-pet-treat': 250, 'ancient-pet-treat': 500, 'golden-apple': 2000 };

const whole = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback;

export function petHappiness(pet: Record<string, unknown>): number {
    return Math.max(0, Math.min(100, whole(pet.happiness)));
}

export function gainServerPetXp(petRaw: Record<string, unknown>, amountRaw: unknown, _focus?: string): Record<string, unknown> {
    const pet = normalizePetGrowth(petRaw);
    let level = Math.max(1, whole(pet.level, 1));
    const maxLevel = Math.max(level, Math.min(100, whole(pet.maxLevel, 100)));
    let xp = Math.max(0, whole(pet.xp)) + Math.max(0, whole(amountRaw));
    const oldLevel = level;
    while (level < maxLevel && xp >= Math.max(100, level * 100)) {
        xp -= Math.max(100, level * 100);
        level += 1;
    }
    if (level >= maxLevel) xp = 0;
    if (level === oldLevel) return normalizePetGrowth({ ...pet, level, xp, unlockedForPve: Boolean(pet.unlockedForPve || level >= 50) });
    // Milestone delta, rather than ceil(batchSize / 2), makes jutsu growth
    // identical whether two levels arrive from one reward or two separate ones.
    const jutsuPowerGain = Math.floor(level / 2) - Math.floor(oldLevel / 2);
    const jutsuPowerCap = JUTSU_POWER_CAP[String(pet.rarity)] ?? JUTSU_POWER_CAP.standard;
    const nextJutsus = (Array.isArray(pet.jutsus) ? pet.jutsus : []).map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const jutsu = entry as Record<string, unknown>;
        const power = whole(jutsu.power);
        return { ...jutsu, power: power > 0 ? Math.min(jutsuPowerCap, power + jutsuPowerGain) : 0 };
    });
    return normalizePetGrowth({
        ...pet, level, xp, unlockedForPve: Boolean(pet.unlockedForPve || level >= 50), jutsus: nextJutsus,
    });
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
export function settleFinishedTraining(pet: Record<string, unknown>, now: number): { pet: Record<string, unknown>; settledFocus: string | null } {
    const training = pet.training as Record<string, unknown> | undefined;
    if (!training || now < Number(training.endsAt)) return { pet, settledFocus: null };
    const idle = { ...pet, training: undefined };
    const settled = gainServerPetXp(idle, Math.min(5000, Math.max(0, Number(training.sealedXp) || 0)), String(training.type ?? ''));
    if (training.type === 'bond') settled.happiness = Math.min(100, petHappiness(settled) + 5);
    return { pet: settled, settledFocus: String(training.type ?? '') };
}

export function removePetItem(character: Record<string, unknown>, itemId: string): Record<string, unknown> | null {
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    let removed = false;
    const itemStacks = stacks.map((stack) => {
        if (removed || String(stack?.itemId ?? '') !== itemId || whole(stack?.count) <= 0) return stack;
        removed = true;
        return { ...stack, count: whole(stack.count) - 1 };
    }).filter((stack) => whole(stack?.count) > 0);
    if (removed) return { ...character, itemStacks };
    const inventory = Array.isArray(character.inventory) ? character.inventory as unknown[] : [];
    const index = inventory.findIndex((entry) => entry === itemId);
    if (index < 0) return null;
    return { ...character, inventory: inventory.filter((_, i) => i !== index) };
}

export function settleServerPetExpedition(pet: Record<string, unknown>, expType: string, durationMinutes: number, xpMultiplier: number): { pet: Record<string, unknown>; xp: number; statGain: number } {
    if (Number(pet.level) >= Number(pet.maxLevel)) return { pet: { ...pet, expedition: undefined }, xp: 0, statGain: 0 };
    const type = PET_EXPEDITION_TYPES.includes(expType as PetExpeditionType) ? expType as PetExpeditionType : 'scout';
    const canonicalBaseXp = petExpeditionBasePetXp(type);
    // Legacy leases may carry non-canonical durations. Keep their historical
    // scaling while all current routes read the shared canonical base.
    const canonicalMinutes = type === 'scout' ? 45 : type === 'forage' ? 120 : 240;
    const durationScale = Math.max(0, Math.min(1, durationMinutes / canonicalMinutes));
    const xp = Math.max(0, Math.round(canonicalBaseXp * durationScale * Math.max(0, Math.min(4, xpMultiplier))));
    const prepared = {
        ...pet,
        expedition: undefined,
    };
    return { pet: gainServerPetXp(prepared, xp), xp, statGain: 0 };
}

/**
 * Apply the cost of summoning a pet into a CLIENT-RUN PvE fight (Arena / story
 * boss): tick one point off the PVE gear's durability, break the gear once it is
 * spent, and consume the battle consumable.
 *
 * Pure so the ledger the endpoint writes is unit-testable. `loadout` is a
 * server-owned pet field (PET_IDENTITY_FIELDS in api/save/[name].ts), so the
 * client's local copy of this arithmetic is only a display mirror — this is the
 * authority. Returns the flags the caller needs for its response.
 */
export function applyPetSummonCost(pet: Record<string, unknown>): {
    pet: Record<string, unknown>;
    gearBroke: boolean;
    consumableSpent: string | null;
} {
    const loadout = { ...(pet.loadout && typeof pet.loadout === 'object' ? pet.loadout as Record<string, unknown> : {}) };
    const pveId = typeof loadout.pve === 'string' ? loadout.pve : undefined;
    const durability = Math.max(0, Math.floor(Number(loadout.pveDurability) || 0));
    let gearBroke = false;
    if (pveId && durability <= 0) {
        delete loadout.pve;
        delete loadout.pveDurability;
        gearBroke = true;
    } else if (pveId) {
        loadout.pveDurability = durability - 1;
    }
    const consumableSpent = typeof loadout.consumable === 'string' ? loadout.consumable : null;
    if (consumableSpent) delete loadout.consumable;
    return { pet: { ...pet, loadout }, gearBroke, consumableSpent };
}
