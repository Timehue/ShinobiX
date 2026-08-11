import { deductUsedItems } from '../pvp/claim-rewards.js';
import type {
    SoloPveCompanionUsage,
    SoloPveSession,
    SoloPveSettlementReceipt,
} from './_session.js';
import {
    hasSettledSoloPveCompanionCostAuthority,
    soloPveOutcomeReceiptRequestId,
    unsettledSoloPveItemUsage,
    usesSoloPveUsageAuthorityV1,
} from './_usage-receipts.js';

function legacyUsageAlreadyCharged(
    character: Record<string, unknown>,
    session: SoloPveSession,
): boolean {
    if (usesSoloPveUsageAuthorityV1(session)) return false;
    const requestId = soloPveOutcomeReceiptRequestId(session.sessionId);
    return Array.isArray(character.serverSettlementReceipts)
        && character.serverSettlementReceipts.some((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
            const receipt = raw as Record<string, unknown>;
            const value = receipt.value;
            return receipt.requestId === requestId
                && !!value
                && typeof value === 'object'
                && !Array.isArray(value)
                && (value as Record<string, unknown>).legacyUsageCharged === true;
        });
}

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
    if (legacyUsageAlreadyCharged(character, session)) return character;
    const usesActionAuthority = usesSoloPveUsageAuthorityV1(session);
    const unsettledItems = usesActionAuthority ? unsettledSoloPveItemUsage(session) : session.itemsUsed;
    if (unsettledItems === null) throw new Error('invalid-solo-pve-item-cost-authority');
    const itemCharacter = Object.keys(unsettledItems).length > 0
        ? deductUsedItems(character, unsettledItems) as T
        : character;
    return usesActionAuthority && hasSettledSoloPveCompanionCostAuthority(session)
        ? itemCharacter
        : applyCompanionUsageCost(itemCharacter, session.companionUsage);
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
