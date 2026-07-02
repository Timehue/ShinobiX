/*
 * The eight Legacy Emissaries — "multiple wandering AIs that just do legacy
 * quests" (docs/legacy-assets.md §1, docs/legacy-system-plan.md §7.2). Each
 * emissary serves one or more Legacy categories and roams sectors like other
 * wanderers, but is never part of the natural roster: they synth per-player,
 * deterministically per 6h window, like the Wandering Sage.
 *
 * Pre-acceptance (level 40+) a rotating emissary appears with category-flavored
 * mini-quests (the same server-authoritative wanderer-quest plumbing — the
 * catalog below is mirrored in api/sector/_wanderer-quest.ts). Post-acceptance,
 * the emissary matching the player's Legacy category becomes their trial-giver:
 * an in-world face for the trial endpoint, with guidance and lore.
 */
import type { Wanderer } from "./wanderers";
import { wandererLevelFor } from "./wanderers";

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
        greeting: "The clouds told me you were coming. They rarely bother.",
        lore: [
            "Ninjutsu is not shouting at the sky. It is asking, in the sky's own grammar.",
            "I have stood inside four storms that had names. Two of them learned mine.",
            "The Sage and I walked together once. He watches paths. I watch weather. Same work.",
        ],
        trialLine: "Your trial sits in the wind ahead of you. I can read you its shape — walking it is yours.",
        quests: [
            { id: "eq-storm-conduits", label: "Strike down 8 foes while the storm watches", metric: "totalAiKills", target: 8 },
            { id: "eq-storm-skyward", label: "Scout 15 tiles beneath open sky", metric: "totalTilesExplored", target: 15 },
        ],
    },
    {
        slug: "veil-mother-suzu", name: "Veil-Mother Suzu", categories: ["genjutsu"],
        tellTint: "#c084fc",
        greeting: "Do not mind the moths. They mind you, and that is different.",
        lore: [
            "A genjutsu is a small mercy: the enemy's last moments, spent somewhere kinder.",
            "Half my face is porcelain. Guess which half the world believes.",
            "The moths carry what people almost said. It is heavier than what they say.",
        ],
        trialLine: "Your trial is already happening in the space between what you do and what they see. Continue.",
        quests: [
            { id: "eq-veil-unseen", label: "Win 5 battles without losing her moths' sight", metric: "totalAiKills", target: 5 },
            { id: "eq-veil-moths", label: "Trace 12 tiles by lantern-moth light", metric: "totalTilesExplored", target: 12 },
        ],
    },
    {
        slug: "iron-pilgrim-daigo", name: "Iron Pilgrim Daigo", categories: ["taijutsu"],
        tellTint: "#f59e0b",
        greeting: "Every bead on this string is a fight I did not need a weapon for.",
        lore: [
            "The body forgets nothing. Train it in patience and it will spend that too.",
            "Stone beads, stone knuckles, stone road. Everything else wore out.",
            "I do not bless fists. I bless what they choose not to break.",
        ],
        trialLine: "Your trial is counted in bruises the record keeper never sees. I see them. Go on.",
        quests: [
            { id: "eq-iron-tally", label: "Break 10 foes — one bead counted for each", metric: "totalAiKills", target: 10 },
            { id: "eq-iron-road", label: "Walk 20 tiles of the pilgrim road", metric: "totalTilesExplored", target: 20 },
        ],
    },
    {
        slug: "blade-keeper-hana", name: "Blade-Keeper Hana", categories: ["bukijutsu"],
        tellTint: "#e2e8f0",
        greeting: "Thirty-one swords on my back. Every one of them is listening.",
        lore: [
            "A sealed sword is not a retired sword. It is a sword that has said enough.",
            "People ask which blade is strongest. The strongest one is still sheathed. It always is.",
            "The shrine burned twice. The swords carried themselves out. I merely followed.",
        ],
        trialLine: "The swords have opinions about your trial. Most are favorable. Finish it before they change.",
        quests: [
            { id: "eq-blade-rites", label: "Fell 8 foes with clean form — the swords are listening", metric: "totalAiKills", target: 8 },
            { id: "eq-blade-vigil", label: "Stand a vigil of 6 victories", metric: "totalAiKills", target: 6 },
        ],
    },
    {
        slug: "duel-broker-kesshi", name: "Duel-Broker Kesshi", categories: ["pvp", "cards", "war"],
        tellTint: "#f87171",
        greeting: "Everything is a wager. You have simply not read the terms yet.",
        lore: [
            "This ledger is chained to me. Or I am chained to it. The interest compounds either way.",
            "I brokered a duel between two Kage once. The village that watched still owes me.",
            "Wars are just duels that forgot their manners. I keep the accounts regardless.",
        ],
        trialLine: "Your trial is on my books, shinobi. The odds I wrote beside your name are — flattering.",
        quests: [
            { id: "eq-broker-ledger", label: "Win 4 rounds of Card Clash for the ledger", metric: "cardClashWins", target: 4 },
            { id: "eq-broker-debts", label: "Collect 8 battle debts owed to Kesshi", metric: "totalAiKills", target: 8 },
        ],
    },
    {
        slug: "hollow-warden", name: "The Hollow Warden", categories: ["pve", "mythic"],
        tellTint: "#4ade80",
        greeting: "You stand where the deep things listen. Speak softly, or interestingly.",
        lore: [
            "This mask was bone before the Gate. It remembers being something's face.",
            "The keystone sigils are not locks. They are apologies, written very firmly.",
            "What sleeps below does not hate you. It simply has not decided you matter. Change that carefully.",
        ],
        trialLine: "Your trial reaches into old places. The Warden walks the boundary with you — from the boundary's side.",
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
            "Walls keep villages standing. People keep villages worth it. I carry equipment for both.",
            "The lantern has gone out exactly once. I do not talk about that night, and neither does the village that is still here.",
            "Healers and sentries do the same job at different distances.",
        ],
        trialLine: "Your trial is the quiet kind — the kind villages never thank properly. The lantern sees it. Proceed.",
        quests: [
            { id: "eq-lantern-rounds", label: "Walk 14 tiles of her lantern rounds", metric: "totalTilesExplored", target: 14 },
            { id: "eq-lantern-watch", label: "Turn back 6 threats to the village", metric: "totalAiKills", target: 6 },
        ],
    },
    {
        slug: "mapless-ojii", name: "Mapless Ojii", categories: ["explorer", "pets"],
        tellTint: "#7be0a3",
        greeting: "This map is blank on purpose. Full ones lie.",
        lore: [
            "I drew the finest maps of my generation. Then I noticed the land kept editing them. Now we collaborate.",
            "Every beast I ever followed knew a road no cartographer did. So I stopped following cartographers.",
            "The blank map has one mark on it. When you find where, you will not need the map either.",
        ],
        trialLine: "Your trial is off the edge of every chart I ever sold. Good. That is where the real ones are.",
        quests: [
            { id: "eq-mapless-edges", label: "Scout 25 tiles past the map's edge", metric: "totalTilesExplored", target: 25 },
            { id: "eq-mapless-companions", label: "Win 3 pet duels — the beasts remember", metric: "totalPetWins", target: 3 },
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

export const EMISSARY_METRIC_LABELS: Record<EmissaryQuestDef["metric"], string> = {
    totalAiKills: "foes defeated",
    totalPetWins: "pet duels won",
    cardClashWins: "card rounds won",
    totalTilesExplored: "tiles scouted",
};

/** Stable wanderer-id prefix the WorldMap dialog keys off. */
export const EMISSARY_WANDERER_PREFIX = "legacy-emissary-";

/** Minimum level before emissaries start appearing (the pre-Sage hint arc). */
export const EMISSARY_MIN_LEVEL = 40;

// FNV-1a → mulberry32, same determinism pattern as wanderers.ts.
function hash32(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const GRID = 12;
const SECTOR_COUNT = 60;
/** Fraction of 6h windows in which the player's emissary is out roaming. */
const EMISSARY_SPAWN_CHANCE = 0.45;

export interface EmissarySpawn {
    def: EmissaryDef;
    sector: number;
    wanderer: Wanderer;
}

/**
 * Where (and whether) an emissary roams for this player in this 6h window.
 * Deterministic from (player, dayBucket): no server round-trip, no flicker —
 * the same pattern as the natural wanderer roster. Post-acceptance the
 * player's own category emissary walks; pre-acceptance (level 40+) the eight
 * take turns, hinting at the paths that are watching.
 */
export function rollEmissarySpawn(
    playerName: string,
    level: number,
    legacyCategory: string | null,
    dayBucket: number,
): EmissarySpawn | null {
    if (!playerName || level < EMISSARY_MIN_LEVEL) return null;
    const rng = mulberry32(hash32(`emissary#${playerName.toLowerCase()}#${dayBucket}`));
    if (rng() > EMISSARY_SPAWN_CHANCE) return null;

    // The random-def draw ALWAYS happens so rng consumption is identical with
    // and without a resolved category — otherwise the world map (async-fetched
    // category) and the panel hint (server truth) would place the emissary in
    // different sectors whenever the fetch lagged (verification finding).
    const randomDef = EMISSARY_DEFS[Math.floor(rng() * EMISSARY_DEFS.length)];
    const def = emissaryForCategory(legacyCategory) ?? randomDef;
    const sector = 1 + Math.floor(rng() * (SECTOR_COUNT - 1)); // 1..59

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
