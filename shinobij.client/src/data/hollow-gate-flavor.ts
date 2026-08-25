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
        "Dust hangs in one shaft of light. Floor seals show where the Court's maintenance crews once stood.",
        "Broken shrine stones line the passage. A fresh claw mark crosses the oldest carving.",
        "Chakra mist reaches your ankles. Your next footprint stays visible three breaths too long.",
        "Water knocks inside a pipe behind the wall. The next knock comes from farther down.",
    ],
    battle: [
        "A Hollow Hound steps out of the mist, head low and blue chakra leaking between its teeth.",
        "Mist gathers around a set of running pawprints. The hound reaches you a moment after its tracks do.",
        "Glowing pawprints stop here. From the dark, a Hollow Hound lowers itself to spring.",
    ],
    elite: [
        "An armored Hollow Hound blocks the path. Broken shrine seals still burn across its hide.",
        "Claw-script circles the chamber floor. The alpha that carved it watches from the only open doorway.",
    ],
    trap: [
        "A floor seal flashes under your heel. Paper-thin runes ignite in a line toward you.",
        "The door drops behind you. Green chakra mist spills from holes cut at shin height.",
        "A pressure plate clicks. Shuriken fly from a broken shrine stone.",
    ],
    chest: [
        "A shrine offering box rests in the dust. One seal is intact; the other two were cut from the inside.",
        "Pawprints circle a lacquered field chest, then continue down the hall. Whatever found it could not work the latch.",
    ],
    pet_event: [
        "Glowing pawprints lead to a sleeping sector beast caught behind a fallen screen. Your companion's ears lift.",
        "Your companion catches a familiar scent and pulls you toward a side passage before you see the tracks.",
    ],
    pet_battle: [
        "A Hollow Hound prowls the corridor, blue chakra leaking from its eyes and claws scoring the stone.",
        "Glowing pawprints harden into crystal. A hound tears itself free from the last print and snarls at your companion.",
        "A lean Gate beast lunges from the dark. Your companion meets it before it reaches your throat.",
    ],
    tile_game: [
        "An obsolete tile seal fractures. A Hollow Hound steps through the broken grid.",
        "The shrine's old game table collapses into mist, leaving fresh claw marks across the stone.",
        "Ancient tile sigils gutter out. A spirit hound answers in their place.",
    ],
    shard_vein: [
        "A seam of violet Hollow Shards runs through the shrine stone. Half the vein is exposed.",
        "Hollow Shards crust a cracked pillar. The loose pieces are cold enough to numb your fingertips.",
        "Old chakra has crystallized in the wall. A kunai fits cleanly behind the largest shard.",
    ],
    shrine: [
        "A broken shrine stone weeps cold chakra. Beyond it, a Hidden Chamber lies open.",
        "A violet ritual circle marks a side chamber. Someone wiped one footprint away and missed the second.",
    ],
    story: [
        "Stone tablets list the Court workers assigned to this intake. Later hands added the names of shinobi who never returned.",
        "A damaged mural shows workers closing the Hollow Gate from inside the control hall. The final panel was cut away.",
    ],
    boss: [
        "The corridor opens into a vast chamber. The Hollow Hound Alpha waits at its center.",
    ],
    exit: [
        "A broken torii leans across the threshold, its chakra chains slack. Pale daylight marks the way out.",
        "The seal on this threshold has frayed. Step through and the Hollow Gate releases you onto the surface road.",
    ],
    locked: [
        "A sealed door, bound by chakra chains. Without a Shrine Key it will not yield.",
    ],
    npc: [
        "A hooded Shrine Keeper trims a brazier wick with a kunai and looks up when your boots scrape stone.",
        "An old shinobi waits beside a chakra brazier. The Shrine Keeper bows in greeting.",
        "The Shrine Keeper looks up from a worn scroll. \"Choose carefully, traveler.\"",
    ],
    descend: [
        "A spiral stair drops to the next floor. Fresh hound tracks overlap your own at the first turn.",
        "The lower-floor seal has opened. Cold air climbs the stairs and gutters your torch.",
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
            "Ahead, a broken torii leans against itself, chained shut with Court-era chakra rope.",
            "The key releases the chain one link at a time. No voice greets you. The Gate checks the seal and opens.",
        ],
    },
    {
        title: "The First Step",
        imageKey: "shrine:intro-2",
        lines: [
            "Glowing pawprints cross the first corridor and vanish beneath a closed screen.",
            "Behind you, the entrance seal knots itself shut. The key opened a one-way intake.",
            "The Warden's field note is blunt: find a marked exit, clear the final seal, or use Emergency Forfeit if the Gate stops answering.",
        ],
    },
    {
        title: "What Waits Below",
        imageKey: "shrine:intro-3",
        lines: [
            "Five floors descend through the old intake. Search each one for keys, field relics, and the next stair, but keep track of the route back to a marked exit.",
            "Your Torch of Reiki burns while you walk, not while you fight. Rekindle it at chests and shrines before the light reaches the last mark.",
            "Hollow Shards buy field relics during the run or lasting attunements at the entrance. If you fall, the Gate keeps half your haul unless a Second Wind gets you out.",
            "The Hollow Hound Alpha holds the deepest seal. Fight it yourself or send your active companion into the tactical ring.",
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
