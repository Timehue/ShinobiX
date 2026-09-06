/*
 * The eight Legacy Emissaries — "multiple wandering AIs that just do legacy
 * quests" (docs/legacy-assets.md §1, docs/legacy-system-plan.md §7.2). Each
 * emissary serves one or more Legacy categories and roams sectors like other
 * wanderers, but is never part of the natural roster: they synth per 6h window
 * from the WORLD clock — never from the player — so everyone standing in a
 * sector sees the same emissary (the Wandering Sage is the one per-player NPC).
 *
 * Pre-acceptance (level 40+) a rotating emissary appears with category-flavored
 * mini-quests (the same server-authoritative wanderer-quest plumbing — the
 * catalog below is mirrored in api/sector/_wanderer-quest.ts). Post-acceptance,
 * the emissary matching the player's Legacy category becomes their trial-giver:
 * an in-world face for the trial endpoint, with guidance and lore.
 */
import type { WandererQuestMetric } from "./wanderers";
import type { Wanderer } from "./wanderers";
import { wandererLevelFor, wandererHash32 as hash32, mulberry32 } from "./wanderers";

export type EmissarySlug =
    | "storm-caller-ryn" | "veil-mother-suzu" | "iron-pilgrim-daigo" | "blade-keeper-hana"
    | "duel-broker-kesshi" | "hollow-warden" | "lantern-warden-mei" | "mapless-ojii";

export interface EmissaryQuestDef {
    id: string;
    label: string;
    metric: "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored";
    target: number;
}

export interface EmissaryDef {
    slug: EmissarySlug;
    name: string;
    /** Legacy categories this emissary serves (trial-giver matching). */
    categories: string[];
    tellTint: string;
    greeting: string;
    /** Short lore beats, one shown per encounter (rotates by day window). */
    lore: string[];
    /** The line shown to a player whose trial this emissary oversees. */
    trialLine: string;
    quests: EmissaryQuestDef[];
}

