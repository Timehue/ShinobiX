/*
 * Quest sites: the special nodes a quest line sends the player to.
 *
 * A quest site is real gathering (owner ruling, 2026-11-18). It is mining,
 * fishing or harvesting like any other node: it needs the right tool equipped
 * and a skill at least the site's level, it wears the tool, pays skill XP, can
 * fail, and spends the day's allowance for that activity. Nothing is waived.
 *
 * It differs from an ordinary node in two ways only. It yields a quest material
 * and nothing else. And its attempts are counted per player: an ordinary node
 * allows three attempts for the whole world and locks while one player works
 * it, so every player on the same quest step would block the next.
 *
 * Each site is a place the coast's art already painted, named by the site id in
 * shared/coast-world.json. Site levels rise by region; the levels below need
 * the owner's sign-off, because they decide how trained a gatherer must be.
 */

export type QuestSiteActivity = 'harvesting' | 'mining' | 'fishing';

export interface QuestSite {
    /** The coast site this is, as shared/coast-world.json names it. */
    id: string;
    activity: QuestSiteActivity;
    /** The gathering skill level needed to work it. */
    level: number;
    /** The quest material one success yields. */
    itemId: string;
    /**
     * The quest whose completion keeps this site open for good. A kept site is
     * a reward: a new gathering node the player has earned. It is worked by the
     * same rules after the quest as during it, and what it yields is the
     * player's to keep (isKeptQuestMaterial).
     */
    keptBy?: string;
}

/** A player may try a site this many times before it must refill for them. */
export const QUEST_SITE_ATTEMPTS = 3;
/** How long a player's own attempts at a site take to come back. Matches ordinary nodes. */
export const QUEST_SITE_REFILL_MS = 10 * 60_000;

export const QUEST_SITES: Readonly<Record<string, QuestSite>> = {
    // Saltstair Landing: level 1, the first ground a new arrival can work.
    'saltstair-harvest-102': { id: 'saltstair-harvest-102', activity: 'harvesting', level: 1, itemId: 'quest-wrack-cord', keptBy: 'boatwright-tools-1' },
    'saltstair-mine-103': { id: 'saltstair-mine-103', activity: 'mining', level: 1, itemId: 'quest-splitstone-fittings', keptBy: 'boatwright-tools-1' },
    'saltstair-harvest-106': { id: 'saltstair-harvest-106', activity: 'harvesting', level: 1, itemId: 'quest-woundroot' },
    // Brackwater Fields: still level 1. The gathering skills step 1, 4, 7, and
    // the second region is too soon to ask for the first step up.
    'brackwater-harvest-112': { id: 'brackwater-harvest-112', activity: 'harvesting', level: 1, itemId: 'quest-inkseed' },
    'brackwater-outcrop-114': { id: 'brackwater-outcrop-114', activity: 'mining', level: 1, itemId: 'quest-mirror-silt' },
    // The Boatwright's Tools II: drift timber, and the coast's first fishing site.
    'brackwater-harvest-115': { id: 'brackwater-harvest-115', activity: 'harvesting', level: 1, itemId: 'quest-pitchwood', keptBy: 'boatwright-tools-2' },
    'brackwater-fish-117': { id: 'brackwater-fish-117', activity: 'fishing', level: 1, itemId: 'quest-caulk-eel', keptBy: 'boatwright-tools-2' },
    // The Boatwright's Tools III.
    'briarwood-harvest-123': { id: 'briarwood-harvest-123', activity: 'harvesting', level: 4, itemId: 'quest-keelroot', keptBy: 'boatwright-tools-3' },
    // Briarwood Deep: level 4. From here a quest needs a trained gatherer.
    'briarwood-harvest-125': { id: 'briarwood-harvest-125', activity: 'harvesting', level: 4, itemId: 'quest-binding-thorn' },
    'briarwood-outcrop-128': { id: 'briarwood-outcrop-128', activity: 'mining', level: 4, itemId: 'quest-tether-link' },
    // Untamed Coast: one fishing pool a region, for the lure.
    'saltstair-fish-104': { id: 'saltstair-fish-104', activity: 'fishing', level: 1, itemId: 'quest-needle-fish' },
    'briarwood-fish-127': { id: 'briarwood-fish-127', activity: 'fishing', level: 4, itemId: 'quest-scent-carp' },
    'whitecrown-fish-135': { id: 'whitecrown-fish-135', activity: 'fishing', level: 4, itemId: 'quest-icebell-smelt' },
    // Hushcrown Heights: level 7, the last step (settled 2026-11-20; the owner
    // asked for the levels to be decided for the game and its players). It is
    // 1,400 skill XP: about 280 successes, or some 400 attempts when six in ten
    // succeed, in each skill from nothing (eight days of that skill's daily 50). The first
    // quest that asks for these is level 88, three weeks or more of training
    // past Whitecrown's level 75, and each skill has its own daily attempts, so
    // a shinobi who kept gathering through those weeks arrives ready. It is the
    // owner's rule that a quest waives no tool and no skill, and the finale is
    // where that rule should be felt most. To soften it, set these three to 4.
    'hushcrown-harvest-142': { id: 'hushcrown-harvest-142', activity: 'harvesting', level: 7, itemId: 'quest-windroot' },
    'hushcrown-mine-143': { id: 'hushcrown-mine-143', activity: 'mining', level: 7, itemId: 'quest-silver-grit' },
    'hushcrown-fish-145': { id: 'hushcrown-fish-145', activity: 'fishing', level: 7, itemId: 'quest-ink-loach' },
    // Whitecrown Passes: level 4, as Briarwood.
    'whitecrown-outcrop-133': { id: 'whitecrown-outcrop-133', activity: 'mining', level: 4, itemId: 'quest-emberglass' },
    'whitecrown-outcrop-139': { id: 'whitecrown-outcrop-139', activity: 'mining', level: 4, itemId: 'quest-frost-splinter' },
};

export function questSite(id: unknown): QuestSite | undefined {
    return typeof id === 'string' && Object.hasOwn(QUEST_SITES, id) ? QUEST_SITES[id] : undefined;
}

const KEPT_MATERIALS: ReadonlySet<string> = new Set(Object.values(QUEST_SITES).filter(site => site.keptBy).map(site => site.itemId));

/**
 * True for a material a kept site yields. It is never taken back when a quest
 * ends: once its site is earned, the player goes on gathering it.
 */
export function isKeptQuestMaterial(itemId: unknown): boolean {
    return typeof itemId === 'string' && KEPT_MATERIALS.has(itemId);
}

/** The equipment slot that holds the tool an activity needs. */
export const QUEST_SITE_TOOL_SLOT: Readonly<Record<QuestSiteActivity, 'kama' | 'pickaxe' | 'fishingPole'>> = {
    harvesting: 'kama',
    mining: 'pickaxe',
    fishing: 'fishingPole',
};
