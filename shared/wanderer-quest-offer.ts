/*
 * Which errand a natural road sage offers. Shared so the server can refuse a
 * client-picked quest id (economy rebalance 2026-10, framework I-13): the
 * wanderer-quest accept recomputes the sage's one errand from its id and the
 * stored save, and the client dialog and WorldMap call the same function through
 * lib/wanderers.ts.
 *
 * ORDER IS LOAD-BEARING: the pick hashes into this list, so reordering it, or
 * adding or removing an entry, changes every sage's errand. It mirrors
 * WANDERER_QUEST_CATALOG in shinobij.client/src/lib/wanderers.ts, and
 * wanderers.test.ts pins the two together.
 */

export type WandererQuestOfferMetric = 'totalAiKills' | 'totalPetWins' | 'cardClashWins' | 'totalTilesExplored' | 'relicSurveyCount';

export const WANDERER_QUEST_OFFER_POOL: ReadonlyArray<{ readonly id: string; readonly metric: WandererQuestOfferMetric }> = [
    { id: 'wq-cull', metric: 'totalAiKills' },
    { id: 'wq-purge', metric: 'totalAiKills' },
    { id: 'wq-warpath', metric: 'totalAiKills' },
    { id: 'wq-beasts', metric: 'totalPetWins' },
    { id: 'wq-menagerie', metric: 'totalPetWins' },
    { id: 'wq-cards', metric: 'cardClashWins' },
    { id: 'wq-highroller', metric: 'cardClashWins' },
    { id: 'wq-scout', metric: 'totalTilesExplored' },
    { id: 'wq-trailblaze', metric: 'totalTilesExplored' },
    { id: 'wq-relic-survey', metric: 'relicSurveyCount' },
];

/** Quest objectives this character has no way to make progress on yet, the same
 *  content locks as lockedWandererVerbs, expressed as counters. Without this a
 *  sage could hand a pre-codex player "Win 2 Shinobi Chronicle Showdowns", which
 *  is unwinnable while the Card Hall is sealed, and it occupies their one quest
 *  slot. (The server owns the target and reward per quest id either way; this
 *  decides what gets OFFERED.) */
export function lockedQuestMetrics(
    character: { starterCardsClaimed?: unknown; pets?: unknown } | null | undefined,
): WandererQuestOfferMetric[] {
    const locked: WandererQuestOfferMetric[] = [];
    if (character?.starterCardsClaimed !== true) locked.push('cardClashWins');
    if (!(Array.isArray(character?.pets) && character.pets.length)) locked.push('totalPetWins');
    return locked;
}

/** The errand id a sage offers: deterministic from its id, drawn only from the
 *  objectives the player can progress. An all-locked pool falls back to the
 *  whole list, so a sage always has something to say. */
export function questIdForWanderer(wandererId: string, lockedMetrics?: readonly WandererQuestOfferMetric[]): string {
    const pool = lockedMetrics?.length
        ? WANDERER_QUEST_OFFER_POOL.filter((q) => !lockedMetrics.includes(q.metric))
        : WANDERER_QUEST_OFFER_POOL;
    const catalog = pool.length ? pool : WANDERER_QUEST_OFFER_POOL;
    let h = 0;
    for (let i = 0; i < wandererId.length; i++) h = (Math.imul(h, 31) + wandererId.charCodeAt(i)) >>> 0;
    return catalog[h % catalog.length].id;
}
