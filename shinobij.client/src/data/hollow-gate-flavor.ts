/*
 * Hollow Gate Shrine flavor pool, intro VN pages, and the pure
 * helpers that pick a flavor string + emoji icon from a tile kind.
 *
 * The flavor pool is the per-tile-kind "you stepped on this" prose
 * shown when the player reveals a tile. The intro pages run once
 * the first time a character enters the shrine. The icon helper
 * returns the emoji used when no atlas sprite is assigned.
 *
 * Pure data + two pure helpers. Extracted from App.tsx.
 */

import type { HollowGateTileKind } from "../types/character";

export const hollowGateFlavorPool: Record<HollowGateTileKind, string[]> = {
    empty: [
        "Dust drifts through shafts of pale light. Ancient seals glow faintly underfoot.",
        "Broken shrine stones line the floor. A single glowing pawprint blinks out as you step past.",
        "Chakra mist coils around your ankles. The silence here is older than memory.",
        "The corridor breathes. Far below, something answers.",
    ],
    battle: [
        "A Hollow Hound rises from the chakra mist — eyes burning blue, fangs wet with shadow.",
        "Hollow Gate echoes knot themselves into a stalking spirit hound.",
        "Glowing pawprints stop here. From the dark, a Hollow Hound lowers itself to spring.",
    ],
    elite: [
        "An armored Hollow Hound blocks the path. Broken shrine seals still burn across its hide.",
        "Ancient claw-script winds across the floor — and the alpha that carved it remains.",
    ],
    trap: [
        "Ancient seals flare beneath your feet — paper-thin runes ignite!",
        "A sealed door slams behind you as venomous chakra mist hisses from the stones.",
        "A pressure plate clicks. Shuriken fly from a broken shrine stone.",
    ],
    chest: [
        "A shrine offering box rests in the dust, faintly humming with old chakra.",
        "Glowing pawprints circle a small lacquered chest. Something wants you to find it.",
    ],
    pet_event: [
        "Glowing pawprints trail toward a sleeping shrine spirit. Your pet's ears twitch.",
        "A familiar scent drifts past — your pet pulls you toward a side passage.",
    ],
    pet_battle: [
        "A corrupted Hollow Hound prowls the corridor — eyes burning chakra-blue, claws scoring stone.",
        "Glowing pawprints crystallize into a snarling shadow-bound beast, twisted by the gate's mist.",
        "A wild thing lunges from the dark — too fast for a normal animal, too old for a normal shadow.",
    ],
    tile_game: [
        "An obsolete tile seal fractures. A Hollow Hound steps through the broken grid.",
        "The shrine's old game table collapses into mist, leaving fresh claw marks across the stone.",
        "Ancient tile sigils gutter out. A spirit hound answers in their place.",
    ],
    shard_vein: [
        "A seam of violet crystal threads the shrine stone — Hollow Shards, half-buried and humming.",
        "Glowing shards crust a cracked pillar, cold and faintly singing. They come loose with a touch.",
        "Old chakra has crystallized in the wall here, a vein of Hollow Shards waiting to be pried free.",
    ],
    shrine: [
        "A broken shrine stone weeps cold chakra. Beyond it, a Hidden Chamber lies open.",
        "A ritual circle pulses violet. The Hollow Gate echoes invite you inward.",
    ],
    story: [
        "Stone tablets line the wall, etched with the names of the shrine's first guardians.",
        "A shattered mural shows shinobi sealing the Hollow Gate from the inside.",
    ],
    boss: [
        "The corridor opens into a vast chamber. The Hollow Hound Alpha waits at its center.",
    ],
    exit: [
        "A broken torii leans across this tile, its chakra chains slackened. Beyond it, pale daylight from the world above bleeds through — the way out.",
        "The seal on this threshold has frayed. Step through and the Hollow Gate releases you back to the world map.",
    ],
    locked: [
        "A sealed door, bound by chakra chains. Without a Shrine Key it will not yield.",
    ],
    npc: [
        "A hooded figure tends a flame in the corridor — the Shrine Keeper. Their eyes are old.",
        "An old shinobi waits beside a chakra brazier. The Shrine Keeper bows in greeting.",
        "The Shrine Keeper looks up from a worn scroll. \"Choose carefully, traveler.\"",
    ],
    descend: [
        "A spiral staircase coils into the dark. The next floor breathes below.",
        "Hollow Gate echoes spiral downward — the next floor lies open.",
    ],
    wall: [
        "Solid shrine stone. The wall is sealed by old chakra and will not move.",
    ],
};

// Hollow Gate intro VN — 3 pages shown the first time a character enters the
// shrine. Image keys map to admin-generated art (shrine:intro-1/2/3).
export const hollowGateIntroPages: Array<{ title: string; imageKey: string; lines: string[] }> = [
    {
        title: "The Broken Torii",
        imageKey: "shrine:intro-1",
        lines: [
            "The Hollow Gate Key in your hand grows cold.",
            "Ahead, a broken torii leans against itself, chained shut by chakra rope older than the village.",
            "The seal cracks. The Hollow Gate echoes whisper your name in a voice you have never heard.",
        ],
    },
    {
        title: "The First Step",
        imageKey: "shrine:intro-2",
        lines: [
            "Stone teeth bite the air. Glowing pawprints pulse violet down the corridor and vanish.",
            "Behind you, the seal re-knits — there is no leaving by the way you came.",
            "Find a Leave tile, clear the final seal, or invoke Emergency Forfeit if the Gate stops responding.",
        ],
    },
    {
        title: "What Waits Below",
        imageKey: "shrine:intro-3",
        lines: [
            "Five floors spiral down into the shrine, each deeper than the last and hungrier for you. Search its chambers for keys, relics, and the staircase below.",
            "Your Torch of Reiki burns down as you wander and is not rekindled by battle — feed it at chests and shrines, or the dark will turn on you.",
            "Hollow Shards torn from the depths buy shrine relics mid-run, or permanent attunements at the gate. Fall, and you keep only half your haul — unless a Second Wind carries you back.",
            "On the deepest floor, the Hollow Hound Alpha waits. Face it as a shinobi or send your active pet into a tactical duel.",
        ],
    },
];

/**
 * Pick a random flavor line for the given tile kind. Stateless — each
 * call produces a fresh roll. Persist the chosen flavor on the tile so
 * the same cell shows consistent prose across re-renders.
 */
export function hollowGateFlavorFor(kind: HollowGateTileKind): string {
    const pool = hollowGateFlavorPool[kind];
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Emoji glyph for a tile kind. Used when the renderer can't find an atlas
 * sprite under `shrine:icon-<id>` for the assigned variant. Pure lookup.
 */
export function hollowGateTileIconForKind(kind: HollowGateTileKind): string {
    switch (kind) {
        case "battle": return "⚔";
        case "elite": return "☠";
        case "trap": return "▲";
        case "chest": return "▣";
        case "pet_event": return "🐾";
        case "pet_battle": return "🐺";
        case "tile_game": return "🀄";
        case "shard_vein": return "💎";
        case "shrine": return "⛩";
        case "story": return "📜";
        case "boss": return "👹";
        case "exit": return "🚪";    // Leave tile — exit to world map (distinct from ▼ descend)
        case "locked": return "🔒";
        case "npc": return "👤";      // Shrine Keeper
        case "descend": return "▼";   // Staircase to next floor
        case "wall": return "";       // walls render as solid stone, no icon
        case "empty": return "·";
        default: return "·";
    }
}
