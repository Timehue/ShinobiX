import { deductUsedItems } from '../pvp/claim-rewards.js';
import type {
    SoloPveCompanionUsage,
    SoloPveSession,
    SoloPveSettlementReceipt,
} from './_session.js';

export function applyCompanionUsageCost<T extends Record<string, unknown>>(
    character: T,
    usage: SoloPveCompanionUsage | undefined,
): T {
    if (!usage || !Array.isArray(character.pets)) return character;
    let changed = false;
    const pets = (character.pets as Array<Record<string, unknown>>).map((pet) => {
        if (String(pet?.id ?? '') !== usage.petId) return pet;
        const loadout = { ...(pet.loadout && typeof pet.loadout === 'object' ? pet.loadout as Record<string, unknown> : {}) };
        if (usage.pveGearId && loadout.pve === usage.pveGearId) {
            const durability = Math.max(0, Math.floor(Number(loadout.pveDurability) || 0));
            if (durability <= 0) {
                delete loadout.pve;
                delete loadout.pveDurability;
            } else {
                loadout.pveDurability = durability - 1;
            }
            changed = true;
        }
        if (usage.consumableId && loadout.consumable === usage.consumableId) {
            delete loadout.consumable;
            changed = true;
        }
        return changed ? { ...pet, loadout } : pet;
    });
    return (changed ? { ...character, pets } : character) as T;
}

/** Apply every inventory cost proven by a terminal solo session. */
export function applySoloPveUsageCosts<T extends Record<string, unknown>>(
    character: T,
    session: SoloPveSession,
): T {
    const itemCharacter = Object.keys(session.itemsUsed).length > 0
        ? deductUsedItems(character, session.itemsUsed) as T
        : character;
    return applyCompanionUsageCost(itemCharacter, session.companionUsage);
}

export function withSoloPveSettlementReceipt(
    session: SoloPveSession,
    receipt: SoloPveSettlementReceipt,
): SoloPveSession {
    if (session.status !== 'done' || !session.terminalEvidence) {
        throw new Error('Cannot settle a non-terminal solo-PvE session.');
    }
    return {
        ...session,
        settlementState: 'settled',
        terminalEvidence: {
            ...session.terminalEvidence,
            settlementState: 'settled',
            receipt,
        },
    };
}
