import type { JutsuElement } from "./core";
import type { Pet, PetRarity } from "./pet";

export type PetBattleFighter = {
    owner: string;
    pet: Pet;
    hp: number;
    pos: number;
    attackBuff: number;
    defenseBuff: number;
    cooldowns: Record<string, number>;
    dotDamage: number;
    dotRounds: number;
    shieldHp: number;
    moveLocked: number;
    absorbRounds: number;
    absorbPercent: number;
    burnRounds: number;
    burnDamage: number;
    freezeRounds: number;
    confuseRounds: number;
    stunRounds: number;
    guardRounds: number;
    evadeRounds: number;
    braceRounds: number;
    focusReady: boolean;
    defensiveCd: number;
    woundRounds: number;
    woundDamage: number;
    markedRounds: number;
    slowRounds: number;
    hasteRounds: number;
    tauntedRounds: number;
    tauntById: string;
    consDodge?: number;
    consMitigate?: number;
    consEndure?: number;
    consThorns?: number;
    consLifeline?: number;
    consCleanse?: number;
};

export interface PetBattleRecord {
    wins?: number;
    losses?: number;
    rating?: number;
}

export type PetFrameStatus = {
    poisoned?: number;
    atkBuff?: boolean;
    defBuff?: boolean;
    shield?: number;
    moveLocked?: boolean;
    absorbing?: boolean;
    burn?: number;
    freeze?: number;
    confuse?: number;
    stun?: number;
    guarding?: boolean;
    focused?: boolean;
    evading?: boolean;
    bracing?: boolean;
    wound?: number;
    marked?: boolean;
    slow?: number;
    haste?: number;
    taunted?: boolean;
};

type PetPartyFrameSlot = {
    hp: number;
    maxHp: number;
    pos: number;
    name: string;
    rarity?: PetRarity;
    element?: JutsuElement;
    ko: boolean;
    status: {
        poisoned?: number;
        burn?: number;
        freeze?: number;
        confuse?: number;
        stun?: number;
        shield?: number;
        absorbing?: boolean;
    };
};

export type PetArenaFrame = {
    round: number;
    message: string;
    playerHp: number;
    enemyHp: number;
    playerPos: number;
    enemyPos: number;
    actor: "player" | "enemy" | "system";
    actionKind?: "damage" | "buff" | "basic" | "result" | "heal" | "debuff" | "dot" | "move" | "barrier" | "movelock" | "lifesteal" | "shield" | "absorb";
    damage?: number;
    crit?: boolean;
    traitFlash?: { actor: "player" | "enemy"; trait: string };
    combo?: number;
    isPrefight?: boolean;
    isKO?: boolean;
    signatureMove?: { name: string; petName: string; side: "player" | "enemy"; flagship?: boolean };
    playerStatus?: PetFrameStatus;
    enemyStatus?: PetFrameStatus;
    pickups?: number[];
    party4v4?: {
        playerLead: PetPartyFrameSlot;
        playerReserve: PetPartyFrameSlot;
        enemyLead: PetPartyFrameSlot;
        enemyReserve: PetPartyFrameSlot;
        actorSlot?: "playerLead" | "playerReserve" | "enemyLead" | "enemyReserve";
        targetSlot?: "playerLead" | "playerReserve" | "enemyLead" | "enemyReserve";
    };
};
