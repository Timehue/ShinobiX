/*
 * Per-village clan-hall lore — names, mottos, and flavor text shown in the
 * Clan Hall. Pure data, extracted verbatim from App.tsx.
 */

export const clanLore: Record<string, { name: string; motto: string; lore: string }> = {
    "Frostfang Village": {
        name: "Frostfang Clan Halls",
        motto: "No fang breaks from the pack.",
        lore: "Frostfang clans are built like wolf packs. Each clan swears loyalty to its members before glory, wealth, or personal fame. Their oldest houses were formed during the first endless winter, when surviving alone meant death."
    },
    "Stormveil Village": {
        name: "Stormveil Warbands",
        motto: "Power belongs to whoever takes it.",
        lore: "Stormveil clans are unstable, loud, and dangerous. They are less like noble families and more like warbands formed beneath thunderclouds. Leaders rise fast, fall faster, and only the strongest names survive the storm."
    },
    "Ashen Leaf Village": {
        name: "Ashen Leaf Houses",
        motto: "Roots remember what flames forget.",
        lore: "Ashen Leaf clans preserve ancient shinobi traditions. Many houses trace their bloodlines back to survivors of the great fire war, guarding old techniques, scrolls, and family oaths passed down through generations."
    },
    "Moonshadow Village": {
        name: "Moonshadow Secret Circles",
        motto: "Trust no shadow but your own.",
        lore: "Moonshadow clans are secretive circles built on ambition, stealth, and hidden contracts. Some are assassin houses, some are spy networks, and some exist only as names whispered under moonless skies."
    }
};