export const EMISSARY_DEFS: readonly EmissaryDef[] = [
    {
        slug: "storm-caller-ryn", name: "Storm-Caller Ryn", categories: ["ninjutsu"],
        tellTint: "#60a5fa",
        greeting: "You picked a bad day for this road. The storm is an hour out, maybe less.",
        lore: [
            "I spent ten years learning to call lightning down. The trick I use most is knowing when it's coming anyway.",
            "The Split-Reed storm tore the east watch loose while I was still shouting evacuation orders. I learned to shout earlier after that.",
            "The Sage and I shared a road camp once. He asked three questions, ate half my rice, and snored through the rain. Very mysterious man.",
        ],
        trialLine: "Your trial route runs under that storm. Pack oilcloth and leave the metal pole here.",
        quests: [
            { id: "eq-storm-conduits", label: "Defeat 8 threats along Ryn's storm route", metric: "totalAiKills", target: 8 },
            { id: "eq-storm-skyward", label: "Scout 15 open-road tiles before the rain closes in", metric: "totalTilesExplored", target: 15 },
        ],
    },
    {
        slug: "veil-mother-suzu", name: "Veil-Mother Suzu", categories: ["genjutsu"],
        tellTint: "#c084fc",
        greeting: "Don't mind the moths. They're mine. Mostly.",
        lore: [
            "People call genjutsu cruel. I think it can be mercy, but anyone who says that too quickly should not be trusted with it.",
            "A canal blade took my left cheek. The porcelain repair fogs in cold weather and makes children stare. I stare back.",
            "Two reports used the same traveler's name this morning. One called them cautious, one reckless. I trust the mismatch more than either verdict.",
        ],
        trialLine: "I put a moth-mark on the first post this morning. You walked past it. This time, look twice.",
        quests: [
            { id: "eq-veil-unseen", label: "Win 5 battles along Suzu's marked route", metric: "totalAiKills", target: 5 },
            { id: "eq-veil-moths", label: "Trace 12 tiles between Suzu's moth-marked posts", metric: "totalTilesExplored", target: 12 },
        ],
    },
    {
        slug: "iron-pilgrim-daigo", name: "Iron Disciple Daigo", categories: ["taijutsu"],
        tellTint: "#f59e0b",
        greeting: "Every bead on this string is a fight I didn't need a weapon for.",
        lore: [
            "I broke my hands twice learning this. The third time, the stone broke first. Nobody sings about the first two times.",
            "The east-post road wore through three pairs of sandals. My training partner rode a cart and called it footwork. We still argue.",
            "A young man once asked me to bless his fists. I blessed his neighbors instead. He understood, eventually.",
        ],
        trialLine: "Your trial is counted in bruises the record keeper may miss. Bring the tally back; I will inspect what the page leaves out.",
        quests: [
            { id: "eq-iron-tally", label: "Defeat 10 foes and return Daigo's full tally", metric: "totalAiKills", target: 10 },
            { id: "eq-iron-road", label: "Walk 20 tiles of the lantern road", metric: "totalTilesExplored", target: 20 },
        ],
    },
    {
        slug: "blade-keeper-hana", name: "Blade-Keeper Hana", categories: ["bukijutsu"],
        tellTint: "#e2e8f0",
        greeting: "Thirty-one swords on my back. Do not touch the hilts without asking.",
        lore: [
            "People ask why thirty-one. Because the thirty-second went to someone who earned it, and I'm still deciding about the rest.",
            "Six blades need oil, two need new wraps, and one bites anyone but me. Carrying a collection is mostly maintenance.",
            "When the shrine burned, I carried the swords out two at a time. The novices carried the water. Their part was harder.",
        ],
        trialLine: "I read your trial order. The form is sound and the route is ugly. Check your edge, then go.",
        quests: [
            { id: "eq-blade-rites", label: "Fell 8 foes with a clean form Hana can inspect", metric: "totalAiKills", target: 8 },
            { id: "eq-blade-vigil", label: "Stand a vigil of 6 victories", metric: "totalAiKills", target: 6 },
        ],
    },
    {
        slug: "duel-broker-kesshi", name: "Duel-Broker Kesshi", categories: ["pvp", "cards", "war"],
        tellTint: "#f87171",
        greeting: "The red column gained three names since dawn. If you're here to wager, read who pays when you lose.",
        lore: [
            "This ledger is chained to me. Or I am chained to it. The interest compounds either way.",
            "I brokered a duel between two Kage once. The village that watched still owes me.",
            "The scribes press legends into Chronicle cards. I write the odds beside them. Between the two of us, that's history covered.",
        ],
        trialLine: "Your trial is on my books, shinobi. The odds beside your name are better than I expected.",
        quests: [
            { id: "eq-broker-ledger", label: "Win 4 Chronicle Showdowns for the ledger", metric: "cardClashWins", target: 4 },
            { id: "eq-broker-debts", label: "Collect 8 battle debts owed to Kesshi", metric: "totalAiKills", target: 8 },
        ],
    },
    {
        slug: "hollow-warden", name: "The Hollow Warden", categories: ["pve", "mythic"],
        tellTint: "#4ade80",
        greeting: "The lower vents carry voices up here. Speak softly unless you want an answer.",
        lore: [
            "This mask was cut from animal bone before I took this post. The scratches came later.",
            "I was here when the Gate rebuilt a Kage dead for generations from an old intake record. We had no word for the result then. Now we call it a Hollow.",
            "The Hollow below does not hate you. It repeats whatever the old intake taught it. Learn the pattern before you step close.",
        ],
        trialLine: "Your trial reaches an old intake floor. I will watch the boundary and pull you out if it breaks.",
        quests: [
            { id: "eq-hollow-toll", label: "Pay the threshold's toll: 10 foes", metric: "totalAiKills", target: 10 },
            { id: "eq-hollow-depths", label: "Chart 18 tiles toward the deep places", metric: "totalTilesExplored", target: 18 },
        ],
    },
    {
        slug: "lantern-warden-mei", name: "Lantern-Warden Mei", categories: ["support", "village"],
        tellTint: "#fbbf24",
        greeting: "Shield in one hand, lantern in the other. Guess which one has saved more lives.",
        lore: [
            "My pack has splints, lamp oil, two door braces, and no spare room. If you need saving, try to be a small emergency.",
            "The lantern has gone out exactly once. I do not talk about that night, and neither does the village that is still here.",
            "I trained as a medic first. Turns out most wounds are easier to prevent from the front row.",
        ],
        trialLine: "Your trial is village work: long rounds, tired people, and no applause. Check the lamp oil before you go.",
        quests: [
            { id: "eq-lantern-rounds", label: "Walk 14 tiles of Mei's lantern rounds", metric: "totalTilesExplored", target: 14 },
            { id: "eq-lantern-watch", label: "Turn back 6 threats to the village", metric: "totalAiKills", target: 6 },
        ],
    },
    {
        slug: "mapless-ojii", name: "Mapless Ojii", categories: ["explorer", "pets"],
        tellTint: "#7be0a3",
        greeting: "This map is blank because the north flood moved the road again. Give me a minute.",
        lore: [
            "I drew the finest map of the north road. Then a flood moved the river and three merchants blamed my ink. I stopped promising permanence.",
            "Every beast I ever followed knew a road no cartographer did. So I stopped following cartographers.",
            "I watched a beast take three straight at the coliseum, then walk its tamer home like the tamer was the pet. The scribes gave it a card. It had earned one.",
        ],
        trialLine: "Your trial starts beyond my last reliable marker. Take chalk, mark the return turns, and do not trust the stream crossing.",
        quests: [
            { id: "eq-mapless-edges", label: "Scout 25 tiles past the map's edge", metric: "totalTilesExplored", target: 25 },
            { id: "eq-mapless-companions", label: "Win 3 pet duels while Ojii studies your handling", metric: "totalPetWins", target: 3 },
        ],
    },
];

