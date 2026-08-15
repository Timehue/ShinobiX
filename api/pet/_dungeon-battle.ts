import type { Pet } from '../_pet-sim/pet-types.js';
import type { PetDuelOutcome } from './_duel-replay.js';

export const DUNGEON_PET_BATTLE_AUTHORITY_VERSION = 1 as const;
export const DUNGEON_PET_RESULT_TTL_SECONDS = 24 * 60 * 60;

export type DungeonPetBattleBinding = {
    authorityVersion: typeof DUNGEON_PET_BATTLE_AUTHORITY_VERSION;
    runToken: string;
};

export type DungeonPetResultReceipt = DungeonPetBattleBinding & {
    playerName: string;
    battleToken: string;
    outcome: PetDuelOutcome;
    playerPetIds: string[];
    settledAt: number;
};

export const DUNGEON_RARE_BEAST_ID = 'dungeon-rare-beast';

/** The Rare Beast seal has one server-owned opponent. The client receives this
 * bounded combat snapshot and never chooses its species, stats, kit, or level. */
export function buildDungeonRareBeast(): Pet {
    return {
        id: DUNGEON_RARE_BEAST_ID,
        name: 'Sealed Rare Beast',
        element: 'Earth',
        rarity: 'rare',
        level: 55,
        xp: 0,
        maxLevel: 100,
        hp: 900,
        attack: 110,
        defense: 100,
        speed: 90,
        moveRange: 3,
        unlockedForPve: false,
        trait: 'Battleborn',
        jutsus: [
            { name: 'Relic Fang', power: 92, cooldown: 1, currentCooldown: 0, kind: 'damage' },
            { name: 'Sealed Hide', power: 70, cooldown: 3, currentCooldown: 0, kind: 'shield' },
            { name: 'Buried Ruin', power: 118, cooldown: 4, currentCooldown: 0, kind: 'crush' },
            { name: 'Warden Breaker', power: 150, cooldown: 5, currentCooldown: 0, kind: 'damage', signature: true },
        ],
    };
}

export function dungeonPetResultKey(playerName: string, battleToken: string): string {
    return `pet:dungeon-result:${playerName}:${battleToken}`;
}

export function parseDungeonPetBattleBinding(value: unknown): DungeonPetBattleBinding | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const binding = value as Partial<DungeonPetBattleBinding>;
    const runToken = typeof binding.runToken === 'string' ? binding.runToken.trim() : '';
    if (binding.authorityVersion !== DUNGEON_PET_BATTLE_AUTHORITY_VERSION
        || !/^[A-Za-z0-9_-]{8,80}$/.test(runToken)) return null;
    return { authorityVersion: DUNGEON_PET_BATTLE_AUTHORITY_VERSION, runToken };
}

export function parseDungeonPetResultReceipt(value: unknown): DungeonPetResultReceipt | null {
    const binding = parseDungeonPetBattleBinding(value);
    if (!binding || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    const receipt = value as Partial<DungeonPetResultReceipt>;
    const playerName = typeof receipt.playerName === 'string' ? receipt.playerName : '';
    const battleToken = typeof receipt.battleToken === 'string' ? receipt.battleToken : '';
    const playerPetIds = Array.isArray(receipt.playerPetIds)
        ? receipt.playerPetIds.filter((id): id is string => typeof id === 'string')
        : [];
    if (!playerName || !/^[A-Za-z0-9]+$/.test(battleToken)
        || (receipt.outcome !== 'win' && receipt.outcome !== 'loss' && receipt.outcome !== 'draw')
        || playerPetIds.length !== 1 || !playerPetIds[0]
        || !Number.isFinite(Number(receipt.settledAt)) || Number(receipt.settledAt) <= 0) return null;
    return {
        ...binding,
        playerName,
        battleToken,
        outcome: receipt.outcome,
        playerPetIds,
        settledAt: Number(receipt.settledAt),
    };
}
