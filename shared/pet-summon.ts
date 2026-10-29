export const PET_SUMMON_AP_COST = 20;
export const PET_TAMER_FREE_SUMMON_RANK = 10;

type Summoner = { profession?: unknown; professionRank?: unknown };

/** Call with the authoritative owner when admitting a battle. */
export function petSummonApCost(owner?: Summoner | null): number {
    const rank = Number(owner?.professionRank);
    return owner?.profession === 'petTamer' && Number.isFinite(rank) && rank >= PET_TAMER_FREE_SUMMON_RANK
        ? 0 : PET_SUMMON_AP_COST;
}

/** Old pending summons fall back to the battle's sealed owner, never request data. */
export function sealedPetSummonApCost(companion?: { summonApCost?: unknown } | null, owner?: Summoner | null): number {
    if (companion?.summonApCost === 0) return 0;
    if (companion?.summonApCost === PET_SUMMON_AP_COST) return PET_SUMMON_AP_COST;
    return petSummonApCost(owner);
}
