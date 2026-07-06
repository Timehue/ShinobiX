type VillageLeadershipProfile = { kage: string; elders: string[]; atWar: boolean; pastWars: string[] };
export type VillageLeadershipImages = Record<string, { kage?: string; elders?: string[] }>;

export const villageLeadership: Record<string, VillageLeadershipProfile> = {
    "Stormveil Village": {
        kage: "Kage Raiko Veyr",
        elders: ["Elder Vanta", "Mira Volt", "Tempest Guard Captain"],
        atWar: false,
        pastWars: ["Won the Tempest Border War vs Moonshadow", "Lost the Crimson Dock Raid vs Ashen Leaf", "Draw at the Broken Thunder Pass"],
    },
    "Ashen Leaf Village": {
        kage: "Kage Hoshina Enju",
        elders: ["Elder Mori", "Toma Reed", "Ren Reed"],
        atWar: false,
        pastWars: ["Won the Crimson Dock Raid vs Stormveil", "Won the Ember Road Defense vs Frostfang", "Lost the Old Grove Skirmish vs Moonshadow"],
    },
    "Frostfang Village": {
        kage: "Kage Kael Whitefang",
        elders: ["Elder Sova", "Captain Yura", "Pale Pack Leader"],
        atWar: false,
        pastWars: ["Won the White Ridge Siege vs Moonshadow", "Lost the Ember Road Assault vs Ashen Leaf", "Draw at the Frozen Gate"],
    },
    "Moonshadow Village": {
        kage: "Kage Sable Nocturne",
        elders: ["Shade Master Iro", "Nyx", "Archivist Rei"],
        atWar: false,
        pastWars: ["Won the Old Grove Skirmish vs Ashen Leaf", "Lost the White Ridge Siege vs Frostfang", "Lost the Tempest Border War vs Stormveil"],
    },
};

export function normalizeVillageLeadershipImages(images?: VillageLeadershipImages): VillageLeadershipImages {
    const normalized: VillageLeadershipImages = {};
    Object.keys(villageLeadership).forEach((village) => {
        const source = images?.[village];
        normalized[village] = {
            kage: source?.kage ?? "",
            elders: Array.from({ length: 3 }, (_, index) => source?.elders?.[index] ?? ""),
        };
    });
    return normalized;
}
