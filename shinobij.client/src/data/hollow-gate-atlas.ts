/*
 * Hollow Gate Shrine atlas configuration.
 *
 * Each content role (battle / elite / boss / chest / etc.) can have
 * multiple variants so the dungeon stops looking like 6 photocopies of
 * the same monster. The renderer picks one variant deterministically by
 * tile-index hash — adjacent cells of the same role get different
 * sprites without per-render randomness.
 *
 * Slots are filled via the Atlas Tile Picker (admin panel): the admin
 * selects a slot, clicks a tile in the atlas, and the picker slices that
 * 16×16 tile out of the atlas and publishes it under `shrine:icon-<id>`.
 *
 * A "theme" bundles 4 terrain tiles (wall + floor + corridor + door)
 * that look good together. The generator stamps each room with a
 * deterministic theme based on the room's index + floor number, so
 * consecutive runs and rooms inside the same run feel different without
 * exposing seams.
 *
 * Theme tile keys in shared KV:
 *   shrine:icon-theme-<theme>-wall
 *   shrine:icon-theme-<theme>-floor
 *   shrine:icon-theme-<theme>-corridor
 *   shrine:icon-theme-<theme>-door
 *
 * When a tile sits in a room with theme T, the renderer prefers the
 * theme's tile; if that slot isn't assigned it falls back to the base
 * `shrine:tile-<terrain>-N` variants (atlas-extracted Kenney textures).
 *
 * Pure data + two small pure helpers. Extracted from App.tsx.
 */

import type { HollowGateTileKind } from "../types/character";

export type HollowGateIconRoleCfg = {
    label: string;
    kind?: HollowGateTileKind;
    count: number;             // how many variant slots for this role
    legendOnly?: boolean;
};

export const HOLLOW_GATE_ICON_ROLES: Record<string, HollowGateIconRoleCfg> = {
    you:     { label: "You (player)",                count: 1 },
    battle:  { label: "Battle",  kind: "battle",     count: 4 },
    elite:   { label: "Elite",   kind: "elite",      count: 4 },
    boss:    { label: "Boss",    kind: "boss",       count: 2 },
    trap:    { label: "Trap",    kind: "trap",       count: 4 },
    chest:   { label: "Chest",   kind: "chest",      count: 4 },
    shrine:  { label: "Shrine",  kind: "shrine",     count: 2 },
    story:   { label: "Story",   kind: "story",      count: 2 },
    pet:     { label: "Pet",     kind: "pet_event",  count: 3 },
    petbattle: { label: "Pet Battle", kind: "pet_battle", count: 3 },   // wild Hollow Beast encounters
    tilegame:  { label: "Tile Game", kind: "tile_game", count: 2 },     // Shinobi Tile card-game encounter
    npc:     { label: "Keeper",  kind: "npc",        count: 3 },
    shardvein: { label: "Shard Vein", kind: "shard_vein", count: 2 },   // findable Hollow Shard cache
    descend: { label: "Descend", kind: "descend",    count: 1 },
    exit:    { label: "Leave",   kind: "exit",       count: 1 },
    locked:  { label: "Locked Door", kind: "locked", count: 2 },
    wall:    { label: "Wall",                        count: 1, legendOnly: true },
    // Floor flavor — sprinkled by the generator on empty room cells, 12%
    // chance. Assignable atlas tiles for bones / mushrooms / vines / dirt
    // piles / cracks / banners / pillars / etc. The renderer also includes
    // any per-theme deco slots (theme-X-deco-1, -deco-2) so themed rooms
    // get themed flavor (Crypt skulls, Ember braziers, etc.).
    deco:    { label: "Decoration",                  count: 8 },
};

export type HollowGateIconSlot = {
    id: string;                 // shrine:icon-<id>
    label: string;              // human-readable
    kind?: HollowGateTileKind;
    variantGroup: string;       // the role id this slot belongs to
    variantIndex: number;       // 1..N within the group (1 if singleton)
    legendOnly?: boolean;
};

export const HOLLOW_GATE_ICON_SLOTS: HollowGateIconSlot[] = Object.entries(HOLLOW_GATE_ICON_ROLES).flatMap(([role, cfg]) => {
    if (cfg.count === 1) {
        return [{ id: role, label: cfg.label, kind: cfg.kind, variantGroup: role, variantIndex: 1, legendOnly: cfg.legendOnly }];
    }
    return Array.from({ length: cfg.count }, (_, i) => ({
        id: `${role}-${i + 1}`,
        label: `${cfg.label} ${i + 1}`,
        kind: cfg.kind,
        variantGroup: role,
        variantIndex: i + 1,
        legendOnly: cfg.legendOnly,
    }));
});

export const HOLLOW_GATE_ICON_KEY = (id: string) => `shrine:icon-${id}`;

// ── Room themes ────────────────────────────────────────────────────────

export const HOLLOW_GATE_THEMES: Array<{ id: string; label: string }> = [
    { id: "crypt",   label: "Crypt"   },   // grey stone + bone + skull
    { id: "ember",   label: "Ember"   },   // orange brick + brazier
    { id: "sanctum", label: "Sanctum" },   // gold + violet rune
    { id: "ruins",   label: "Ruins"   },   // mossy + cracked + plant
];

export const HOLLOW_GATE_THEME_TILE_ROLES: Array<{ id: string; label: string }> = [
    { id: "wall",     label: "Wall"     },
    { id: "floor",    label: "Floor"    },
    { id: "corridor", label: "Corridor" },
    { id: "door",     label: "Door"     },
    { id: "deco-1",   label: "Deco 1"   },   // themed decoration (preferred in this room)
    { id: "deco-2",   label: "Deco 2"   },
];

// Flat slot list for the picker: 4 themes × 4 roles = 16 theme slots.
export const HOLLOW_GATE_THEME_SLOTS: HollowGateIconSlot[] = HOLLOW_GATE_THEMES.flatMap(theme =>
    HOLLOW_GATE_THEME_TILE_ROLES.map(role => ({
        id: `theme-${theme.id}-${role.id}`,
        label: `${theme.label} — ${role.label}`,
        variantGroup: `theme-${theme.id}`,
        variantIndex: 1,
    })),
);

// Deterministic theme pick for a given roomId on a given floor. Same room
// keeps the same theme within a run; new runs reshuffle.
export function pickRoomTheme(roomId: number, floor: number, runSeed: number): string {
    if (roomId < 0) return "";
    const hash = ((roomId + 1) * 2654435761 + floor * 16777619 + runSeed) >>> 0;
    return HOLLOW_GATE_THEMES[hash % HOLLOW_GATE_THEMES.length].id;
}
