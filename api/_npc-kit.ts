/**
 * The combat kit a Cinderhold shinobi carries (owner ruling 2026-11-10: "give
 * them a kit, armor and weapons level appropriate as they grow").
 *
 * Weapons and armor already come from the roster's level bands
 * (npcGearForLevel). This adds what a player fills the other combat slots with
 * as they grow: a thrown weapon from the start, pills from level 10, a second
 * pill at 20, a smoke bomb and a better throw at 30, and a Rejuvenation Potion
 * at 40. Every id is a real catalog item, sealed into a fight exactly as a
 * player's is (sealItemCharges: thrown and combat items at the owned count, the
 * potion at its 2-a-fight cap), and played by the same /pvp/move resolver.
 *
 * The stock is rebuilt with the save every pass and never debited (an NPC's
 * fight never writes its save back), so it is a full pouch each fight, sized
 * like a prepared player's: five throws, three of each pill, two smoke bombs,
 * two potions.
 */
import type { NpcShinobi } from '../shared/npc-village-roster.js';

export type NpcKitSlot = 'thrown' | 'item1' | 'item2' | 'item3' | 'potion';
export type NpcKit = { equipment: Partial<Record<NpcKitSlot, string>>; itemStacks: Array<{ itemId: string; count: number }> };

export const NPC_KIT_COUNTS: Readonly<Record<string, number>> = Object.freeze({
    'thrown-shuriken': 5, 'thrown-senbon': 5, 'thrown-serpent-dust': 5,
    'item-attack-pill': 3, 'item-defense-pill': 3, 'item-smoke-bomb': 2, 'potion-rejuvenation': 2,
});

/** Level each slot is filled from. */
export const NPC_KIT_LEVELS: Readonly<Record<NpcKitSlot, number>> = Object.freeze({ thrown: 1, item1: 10, item2: 20, item3: 30, potion: 40 });
/** From this level an attacker throws senbon (Wound) and a trickster serpent dust (Poison). */
export const NPC_KIT_THROWN_UPGRADE_LEVEL = 30;

export function npcKitForLevel(npc: Pick<NpcShinobi, 'personality'>, level: number): NpcKit {
    const lvl = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    // The pill a shinobi reaches for first follows how it fights.
    const offensive = npc.personality === 'aggressive' || npc.personality === 'trickster';
    const firstPill = offensive ? 'item-attack-pill' : 'item-defense-pill';
    const secondPill = offensive ? 'item-defense-pill' : 'item-attack-pill';
    const thrown = lvl < NPC_KIT_THROWN_UPGRADE_LEVEL ? 'thrown-shuriken'
        : npc.personality === 'aggressive' ? 'thrown-senbon'
            : npc.personality === 'trickster' ? 'thrown-serpent-dust' : 'thrown-shuriken';
    const picks: Record<NpcKitSlot, string> = { thrown, item1: firstPill, item2: secondPill, item3: 'item-smoke-bomb', potion: 'potion-rejuvenation' };
    const equipment: NpcKit['equipment'] = {};
    for (const slot of Object.keys(NPC_KIT_LEVELS) as NpcKitSlot[]) {
        if (lvl >= NPC_KIT_LEVELS[slot]) equipment[slot] = picks[slot];
    }
    const itemStacks = Object.values(equipment).map((itemId) => ({ itemId: itemId!, count: NPC_KIT_COUNTS[itemId!] ?? 1 }));
    return { equipment, itemStacks };
}
