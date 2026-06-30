/*
 * Icon name registry — kept in its own (component-free) module so the data
 * exports don't trip react-refresh's "only export components" rule that fires
 * when a value export sits next to a component in the same file.
 *
 * Extend both when adding a glyph (and add its PATHS entry in GameIcon.tsx).
 */
export type GameIconName =
    | "ryo"      // ryō — the mon coin (currency)
    | "shard"    // faceted gem (fate shards)
    | "crystal"  // cut crystal stone (aura stones)
    | "sparkle"  // 4-point sparkle (aura dust)
    | "medal"    // rank / honor seals
    | "sigil"    // star-in-ring seal (mythic seals)
    | "bone"     // bone charm
    | "chakra"   // chakra / seal energy (tri-tomoe orb)
    | "hp"       // health
    | "sword"    // attack / power
    | "shield"   // defense / guard
    | "scroll"   // jutsu / technique
    | "map"      // tiles explored / expedition (folded map)
    | "target"   // hunts (bullseye)
    | "dice"     // fate spins
    | "clock"    // daily reset timer
    | "dumbbell" // physical / stat training
    | "paw"      // pet activity
    | "gift"     // reward ready
    | "person"   // character / profile (nav)
    | "bag"      // inventory / items (nav)
    | "menu"     // hamburger menu (nav)
    | "flask"    // tavern / sake (nav)
    | "bolt";    // speed / lightning (stat)

export const gameIconNames: readonly GameIconName[] = [
    "ryo", "shard", "crystal", "sparkle", "medal", "sigil", "bone",
    "chakra", "hp", "sword", "shield", "scroll",
    "map", "target", "dice", "clock", "dumbbell", "paw", "gift",
    "person", "bag", "menu", "flask", "bolt",
];
