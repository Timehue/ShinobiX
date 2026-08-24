/*
 * Contract Hunter — the AI bounty hunter that stalks a player with a price on
 * their head. ONE pure derivation, shared by the client (WorldMap renders the
 * hunter for everyone in the sector) and the server (api/missions/_world-ai-fight
 * seals the fight it resolves), so the hunter a bystander sees, the hunter the
 * target fights, and the hunter the server settles are the same NPC.
 *
 * Everything is derived from the SHARED bounty record + the target's public
 * roster facts (level, current sector). No client-supplied field reaches the
 * server-side profile: the server re-derives this from the stored bounty board
 * and the target's validated save, and rejects a request whose id disagrees.
 */

export type ContractHunterBounty = {
    /** display name of the hunted player */
    target: string;
    /** escrowed ryo pool on this head */
    amount: number;
    /** last placement time — rotates the hunter id so a fresh bounty is a fresh hunter */
    updatedAt: number;
};

export type ContractHunterTarget = {
    name: string;
    level: number;
    /** the target's current wild sector (>= 1); 0/undefined = in a safe zone, no hunter */
    currentSector?: number;
};

export type ContractHunter = {
    /** stable id: `bounty-hunter-<target slug>-<bounty updatedAt>` */
    id: string;
    name: 'Contract Hunter';
    /** sector the hunter stands in — the target's current sector */
    sector: number;
    /** fight tier — target level + 4, plus up to +12 bounty pressure */
    level: number;
    /** AI power rank (8..18), scales with the pool */
    power: number;
    targetName: string;
    bountyAmount: number;
};

export const CONTRACT_HUNTER_NAME = 'Contract Hunter';

export function contractHunterSlug(targetName: string): string {
    return String(targetName ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32) || 'target';
}

/** Deterministic hunter id for a bounty — rotates whenever the pool changes. */
export function contractHunterIdFor(targetName: string, bounty: Pick<ContractHunterBounty, 'updatedAt'>): string {
    return `bounty-hunter-${contractHunterSlug(targetName)}-${Math.floor(Number(bounty.updatedAt) || 0)}`;
}

/** +1 level per 75k ryo on the head, capped at +12. */
export function contractHunterPressure(amount: number): number {
    return Math.min(12, Math.floor(Math.max(0, Number(amount) || 0) / 75_000));
}

/** Hunter level from the TARGET's level + the bounty pressure (1..100). */
export function contractHunterLevel(targetLevel: number, amount: number): number {
    const lvl = Number(targetLevel) || 1;
    return Math.max(1, Math.min(100, Math.round(lvl + 4 + contractHunterPressure(amount))));
}

/** AI power rank: 8 + 1 per 100k ryo, capped at 18. */
export function contractHunterPower(amount: number): number {
    return Math.min(18, 8 + Math.floor(Math.max(0, Number(amount) || 0) / 100_000));
}

/**
 * Map a bounty record + its target's roster facts to the hunter descriptor, or
 * null when no hunter should exist (no pool, or the target is in a safe zone —
 * sector 0 / unknown — where hunters never operate).
 */
export function deriveContractHunter(bounty: ContractHunterBounty, target: ContractHunterTarget): ContractHunter | null {
    const amount = Math.floor(Number(bounty.amount) || 0);
    if (amount <= 0) return null;
    const sector = Math.floor(Number(target.currentSector) || 0);
    if (!Number.isFinite(sector) || sector < 1) return null;
    return {
        id: contractHunterIdFor(target.name, bounty),
        name: CONTRACT_HUNTER_NAME,
        sector,
        level: contractHunterLevel(target.level, amount),
        power: contractHunterPower(amount),
        targetName: target.name,
        bountyAmount: amount,
    };
}

/** Case-insensitive "is this bounty on that player" (bounty targets are display names). */
export function bountyTargets(bounty: Pick<ContractHunterBounty, 'target'>, name: string): boolean {
    return String(bounty.target ?? '').trim().toLowerCase() === String(name ?? '').trim().toLowerCase();
}