export const EMISSARY_BY_SLUG: ReadonlyMap<EmissarySlug, EmissaryDef> =
    new Map(EMISSARY_DEFS.map((d) => [d.slug, d]));

/** The emissary serving a Legacy category (every category has exactly one). */
export function emissaryForCategory(category: string | null | undefined): EmissaryDef | null {
    if (!category) return null;
    return EMISSARY_DEFS.find((d) => d.categories.includes(category)) ?? null;
}

/** Emissary quest lookup for the shared activeWandererQuest slot. */
export function emissaryQuestById(id: string): EmissaryQuestDef | null {
    for (const d of EMISSARY_DEFS) for (const q of d.quests) if (q.id === id) return q;
    return null;
}

/** The emissary who GAVE a quest — for attribution in the Mission journal. */
export function emissaryByQuestId(id: string): EmissaryDef | null {
    for (const d of EMISSARY_DEFS) if (d.quests.some((q) => q.id === id)) return d;
    return null;
}

/**
 * Progress-line nouns. Keyed by the WANDERER metric union (a superset of the
 * emissary one) because the wanderer dialog resolves both catalogs through this
 * single map — typing it to the narrower union let a new wanderer metric compile
 * while rendering "undefined" to the player.
 */
export const EMISSARY_METRIC_LABELS: Record<WandererQuestMetric, string> = {
    totalAiKills: "foes defeated",
    totalPetWins: "pet duels won",
    cardClashWins: "card rounds won",
    totalTilesExplored: "tiles scouted",
    // Not an emissary errand, but the wanderer dialog resolves BOTH catalogs
    // through this map — a missing entry renders "Progress: 2 / 5 undefined".
    relicSurveyCount: "countries walked",
};

/** Stable wanderer-id prefix the WorldMap dialog keys off. */
export const EMISSARY_WANDERER_PREFIX = "legacy-emissary-";

/** Minimum level before emissaries start appearing (the pre-Sage hint arc). */
export const EMISSARY_MIN_LEVEL = 40;

