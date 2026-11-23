/*
 * Titles the quest lines grant. One list, so the catalogue that awards a title
 * and the registry that lets a player wear it (api/_titles-registry.ts) cannot
 * drift apart. A quest-line title is server-credited: it is written to the
 * server-owned title vault and cannot be claimed by a save.
 *
 * Settled 2026-11-20 (the owner asked for the names to be decided for the game
 * and its players). Each title says how its Hold was beaten, and only the
 * finale is a "-breaker", as a village's own finale title is. No title may
 * repeat one another system grants: "Tidebreaker" is a Legacy title, and a
 * shared name would let one system's rules decide who may wear the other's
 * (api/_titles-registry.test.ts).
 */
export const QUEST_LINE_TITLES = {
    shutteredBoat: 'Chartbearer',
    firstFooting: 'First Ashore',
    crossingWar1: 'Tideturner',
    crossingWar2: 'Unmirrored',
    crossingWar3: 'Bondcutter',
    crossingWar4: 'Rimesplitter',
    crossingWar5: 'Twofold',
    theUnmoored: 'Crownbreaker',
    // The first two quests of each side series, added 2026-11-21 when the owner asked for every quest to
    // carry one ("build the rest of them"). Each is named for the work that quest has the player do. The
    // names are the server session's choice, like the rest, and stand until the owner renames them.
    boatwrightTools1: 'Cordwinder',
    boatwrightTools2: 'Pitchhand',
    boatwrightTools3: 'Keelwright',
    uncounted1: 'Quay Shadow',
    uncounted2: 'Unlisted',
    uncounted3: 'Passwright',
    clanGate1: 'Stakedriver',
    clanGate2: 'Hallraiser',
    untamedCoast1: 'Houndcaller',
    untamedCoast2: 'Briarwood Stalker',
    untamedCoast3: 'Whitecrown Tracker',
    clanGate3: 'Landing Warden',
} as const;

export const ALL_QUEST_LINE_TITLES: readonly string[] = Object.values(QUEST_LINE_TITLES);