const GRID = 12;
const SECTOR_COUNT = 60;
/** Fraction of 6h windows in which the player's emissary is out roaming. */
const EMISSARY_SPAWN_CHANCE = 0.55;
/** Pre-acceptance: chance the roaming harbinger crosses a given sector the
 *  player enters (per 6h window). Before the 2026-07 balance pass they hid in
 *  ONE unhinted sector of 59 — effectively never met organically. */
const EMISSARY_ROAM_SECTOR_CHANCE = 0.12;

export interface EmissarySpawn {
    def: EmissaryDef;
    sector: number;
    wanderer: Wanderer;
}

/**
 * Where (and whether) an emissary roams in this 6h window. Deterministic from
 * (dayBucket) and, for the roaming harbinger, (sector, dayBucket) — NOT from the
 * player: `playerName` only decides eligibility (an empty name = no account), so
 * two players in the same sector always see the same emissary. No server
 * round-trip, no flicker — the same pattern as the natural wanderer roster.
 *
 * Post-acceptance the player's own category emissary walks a FIXED sector for
 * the window (the Legacy panel's "last seen in…" hint points there, so it must
 * stay deterministic per window). Pre-acceptance (level 40+) the eight take
 * turns as a ROAMING harbinger instead: with no hint pointing at them, a fixed
 * 1-of-59 sector meant players never met one — now the window's emissary
 * occasionally crosses whatever sector the player enters (`currentSector` +
 * a per-sector presence gate), which is what the rumor promises: "find the
 * right one and it finds you back."
 */
export function rollEmissarySpawn(
    playerName: string,
    level: number,
    legacyCategory: string | null,
    dayBucket: number,
    currentSector?: number | null,
): EmissarySpawn | null {
    if (!playerName || level < EMISSARY_MIN_LEVEL) return null;
    const rng = mulberry32(hash32(`emissary#${dayBucket}`));
    if (rng() > EMISSARY_SPAWN_CHANCE) return null;

    // The random-def draw ALWAYS happens so rng consumption is identical with
    // and without a resolved category — otherwise the world map (async-fetched
    // category) and the panel hint (server truth) would place the emissary in
    // different sectors whenever the fetch lagged (verification finding).
    const randomDef = EMISSARY_DEFS[Math.floor(rng() * EMISSARY_DEFS.length)];
    const categoryDef = emissaryForCategory(legacyCategory);
    const def = categoryDef ?? randomDef;
    let sector = 1 + Math.floor(rng() * (SECTOR_COUNT - 1)); // 1..59 (always drawn: rng parity)
    if (!categoryDef) {
        // Pre-acceptance roaming branch — only meaningful on the world map,
        // where the caller supplies the sector being viewed.
        if (currentSector == null || currentSector < 1) return null;
        const gate = mulberry32(hash32(`emissary-roam#${def.slug}#${currentSector}#${dayBucket}`))();
        if (gate > EMISSARY_ROAM_SECTOR_CHANCE) return null;
        sector = currentSector;
    }

    const col = 2 + Math.floor(rng() * 8);
    const row = 2 + Math.floor(rng() * 8);
    const home = row * GRID + col;
    const waypoints = [home];
    for (let i = 0; i < 2; i++) {
        const nc = Math.max(1, Math.min(10, col + (Math.floor(rng() * 5) - 2)));
        const nr = Math.max(1, Math.min(10, row + (Math.floor(rng() * 5) - 2)));
        waypoints.push(nr * GRID + nc);
    }

    return {
        def,
        sector,
        wanderer: {
            id: `${EMISSARY_WANDERER_PREFIX}${def.slug}`,
            name: def.name,
            archetype: def.slug,
            verb: "legacyQuest",
            level: wandererLevelFor(sector, rng),
            homeTile: home,
            waypoints: Array.from(new Set(waypoints)),
            greeting: def.greeting,
            tellTint: def.tellTint,
            avatarKey: def.slug,
        },
    };
}

/** The lore beat an emissary shares this window (rotates on the 6h clock). */
export function emissaryLoreLine(def: EmissaryDef, dayBucket: number): string {
    return def.lore[((dayBucket % def.lore.length) + def.lore.length) % def.lore.length];
}
