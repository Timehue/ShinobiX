/*
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *
 *   node --import tsx scripts/gen-npc-village-roster.mts
 *
 * The persistent roster of the 30 NPC shinobi who run Cinderhold Village
 * (shared/npc-village.ts). Each entry is shaped so a seeder can write it as a
 * real, password-less player save: every field maps onto a save field the
 * server already accepts for a human character.
 *
 * The generator resolved everything below from the live server catalogs and
 * validators, and shared/npc-village-roster.test.ts re-proves it:
 *   - bloodline: a top-level savedBloodlines entry, already in the exact
 *     projection api/bloodlines/_jutsu-schema.ts normalizes to, spending its
 *     whole rank budget (A 10 points, B 7);
 *   - jutsu, elements, gear and stats are BANDED by level, because NPC levels
 *     are rescaled daily anywhere from 1 to 100: use the *ForLevel helpers;
 *   - pets: four distinct wild-obtainable species per NPC with approved 3D
 *     models, 120 distinct across the roster (build each with createOwnedPet);
 *   - deck: a legal 40-card Chronicle deck, and collection: the tileCards the
 *     NPC must own for api/card-clash/_deck.ts to accept it.
 *
 * This module has no api/ imports, so the client may import it.
 */

export type NpcRank = 'kage' | 'commander' | 'elite' | 'jonin' | 'chunin' | 'genin';
export type NpcPersonality = 'aggressive' | 'guardian' | 'medic' | 'trickster';
export type NpcAiTier = 'tactical' | 'advanced' | 'master' | 'apex';
export type NpcSpecialty = 'Ninjutsu' | 'Taijutsu' | 'Genjutsu' | 'Bukijutsu';
export type NpcBaseElement = 'Fire' | 'Water' | 'Wind' | 'Earth' | 'Lightning';
export type NpcStatKey =
    | 'strength' | 'speed' | 'intelligence' | 'willpower'
    | 'bukijutsuOffense' | 'bukijutsuDefense' | 'taijutsuOffense' | 'taijutsuDefense'
    | 'genjutsuOffense' | 'genjutsuDefense' | 'ninjutsuOffense' | 'ninjutsuDefense';

/** One jutsu exactly as normalizePlayerBloodlineJutsus stores it (character save Jutsu shape). */
export type NpcBloodlineJutsu = {
    id: string;
    name: string;
    type: 'Any' | NpcSpecialty;
    element: string;
    ap: 40 | 60;
    range: number;
    effectPower: number;
    cooldown: number;
    currentCooldown: number;
    chakraCost: number;
    staminaCost: number;
    healthCost: number;
    chakraCostReducePerLvl: number;
    staminaCostReducePerLvl: number;
    healthCostReducePerLvl: number;
    target: 'OPPONENT' | 'SELF';
    method: 'SINGLE' | 'AOE_BURST';
    tags: Array<{ name: string; percent: number }>;
    battleDescription: string;
    description: string;
    isUtility: boolean;
    weatherElement: NpcBaseElement;
};

/** A top-level save `savedBloodlines` entry (client SavedBloodline). */
export type NpcSavedBloodline = {
    id: string;
    name: string;
    rank: 'A Rank' | 'B Rank';
    specialElement: string;
    weatherElement: NpcBaseElement;
    lore: string;
    jutsus: NpcBloodlineJutsu[];
    totalPoints: number;
};

/** character.jutsuMastery row. */
export type NpcJutsuMastery = { jutsuId: string; level: number; xp: number };
/** character.equipment (weapon hand + the five armor slots). */
export type NpcEquipment = Partial<Record<'hand' | 'head' | 'body' | 'waist' | 'legs' | 'feet', string>>;
export type NpcGearBand = { minLevel: number; equipment: NpcEquipment };
export type NpcJutsuBand = { minLevel: number; equippedJutsuIds: string[] };
/** What createOwnedPet(templateId, { origin, instanceId, trait }) needs, plus a nickname. */
export type NpcPet = {
    templateId: string;
    species: string;
    rarity: 'mythic' | 'legendary' | 'rare' | 'standard';
    nickname: string;
    signature: boolean;
    instanceId: string;
    trait: string;
};

export type NpcShinobi = {
    /** Account slug: safeName(name), the save key `save:<id>`. */
    id: string;
    /** character.name */
    name: string;
    rank: NpcRank;
    personality: NpcPersonality;
    /** character.avatarImage: its own portrait, /npc-portraits/<id>.avif (not a player preset). */
    avatar: string;
    /** character.specialty */
    specialty: NpcSpecialty;
    /** Awakening order: character.elements gains [0] at level 2 and [1] at level 20. */
    elements: NpcBaseElement[];
    /** Stat ALLOCATION weights (0..1). Real stat values come from npcStatsForLevel. */
    stats: Record<NpcStatKey, number>;
    /** Top-level save savedBloodlines[0]; character.equippedBloodlineId = bloodline.id. */
    bloodline: NpcSavedBloodline;
    /** character.equippedJutsuIds at level 20+ (the full 12). Lower levels: jutsuBands. */
    equippedJutsuIds: string[];
    jutsuBands: NpcJutsuBand[];
    /** character.jutsuMastery: one row for every jutsu any band equips (level 1). */
    jutsuMastery: NpcJutsuMastery[];
    gearBands: NpcGearBand[];
    /** character.pets (signature first); activePetId = the signature's instanceId. */
    pets: NpcPet[];
    /** character.cardClashDeck = deck.cards. */
    deck: { name: string; cards: string[] };
    /** character.tileCards (covers the deck and the starter grant, so no top-up runs). */
    collection: string[];
};

/** Level offset from the scaled reference level, per rank. */
export const NPC_RANK_LEVEL_OFFSET: Readonly<Record<NpcRank, number>> = Object.freeze({
    genin: -10, chunin: -7, jonin: -4, elite: 0, commander: 3, kage: 5,
});

/** AI difficulty tier per rank. */
export const NPC_RANK_AI_TIER: Readonly<Record<NpcRank, NpcAiTier>> = Object.freeze({
    genin: 'tactical', chunin: 'tactical', jonin: 'advanced', elite: 'master', commander: 'master', kage: 'apex',
});

/** An NPC's display name from its slug (the slug itself if unknown), for messages players read. */
export function npcDisplayName(slug: string): string {
    return NPC_VILLAGE_ROSTER.find((npc) => npc.id === slug)?.name ?? slug;
}

/** Mirror of api/_utils.ts safeName (the account-slug rule). Parity-tested. */
export function npcCanonicalSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
}

/** Mirror of api/combat-core/formulas.ts jutsuLevelCapForLevel. Parity-tested. */
export function npcJutsuLevelCap(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 50) return 50;
    if (lvl >= 30) return 30;
    if (lvl >= 15) return 20;
    return 10;
}

/** Mirror of the per-rank stat cap (statCapForLevel). Parity-tested. */
export function npcStatCap(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80) return 2500;
    if (lvl >= 50) return 2100;
    if (lvl >= 30) return 1300;
    if (lvl >= 15) return 700;
    return 350;
}

const MAX_STAT = 2500;
const BASE_STAT = 10;

function clampLevel(level: number): number {
    return Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
}

function bandFor<T extends { minLevel: number }>(bands: readonly T[], level: number): T {
    const lvl = clampLevel(level);
    let chosen = bands[0]!;
    for (const band of bands) if (band.minLevel <= lvl) chosen = band;
    return chosen;
}

/** The highest gear band whose minLevel <= level (every item's levelReq <= that minLevel). */
export function npcGearForLevel(npc: NpcShinobi, level: number): NpcEquipment {
    return { ...bandFor(npc.gearBands, level).equipment };
}

/** The jutsu loadout legal at this level (element awakening gates the catalog picks). */
export function npcJutsuIdsForLevel(npc: NpcShinobi, level: number): string[] {
    return [...bandFor(npc.jutsuBands, level).equippedJutsuIds];
}

/** character.elements at this level: none at 1, one from level 2, two from level 20. */
export function npcElementsForLevel(npc: NpcShinobi, level: number): NpcBaseElement[] {
    const lvl = clampLevel(level);
    return npc.elements.slice(0, lvl >= 20 ? 2 : lvl >= 2 ? 1 : 0);
}

/** character.claimedAwakenings matching npcElementsForLevel. */
export function npcClaimedAwakeningsForLevel(level: number): string[] {
    const lvl = clampLevel(level);
    return [...(lvl >= 2 ? ['awakening-free-lv2'] : []), ...(lvl >= 20 ? ['awakening-free-lv20'] : [])];
}

/** character.jutsuMastery at this level: every learned jutsu at the rank's mastery cap. */
export function npcJutsuMasteryForLevel(npc: NpcShinobi, level: number): NpcJutsuMastery[] {
    const cap = npcJutsuLevelCap(clampLevel(level));
    return npc.jutsuMastery.map((row) => ({ jutsuId: row.jutsuId, level: cap, xp: 0 }));
}

/**
 * Mirror of api/_xp-engine.ts earnedForLevel: the stat points a player must have
 * allocated to BE this level (0 at level 1). Parity-tested.
 */
export function npcEarnedForLevel(level: number): number {
    const n = clampLevel(level) - 1;
    return Math.round(191.67876990268087 * n + 1.1074354304268461 * n * n
        - 0.02226330146888855 * n * n * n + 0.00021623956441357866 * n * n * n * n);
}

/**
 * character.stats at this level. FAIRNESS RULE (owner, 2026-11-08): an NPC gets
 * exactly the allocated stat points of the weakest real player at its level
 * (npcEarnedForLevel), never more. They are split by the NPC's build weights,
 * water-filled under the level's per-stat cap, on top of the base 10 per stat.
 */
export function npcStatsForLevel(npc: NpcShinobi, level: number): Record<NpcStatKey, number> {
    const lvl = clampLevel(level);
    const room = Math.min(npcStatCap(lvl), MAX_STAT) - BASE_STAT;
    const entries = Object.entries(npc.stats) as Array<[NpcStatKey, number]>;
    const extra = Object.fromEntries(entries.map(([key]) => [key, 0])) as Record<NpcStatKey, number>;
    let budget = npcEarnedForLevel(lvl);
    let open = entries.filter(([, weight]) => weight > 0).map(([key]) => key);
    // Proportional shares; any stat that hits its cap passes the rest on.
    while (budget > 0 && open.length) {
        const weightSum = open.reduce((sum, key) => sum + npc.stats[key], 0);
        let spent = 0;
        const stillOpen: NpcStatKey[] = [];
        for (const key of open) {
            const share = Math.floor(budget * npc.stats[key] / weightSum);
            const add = Math.min(share, room - extra[key]);
            extra[key] += add; spent += add;
            if (extra[key] < room) stillOpen.push(key);
        }
        if (spent === 0) {
            // Rounding leftovers: one point at a time to the heaviest open stats.
            for (const key of [...stillOpen].sort((a, b) => npc.stats[b] - npc.stats[a])) {
                if (budget - spent <= 0) break;
                extra[key] += 1; spent += 1;
            }
            if (spent === 0) break;
        }
        budget -= spent;
        open = stillOpen.filter((key) => extra[key] < room);
    }
    const out = {} as Record<NpcStatKey, number>;
    for (const [key] of entries) out[key] = BASE_STAT + extra[key];
    return out;
}

/**
 * The combat-relevant character fields for one NPC at one level. A seeder
 * spreads this over a fresh character (with HP/chakra/stamina from the
 * server's *ForLevel helpers and pets built through createOwnedPet).
 */
export function npcLoadoutForLevel(npc: NpcShinobi, level: number) {
    const lvl = clampLevel(level);
    const elements = npcElementsForLevel(npc, lvl);
    return {
        name: npc.name,
        level: lvl,
        specialty: npc.specialty,
        avatarImage: npc.avatar,
        bloodline: npc.bloodline.name,
        equippedBloodlineId: npc.bloodline.id,
        ...(elements[0] ? { element: elements[0] } : {}),
        elements,
        claimedAwakenings: npcClaimedAwakeningsForLevel(lvl),
        stats: npcStatsForLevel(npc, lvl),
        unspentStats: 0,
        equippedJutsuIds: npcJutsuIdsForLevel(npc, lvl),
        jutsuMastery: npcJutsuMasteryForLevel(npc, lvl),
        equipment: npcGearForLevel(npc, lvl),
        cardClashDeck: [...npc.deck.cards],
        tileCards: [...npc.collection],
        starterCardsClaimed: true,
    };
}

/** The top-level savedBloodlines array for an NPC save. */
export function npcSavedBloodlines(npc: NpcShinobi): NpcSavedBloodline[] {
    return [structuredClone(npc.bloodline)];
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

export const NPC_VILLAGE_ROSTER: readonly NpcShinobi[] = deepFreeze<NpcShinobi[]>([
    {
        id: "kuroto",
        name: "Kuroto",
        rank: "commander",
        personality: "aggressive",
        avatar: "/npc-portraits/kuroto.avif",
        specialty: "Ninjutsu",
        elements: ["Fire","Wind"],
        stats: {"strength":0.37,"speed":0.93,"intelligence":0.39,"willpower":1,"bukijutsuOffense":0.17,"bukijutsuDefense":0.51,"taijutsuOffense":0.13,"taijutsuDefense":0.51,"genjutsuOffense":0.18,"genjutsuDefense":0.45,"ninjutsuOffense":1,"ninjutsuDefense":0.53},
        bloodline: { ...{"id":"cinderhold-kuroto-bloodline","name":"Crown of Cinders","rank":"A Rank","specialElement":"Cinderflame","weatherElement":"Fire","lore":"The Crown of Cinders passes only to the shinobi who can stand inside the caldera at the height of an eruption. Its bearer commands a fire that never fully goes out.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-kuroto-nuke","name":"Cinderflame Ruin","type":"Ninjutsu","element":"Cinderflame","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Lifesteal","percent":30}],"battleDescription":"Cinderflame chakra erupts over %target in one ruinous blast.","description":"Cinderflame chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kuroto-pierce","name":"Cinderflame Lance","type":"Ninjutsu","element":"Cinderflame","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pierce","percent":0}],"battleDescription":"A Cinderflame lance drives straight through the guard of %target.","description":"A Cinderflame lance drives straight through the guard of %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kuroto-burst","name":"Cinderflame Burst","type":"Ninjutsu","element":"Cinderflame","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Ignition","percent":25}],"battleDescription":"A Cinderflame burst detonates around %target.","description":"A Cinderflame burst detonates around %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kuroto-trance","name":"Cinderflame Frenzy","type":"Any","element":"Cinderflame","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Overclock","percent":0}],"battleDescription":"%user breathes in Cinderflame heat and moves faster than thought.","description":"%user breathes in Cinderflame heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-kuroto-nuke","cinderhold-kuroto-pierce","cinderhold-kuroto-burst","cinderhold-kuroto-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-5","starter-nin-fire-aoe","starter-nin-wind-aoe","starter-nin-fire-4","starter-any-fire-1","starter-nin-wind-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-kuroto-nuke","cinderhold-kuroto-pierce","cinderhold-kuroto-burst","cinderhold-kuroto-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-kuroto-nuke","cinderhold-kuroto-pierce","cinderhold-kuroto-burst","cinderhold-kuroto-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-5","starter-nin-fire-aoe","starter-nin-fire-6","starter-nin-fire-4","starter-any-fire-1","starter-nin-fire-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-kuroto-nuke","cinderhold-kuroto-pierce","cinderhold-kuroto-burst","cinderhold-kuroto-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-5","starter-nin-fire-aoe","starter-nin-wind-aoe","starter-nin-fire-4","starter-any-fire-1","starter-nin-wind-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-kuroto-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-kuroto-pierce","level":1,"xp":0},{"jutsuId":"cinderhold-kuroto-burst","level":1,"xp":0},{"jutsuId":"cinderhold-kuroto-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-fire-2","level":1,"xp":0},{"jutsuId":"starter-nin-fire-5","level":1,"xp":0},{"jutsuId":"starter-nin-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-fire-6","level":1,"xp":0},{"jutsuId":"starter-nin-fire-4","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-nin-fire-3","level":1,"xp":0},{"jutsuId":"starter-nin-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-wind-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
            {"minLevel":55,"equipment":{"hand":"ashen-dragon-katana","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"mythic-3","species":"Solar Stag","rarity":"mythic","nickname":"Sootwhisker","signature":true,"instanceId":"mythic-3:npc-kuroto-1","trait":"Battleborn"},
            {"templateId":"mythic-7","species":"Turtle Duck","rarity":"mythic","nickname":"Cinderpaw","signature":false,"instanceId":"mythic-7:npc-kuroto-2","trait":"Aggressive"},
            {"templateId":"mythic-5","species":"Vermillion Suzaku","rarity":"mythic","nickname":"Tinderdancer","signature":false,"instanceId":"mythic-5:npc-kuroto-3","trait":"Battleborn"},
            {"templateId":"mythic-0","species":"Eclipse Kitsune","rarity":"mythic","nickname":"Cinderpip","signature":false,"instanceId":"mythic-0:npc-kuroto-4","trait":"Aggressive"},
        ],
        deck: { name: "Throne of Embers", cards: ["tc-117","tc-117","tc-125","tc-31","tc-31","tc-42","tc-42","tc-42","tc-56","tc-56","tc-61","tc-61","tc-61","tc-108","tc-108","tc-108","tc-38","tc-78","tc-78","tc-83","tc-83","tc-143","tc-50","tc-74","tc-149","chronicle-field-volcano","chronicle-giant-felling-edict","chronicle-grave-lantern-rite","chronicle-grave-lantern-rite","chronicle-hollow-breach","chronicle-hollow-breach","chronicle-abyssal-pitfall","chronicle-cinder-minefield","chronicle-cinder-minefield","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-pitfall-tag-array","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-abyssal-pitfall","chronicle-cinder-minefield","chronicle-cinder-minefield","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-giant-felling-edict","chronicle-grave-lantern-rite","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-hollow-breach","chronicle-hollow-breach","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","chronicle-widespread-kunai-line","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-108","tc-108","tc-108","tc-11","tc-117","tc-117","tc-125","tc-143","tc-149","tc-15","tc-19","tc-21","tc-23","tc-31","tc-31","tc-36","tc-38","tc-42","tc-42","tc-42","tc-50","tc-54","tc-56","tc-56","tc-61","tc-61","tc-61","tc-67","tc-70","tc-74","tc-78","tc-78","tc-83","tc-83"],
    },
    {
        id: "renji",
        name: "Renji",
        rank: "commander",
        personality: "guardian",
        avatar: "/npc-portraits/renji.avif",
        specialty: "Taijutsu",
        elements: ["Earth","Fire"],
        stats: {"strength":1,"speed":0.95,"intelligence":0.36,"willpower":0.39,"bukijutsuOffense":0.11,"bukijutsuDefense":0.85,"taijutsuOffense":1,"taijutsuDefense":0.81,"genjutsuOffense":0.13,"genjutsuDefense":0.8,"ninjutsuOffense":0.2,"ninjutsuDefense":0.85},
        bloodline: { ...{"id":"cinderhold-renji-bloodline","name":"Basalt Bulwark","rank":"A Rank","specialElement":"Basalt","weatherElement":"Earth","lore":"Basalt Bulwark shinobi grow a second skin of cooled lava when they are struck. The outer gate of Cinderhold was built in their image.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-renji-bind","name":"Basalt Bind","type":"Taijutsu","element":"Basalt","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0},{"name":"Recoil","percent":30}],"battleDescription":"Basalt chains lock %target where they stand.","description":"Basalt chains lock %target where they stand.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-renji-bulwark","name":"Basalt Aegis","type":"Taijutsu","element":"Basalt","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0},{"name":"Decrease Damage Taken","percent":25}],"battleDescription":"A Basalt shell closes around %user before the blow lands.","description":"A Basalt shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-renji-riposte","name":"Basalt Counter","type":"Taijutsu","element":"Basalt","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":25},{"name":"Wound","percent":25}],"battleDescription":"%user turns the force of %target back on them with a Basalt counter.","description":"%user turns the force of %target back on them with a Basalt counter.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-renji-stance","name":"Basalt Stance","type":"Any","element":"Basalt","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":25},{"name":"Debuff Prevent","percent":0},{"name":"Absorb","percent":25}],"battleDescription":"%user plants their feet as Basalt hardens over their skin.","description":"%user plants their feet as Basalt hardens over their skin.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-renji-bind","cinderhold-renji-bulwark","cinderhold-renji-riposte","cinderhold-renji-stance","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-5","starter-tai-earth-aoe","starter-tai-fire-2","starter-any-earth-1","starter-tai-earth-3","starter-tai-fire-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-renji-bind","cinderhold-renji-bulwark","cinderhold-renji-riposte","cinderhold-renji-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-renji-bind","cinderhold-renji-bulwark","cinderhold-renji-riposte","cinderhold-renji-stance","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-5","starter-tai-earth-aoe","starter-tai-earth-2","starter-any-earth-1","starter-tai-earth-3","starter-tai-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-renji-bind","cinderhold-renji-bulwark","cinderhold-renji-riposte","cinderhold-renji-stance","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-5","starter-tai-earth-aoe","starter-tai-fire-2","starter-any-earth-1","starter-tai-earth-3","starter-tai-fire-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-renji-bind","level":1,"xp":0},{"jutsuId":"cinderhold-renji-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-renji-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-renji-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-earth-6","level":1,"xp":0},{"jutsuId":"starter-tai-earth-5","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-earth-2","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-tai-earth-3","level":1,"xp":0},{"jutsuId":"starter-tai-earth-1","level":1,"xp":0},{"jutsuId":"starter-tai-fire-2","level":1,"xp":0},{"jutsuId":"starter-tai-fire-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"stormcoil-kusarigama","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
            {"minLevel":55,"equipment":{"hand":"glacier-king-cleaver","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
        ],
        pets: [
            {"templateId":"mythic-9","species":"Worldroot Colossus","rarity":"mythic","nickname":"Hazeshade","signature":true,"instanceId":"mythic-9:npc-renji-1","trait":"Loyal"},
            {"templateId":"mythic-4","species":"Abyssal Oni Hound","rarity":"mythic","nickname":"Charhorn","signature":false,"instanceId":"mythic-4:npc-renji-2","trait":"Guardian"},
            {"templateId":"legendary-4","species":"Ironfang Tiger","rarity":"legendary","nickname":"Scoriaheart","signature":false,"instanceId":"legendary-4:npc-renji-3","trait":"Loyal"},
            {"templateId":"legendary-9","species":"Crystal Bear","rarity":"legendary","nickname":"Charpip","signature":false,"instanceId":"legendary-9:npc-renji-4","trait":"Loyal"},
        ],
        deck: { name: "Caldera Wall", cards: ["tc-26","tc-26","tc-26","tc-47","tc-47","tc-71","tc-71","tc-121","tc-121","tc-121","tc-126","tc-126","tc-43","tc-43","tc-114","tc-114","tc-114","tc-28","tc-28","tc-78","tc-129","tc-129","chronicle-field-desert","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-hundred-shrine-benediction","chronicle-hundred-shrine-benediction","chronicle-iron-root-stance","chronicle-mirage-displacement","chronicle-reanimation-jutsu","chronicle-shadow-clone","chronicle-shadow-clone","chronicle-tideguard-mantle","chronicle-tideguard-mantle","chronicle-kage-archive-lock","chronicle-reapers-toll","chronicle-sovereigns-decree","chronicle-stone-clone-barrier","chronicle-torrential-tag-field"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-hundred-shrine-benediction","chronicle-hundred-shrine-benediction","chronicle-iron-root-stance","chronicle-kage-archive-lock","chronicle-medical-salve","chronicle-medical-salve","chronicle-mirage-displacement","chronicle-reanimation-jutsu","chronicle-reapers-toll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-shadow-clone","chronicle-shadow-clone","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-sovereigns-decree","chronicle-stone-clone-barrier","chronicle-substitution-log","chronicle-substitution-log","chronicle-tideguard-mantle","chronicle-tideguard-mantle","chronicle-torrential-tag-field","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-114","tc-114","tc-114","tc-121","tc-121","tc-121","tc-126","tc-126","tc-129","tc-129","tc-15","tc-19","tc-21","tc-23","tc-26","tc-26","tc-26","tc-28","tc-28","tc-31","tc-36","tc-38","tc-43","tc-43","tc-47","tc-47","tc-54","tc-67","tc-70","tc-71","tc-71","tc-78"],
    },
    {
        id: "virath",
        name: "Virath",
        rank: "commander",
        personality: "trickster",
        avatar: "/npc-portraits/virath.avif",
        specialty: "Genjutsu",
        elements: ["Fire","Lightning"],
        stats: {"strength":0.38,"speed":0.31,"intelligence":1,"willpower":0.89,"bukijutsuOffense":0.18,"bukijutsuDefense":0.55,"taijutsuOffense":0.16,"taijutsuDefense":0.59,"genjutsuOffense":1,"genjutsuDefense":0.57,"ninjutsuOffense":0.2,"ninjutsuDefense":0.64},
        bloodline: { ...{"id":"cinderhold-virath-bloodline","name":"Smokeglass Mirage","rank":"A Rank","specialElement":"Smokeglass","weatherElement":"Fire","lore":"The Smokeglass Mirage bends light through drifting soot until an enemy cannot trust their own eyes. Cinderhold sends its users first and lets the battlefield doubt itself.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-virath-lock","name":"Smokeglass Stillness","type":"Genjutsu","element":"Smokeglass","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Smokeglass sparks freeze %target in place.","description":"Smokeglass sparks freeze %target in place.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-virath-sever","name":"Smokeglass Severance","type":"Genjutsu","element":"Smokeglass","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Bloodline Seal","percent":0},{"name":"Poison","percent":25}],"battleDescription":"A Smokeglass seal cuts %target off from their bloodline.","description":"A Smokeglass seal cuts %target off from their bloodline.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-virath-burst","name":"Smokeglass Burst","type":"Genjutsu","element":"Smokeglass","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Recoil","percent":25},{"name":"Ignition","percent":25}],"battleDescription":"A Smokeglass burst detonates around %target.","description":"A Smokeglass burst detonates around %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-virath-fog","name":"Smokeglass Veil","type":"Any","element":"Smokeglass","ap":40,"range":4,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Buff Prevent","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Smokeglass fog clouds the senses of %target.","description":"Smokeglass fog clouds the senses of %target.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-virath-lock","cinderhold-virath-sever","cinderhold-virath-burst","cinderhold-virath-fog","starter-universal-flicker","starter-gen-fire-2","starter-gen-fire-aoe","starter-gen-fire-6","starter-gen-lightning-5","starter-gen-fire-1","starter-gen-fire-4","starter-gen-lightning-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-virath-lock","cinderhold-virath-sever","cinderhold-virath-burst","cinderhold-virath-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-virath-lock","cinderhold-virath-sever","cinderhold-virath-burst","cinderhold-virath-fog","starter-universal-flicker","starter-gen-fire-2","starter-gen-fire-aoe","starter-gen-fire-6","starter-gen-fire-5","starter-gen-fire-1","starter-gen-fire-4","starter-any-fire-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-virath-lock","cinderhold-virath-sever","cinderhold-virath-burst","cinderhold-virath-fog","starter-universal-flicker","starter-gen-fire-2","starter-gen-fire-aoe","starter-gen-fire-6","starter-gen-lightning-5","starter-gen-fire-1","starter-gen-fire-4","starter-gen-lightning-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-virath-lock","level":1,"xp":0},{"jutsuId":"cinderhold-virath-sever","level":1,"xp":0},{"jutsuId":"cinderhold-virath-burst","level":1,"xp":0},{"jutsuId":"cinderhold-virath-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-fire-2","level":1,"xp":0},{"jutsuId":"starter-gen-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-fire-6","level":1,"xp":0},{"jutsuId":"starter-gen-fire-5","level":1,"xp":0},{"jutsuId":"starter-gen-fire-1","level":1,"xp":0},{"jutsuId":"starter-gen-fire-4","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-5","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
            {"minLevel":55,"equipment":{"hand":"eclipse-fang-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"mythic-6","species":"Azure Ryujin","rarity":"mythic","nickname":"Coalear","signature":true,"instanceId":"mythic-6:npc-virath-1","trait":"Lucky"},
            {"templateId":"mythic-8","species":"Stormgod Raijin","rarity":"mythic","nickname":"Smoketail","signature":false,"instanceId":"mythic-8:npc-virath-2","trait":"Swift"},
            {"templateId":"legendary-16","species":"Ash Garuda","rarity":"legendary","nickname":"Lumenscale","signature":false,"instanceId":"legendary-16:npc-virath-3","trait":"Swift"},
            {"templateId":"legendary-10","species":"Void Raven","rarity":"legendary","nickname":"Coalbite","signature":false,"instanceId":"legendary-10:npc-virath-4","trait":"Lucky"},
        ],
        deck: { name: "Hall of Smoke", cards: ["tc-125","tc-56","tc-56","tc-61","tc-61","tc-61","tc-108","tc-108","tc-126","tc-126","tc-126","tc-13","tc-13","tc-13","tc-87","tc-87","tc-137","tc-137","tc-142","tc-78","tc-78","tc-148","tc-148","chronicle-crimson-insight","chronicle-field-volcano","chronicle-field-volcano","chronicle-hundred-shrine-benediction","chronicle-kage-exile-command","chronicle-mirage-displacement","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-tempered-kunai","chronicle-whirlwind-dismissal","chronicle-five-seal-denial","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-reapers-toll","chronicle-substitution-mirror","chronicle-substitution-mirror","chronicle-torrential-tag-field"] },
        collection: ["chronicle-crimson-insight","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-field-volcano","chronicle-five-seal-denial","chronicle-guard-stance","chronicle-guard-stance","chronicle-hundred-shrine-benediction","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-kage-exile-command","chronicle-medical-salve","chronicle-medical-salve","chronicle-mirage-displacement","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-reapers-toll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-substitution-mirror","chronicle-tempered-kunai","chronicle-torrential-tag-field","chronicle-whirlwind-dismissal","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-108","tc-108","tc-11","tc-125","tc-126","tc-126","tc-126","tc-13","tc-13","tc-13","tc-137","tc-137","tc-142","tc-148","tc-148","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-54","tc-56","tc-56","tc-61","tc-61","tc-61","tc-67","tc-70","tc-78","tc-78","tc-87","tc-87"],
    },
    {
        id: "kat",
        name: "Kat",
        rank: "elite",
        personality: "aggressive",
        avatar: "/npc-portraits/kat.avif",
        specialty: "Taijutsu",
        elements: ["Fire","Earth"],
        stats: {"strength":1,"speed":0.92,"intelligence":0.34,"willpower":0.31,"bukijutsuOffense":0.11,"bukijutsuDefense":0.49,"taijutsuOffense":1,"taijutsuDefense":0.54,"genjutsuOffense":0.17,"genjutsuDefense":0.53,"ninjutsuOffense":0.16,"ninjutsuDefense":0.49},
        bloodline: { ...{"id":"cinderhold-kat-bloodline","name":"Magma Fang","rank":"A Rank","specialElement":"Magma","weatherElement":"Fire","lore":"A Magma Fang strike leaves rock glowing for an hour after the fight is over. The line was born in the deep vents beneath the village.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-kat-nuke","name":"Magma Ruin","type":"Taijutsu","element":"Magma","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":25},{"name":"Wound","percent":25}],"battleDescription":"Magma chakra erupts over %target in one ruinous blast.","description":"Magma chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kat-pierce","name":"Magma Needle","type":"Taijutsu","element":"Magma","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pierce","percent":0},{"name":"Lifesteal","percent":25}],"battleDescription":"A Magma lance drives straight through the guard of %target.","description":"A Magma lance drives straight through the guard of %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kat-burst","name":"Magma Burst","type":"Taijutsu","element":"Magma","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Ignition","percent":30}],"battleDescription":"A Magma burst detonates around %target.","description":"A Magma burst detonates around %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kat-trance","name":"Magma Frenzy","type":"Any","element":"Magma","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":25},{"name":"Overclock","percent":0},{"name":"Lifesteal","percent":30}],"battleDescription":"%user breathes in Magma heat and moves faster than thought.","description":"%user breathes in Magma heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-kat-nuke","cinderhold-kat-pierce","cinderhold-kat-burst","cinderhold-kat-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-earth-aoe","starter-tai-fire-1","starter-tai-fire-4","starter-any-earth-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-kat-nuke","cinderhold-kat-pierce","cinderhold-kat-burst","cinderhold-kat-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-kat-nuke","cinderhold-kat-pierce","cinderhold-kat-burst","cinderhold-kat-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-fire-2","starter-tai-fire-1","starter-tai-fire-4","starter-tai-fire-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-kat-nuke","cinderhold-kat-pierce","cinderhold-kat-burst","cinderhold-kat-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-earth-aoe","starter-tai-fire-1","starter-tai-fire-4","starter-any-earth-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-kat-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-kat-pierce","level":1,"xp":0},{"jutsuId":"cinderhold-kat-burst","level":1,"xp":0},{"jutsuId":"cinderhold-kat-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-fire-6","level":1,"xp":0},{"jutsuId":"starter-tai-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-fire-5","level":1,"xp":0},{"jutsuId":"starter-tai-fire-2","level":1,"xp":0},{"jutsuId":"starter-tai-fire-1","level":1,"xp":0},{"jutsuId":"starter-tai-fire-4","level":1,"xp":0},{"jutsuId":"starter-tai-fire-3","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"stormcoil-kusarigama","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"embercoil-scythe","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
            {"minLevel":55,"equipment":{"hand":"glacier-king-cleaver","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"mythic-1","species":"Worldstorm Dragon","rarity":"mythic","nickname":"Ashmane","signature":true,"instanceId":"mythic-1:npc-kat-1","trait":"Battleborn"},
            {"templateId":"legendary-6","species":"Ember Phoenix","rarity":"legendary","nickname":"Soottail","signature":false,"instanceId":"legendary-6:npc-kat-2","trait":"Aggressive"},
            {"templateId":"legendary-13","species":"Armored Polar Bear","rarity":"legendary","nickname":"Charwing","signature":false,"instanceId":"legendary-13:npc-kat-3","trait":"Battleborn"},
            {"templateId":"rare-0","species":"Crimson Fox","rarity":"rare","nickname":"Kindlewing","signature":false,"instanceId":"rare-0:npc-kat-4","trait":"Aggressive"},
        ],
        deck: { name: "Molten Maw", cards: ["tc-01","tc-01","tc-01","tc-08","tc-08","tc-117","tc-117","tc-24","tc-126","tc-126","tc-13","tc-13","tc-92","tc-92","tc-28","tc-28","tc-28","tc-99","tc-54","tc-54","tc-59","tc-74","chronicle-crimson-insight","chronicle-crimson-insight","chronicle-field-volcano","chronicle-hundredfold-tempest","chronicle-rift-cleaving-script","chronicle-tempered-kunai","chronicle-tempered-kunai","chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-cinder-minefield","chronicle-explosive-tag","chronicle-great-maw-seal","chronicle-hearthfire-expulsion","chronicle-imperial-silence-ward","chronicle-imperial-silence-ward","chronicle-kage-judgment-seal","chronicle-long-watch","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-cinder-minefield","chronicle-crimson-insight","chronicle-crimson-insight","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-great-maw-seal","chronicle-guard-stance","chronicle-guard-stance","chronicle-hearthfire-expulsion","chronicle-hundredfold-tempest","chronicle-imperial-silence-ward","chronicle-imperial-silence-ward","chronicle-kage-judgment-seal","chronicle-long-watch","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","chronicle-tempered-kunai","chronicle-tempered-kunai","chronicle-widespread-kunai-line","tc-01","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-08","tc-09","tc-09","tc-11","tc-117","tc-117","tc-126","tc-126","tc-13","tc-13","tc-15","tc-19","tc-21","tc-23","tc-24","tc-28","tc-28","tc-28","tc-31","tc-36","tc-38","tc-54","tc-54","tc-59","tc-67","tc-70","tc-74","tc-92","tc-92","tc-99"],
    },
    {
        id: "raku",
        name: "Raku",
        rank: "elite",
        personality: "medic",
        avatar: "/npc-portraits/raku.avif",
        specialty: "Ninjutsu",
        elements: ["Water","Fire"],
        stats: {"strength":0.37,"speed":0.92,"intelligence":0.32,"willpower":1,"bukijutsuOffense":0.18,"bukijutsuDefense":0.74,"taijutsuOffense":0.11,"taijutsuDefense":0.72,"genjutsuOffense":0.15,"genjutsuDefense":0.66,"ninjutsuOffense":1,"ninjutsuDefense":0.72},
        bloodline: { ...{"id":"cinderhold-raku-bloodline","name":"Scalding Mist","rank":"A Rank","specialElement":"Steam","weatherElement":"Water","lore":"Scalding Mist healers learned their craft in the hot springs that ring the volcano. The same steam that mends an ally can boil an enemy where they stand.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-raku-mend","name":"Steam Mending","type":"Any","element":"Steam","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Increase Heal","percent":25},{"name":"Decrease Damage Taken","percent":30}],"battleDescription":"Steam warmth closes the wounds of %user.","description":"Steam warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Water"},
            {"id":"cinderhold-raku-leech","name":"Steam Draw","type":"Ninjutsu","element":"Steam","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Steam threads pull life out of %target.","description":"Steam threads pull life out of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-raku-vamp","name":"Steam Feast","type":"Ninjutsu","element":"Steam","ap":60,"range":4,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":30},{"name":"Siphon","percent":30}],"battleDescription":"A Steam strike feeds %user on the strength of %target.","description":"A Steam strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-raku-seal","name":"Steam Seal","type":"Ninjutsu","element":"Steam","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Elemental Seal","percent":0},{"name":"Poison","percent":30}],"battleDescription":"A Steam seal smothers the chakra of %target.","description":"A Steam seal smothers the chakra of %target.","isUtility":false,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-raku-mend","cinderhold-raku-leech","cinderhold-raku-vamp","cinderhold-raku-seal","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-fire-6","starter-any-water-1","starter-nin-water-1","starter-nin-fire-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-raku-mend","cinderhold-raku-leech","cinderhold-raku-vamp","cinderhold-raku-seal","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-raku-mend","cinderhold-raku-leech","cinderhold-raku-vamp","cinderhold-raku-seal","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-water-aoe","starter-any-water-1","starter-nin-water-1","starter-nin-water-4"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-raku-mend","cinderhold-raku-leech","cinderhold-raku-vamp","cinderhold-raku-seal","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-fire-6","starter-any-water-1","starter-nin-water-1","starter-nin-fire-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-raku-mend","level":1,"xp":0},{"jutsuId":"cinderhold-raku-leech","level":1,"xp":0},{"jutsuId":"cinderhold-raku-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-raku-seal","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-water-6","level":1,"xp":0},{"jutsuId":"starter-nin-water-2","level":1,"xp":0},{"jutsuId":"starter-nin-water-5","level":1,"xp":0},{"jutsuId":"starter-nin-water-aoe","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-4","level":1,"xp":0},{"jutsuId":"starter-nin-fire-6","level":1,"xp":0},{"jutsuId":"starter-nin-fire-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
            {"minLevel":55,"equipment":{"hand":"ashen-dragon-katana","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"mythic-2","species":"Ancient Frost Titan","rarity":"mythic","nickname":"Magmadancer","signature":true,"instanceId":"mythic-2:npc-raku-1","trait":"Loyal"},
            {"templateId":"legendary-18","species":"Tidelord Leviathan","rarity":"legendary","nickname":"Pyrenose","signature":false,"instanceId":"legendary-18:npc-raku-2","trait":"Lucky"},
            {"templateId":"legendary-12","species":"Frost Lynx","rarity":"legendary","nickname":"Tinderheart","signature":false,"instanceId":"legendary-12:npc-raku-3","trait":"Loyal"},
            {"templateId":"rare-31","species":"Frost Seal","rarity":"rare","nickname":"Kindlenose","signature":false,"instanceId":"rare-31:npc-raku-4","trait":"Lucky"},
        ],
        deck: { name: "Hot Springs Rite", cards: ["tc-107","tc-107","tc-107","tc-108","tc-141","tc-141","tc-141","tc-57","tc-57","tc-57","tc-82","tc-82","tc-82","tc-98","tc-98","tc-23","tc-23","tc-23","tc-38","tc-38","tc-38","tc-41","tc-41","chronicle-ancestral-muster","chronicle-chakra-ledger","chronicle-deathless-recall","chronicle-executioners-mandate","chronicle-field-ocean","chronicle-field-ocean","chronicle-forbidden-archive","chronicle-grave-lantern-rite","chronicle-grave-lantern-rite","chronicle-medical-salve","chronicle-reanimation-jutsu","chronicle-rift-cleaving-script","chronicle-stacked-scrolls","chronicle-tempered-kunai","chronicle-tempered-kunai","chronicle-smoke-bomb","chronicle-still-water-rebuttal"] },
        collection: ["chronicle-ancestral-muster","chronicle-chakra-ledger","chronicle-deathless-recall","chronicle-executioners-mandate","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-field-ocean","chronicle-forbidden-archive","chronicle-grave-lantern-rite","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-reanimation-jutsu","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stacked-scrolls","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-tempered-kunai","chronicle-tempered-kunai","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-107","tc-107","tc-107","tc-108","tc-11","tc-141","tc-141","tc-141","tc-15","tc-19","tc-21","tc-23","tc-23","tc-23","tc-31","tc-36","tc-38","tc-38","tc-38","tc-41","tc-41","tc-54","tc-57","tc-57","tc-57","tc-67","tc-70","tc-82","tc-82","tc-82","tc-98","tc-98"],
    },
    {
        id: "nozomi",
        name: "Nozomi",
        rank: "elite",
        personality: "trickster",
        avatar: "/npc-portraits/nozomi.avif",
        specialty: "Genjutsu",
        elements: ["Wind","Fire"],
        stats: {"strength":0.4,"speed":0.38,"intelligence":1,"willpower":0.86,"bukijutsuOffense":0.12,"bukijutsuDefense":0.64,"taijutsuOffense":0.18,"taijutsuDefense":0.58,"genjutsuOffense":1,"genjutsuDefense":0.57,"ninjutsuOffense":0.14,"ninjutsuDefense":0.58},
        bloodline: { ...{"id":"cinderhold-nozomi-bloodline","name":"Ashwind Illusion","rank":"A Rank","specialElement":"Ashwind","weatherElement":"Wind","lore":"An Ashwind Illusion rides the grey dust that falls on Cinderhold every evening. Those who breathe it see whatever the caster wishes them to see.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-nozomi-lock","name":"Ashwind Lock","type":"Genjutsu","element":"Ashwind","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"Ashwind sparks freeze %target in place.","description":"Ashwind sparks freeze %target in place.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-nozomi-sever","name":"Ashwind Cut","type":"Genjutsu","element":"Ashwind","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Bloodline Seal","percent":0},{"name":"Poison","percent":30}],"battleDescription":"A Ashwind seal cuts %target off from their bloodline.","description":"A Ashwind seal cuts %target off from their bloodline.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-nozomi-burst","name":"Ashwind Bloom","type":"Genjutsu","element":"Ashwind","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Recoil","percent":25},{"name":"Ignition","percent":25}],"battleDescription":"A Ashwind burst detonates around %target.","description":"A Ashwind burst detonates around %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-nozomi-fog","name":"Ashwind Fog","type":"Any","element":"Ashwind","ap":40,"range":4,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Buff Prevent","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Ashwind fog clouds the senses of %target.","description":"Ashwind fog clouds the senses of %target.","isUtility":true,"weatherElement":"Wind"},
        ] },
        equippedJutsuIds: ["cinderhold-nozomi-lock","cinderhold-nozomi-sever","cinderhold-nozomi-burst","cinderhold-nozomi-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-2","starter-gen-wind-5","starter-gen-fire-aoe","starter-gen-wind-4","starter-any-wind-1","starter-gen-fire-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-nozomi-lock","cinderhold-nozomi-sever","cinderhold-nozomi-burst","cinderhold-nozomi-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-nozomi-lock","cinderhold-nozomi-sever","cinderhold-nozomi-burst","cinderhold-nozomi-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-2","starter-gen-wind-5","starter-gen-wind-6","starter-gen-wind-4","starter-any-wind-1","starter-gen-wind-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-nozomi-lock","cinderhold-nozomi-sever","cinderhold-nozomi-burst","cinderhold-nozomi-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-2","starter-gen-wind-5","starter-gen-fire-aoe","starter-gen-wind-4","starter-any-wind-1","starter-gen-fire-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-nozomi-lock","level":1,"xp":0},{"jutsuId":"cinderhold-nozomi-sever","level":1,"xp":0},{"jutsuId":"cinderhold-nozomi-burst","level":1,"xp":0},{"jutsuId":"cinderhold-nozomi-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-wind-2","level":1,"xp":0},{"jutsuId":"starter-gen-wind-5","level":1,"xp":0},{"jutsuId":"starter-gen-wind-6","level":1,"xp":0},{"jutsuId":"starter-gen-wind-4","level":1,"xp":0},{"jutsuId":"starter-any-wind-1","level":1,"xp":0},{"jutsuId":"starter-gen-wind-1","level":1,"xp":0},{"jutsuId":"starter-gen-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-fire-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
            {"minLevel":55,"equipment":{"hand":"eclipse-fang-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"mythic-15","species":"Celestial Lion","rarity":"mythic","nickname":"Flintsong","signature":true,"instanceId":"mythic-15:npc-nozomi-1","trait":"Lucky"},
            {"templateId":"legendary-14","species":"Ancient Crane","rarity":"legendary","nickname":"Flinthorn","signature":false,"instanceId":"legendary-14:npc-nozomi-2","trait":"Lucky"},
            {"templateId":"legendary-2","species":"Umbra Fox","rarity":"legendary","nickname":"Scoriapip","signature":false,"instanceId":"legendary-2:npc-nozomi-3","trait":"Lucky"},
            {"templateId":"rare-35","species":"Cyclone Harrier","rarity":"rare","nickname":"Hazeclaw","signature":false,"instanceId":"rare-35:npc-nozomi-4","trait":"Lucky"},
        ],
        deck: { name: "Drifting Ash", cards: ["tc-06","tc-06","tc-06","tc-112","tc-112","tc-112","tc-02","tc-02","tc-118","tc-118","tc-118","tc-17","tc-17","tc-85","tc-85","tc-137","tc-137","tc-137","tc-142","tc-49","tc-49","tc-84","tc-84","tc-84","chronicle-field-sky","chronicle-field-sky","chronicle-final-bulwark","chronicle-final-bulwark","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-kage-exile-command","chronicle-gatekeepers-rebuke","chronicle-guardians-reversal","chronicle-guardians-reversal","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-palm-ward","chronicle-substitution-mirror","chronicle-vacuum-prison","chronicle-wall-of-smoke"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-sky","chronicle-field-sky","chronicle-final-bulwark","chronicle-final-bulwark","chronicle-gatekeepers-rebuke","chronicle-guard-stance","chronicle-guard-stance","chronicle-guardians-reversal","chronicle-guardians-reversal","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-kage-exile-command","chronicle-medical-salve","chronicle-medical-salve","chronicle-palm-ward","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-vacuum-prison","chronicle-wall-of-smoke","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-06","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-112","tc-112","tc-112","tc-118","tc-118","tc-118","tc-137","tc-137","tc-137","tc-142","tc-15","tc-17","tc-17","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-49","tc-49","tc-54","tc-67","tc-70","tc-84","tc-84","tc-84","tc-85","tc-85"],
    },
    {
        id: "nyra",
        name: "Nyra",
        rank: "elite",
        personality: "guardian",
        avatar: "/npc-portraits/nyra.avif",
        specialty: "Bukijutsu",
        elements: ["Earth","Lightning"],
        stats: {"strength":1,"speed":0.32,"intelligence":0.87,"willpower":0.31,"bukijutsuOffense":1,"bukijutsuDefense":0.82,"taijutsuOffense":0.11,"taijutsuDefense":0.87,"genjutsuOffense":0.14,"genjutsuDefense":0.8,"ninjutsuOffense":0.14,"ninjutsuDefense":0.9},
        bloodline: { ...{"id":"cinderhold-nyra-bloodline","name":"Obsidian Mantle","rank":"A Rank","specialElement":"Obsidian","weatherElement":"Earth","lore":"The Obsidian Mantle hardens chakra into volcanic glass that is sharp on one side and unbreakable on the other. Its keepers guard the caldera stairs.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-nyra-bind","name":"Obsidian Bind","type":"Bukijutsu","element":"Obsidian","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0},{"name":"Recoil","percent":30}],"battleDescription":"Obsidian chains lock %target where they stand.","description":"Obsidian chains lock %target where they stand.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-nyra-bulwark","name":"Obsidian Aegis","type":"Bukijutsu","element":"Obsidian","ap":60,"range":4,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0},{"name":"Absorb","percent":25}],"battleDescription":"A Obsidian shell closes around %user before the blow lands.","description":"A Obsidian shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-nyra-riposte","name":"Obsidian Riposte","type":"Bukijutsu","element":"Obsidian","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":30},{"name":"Wound","percent":30}],"battleDescription":"%user turns the force of %target back on them with a Obsidian counter.","description":"%user turns the force of %target back on them with a Obsidian counter.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-nyra-stance","name":"Obsidian Skin","type":"Any","element":"Obsidian","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":30},{"name":"Debuff Prevent","percent":0}],"battleDescription":"%user plants their feet as Obsidian hardens over their skin.","description":"%user plants their feet as Obsidian hardens over their skin.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-nyra-bind","cinderhold-nyra-bulwark","cinderhold-nyra-riposte","cinderhold-nyra-stance","starter-universal-flicker","starter-buki-earth-5","starter-buki-earth-2","starter-buki-earth-aoe","starter-buki-lightning-2","starter-any-earth-1","starter-buki-earth-4","starter-buki-lightning-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-nyra-bind","cinderhold-nyra-bulwark","cinderhold-nyra-riposte","cinderhold-nyra-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-nyra-bind","cinderhold-nyra-bulwark","cinderhold-nyra-riposte","cinderhold-nyra-stance","starter-universal-flicker","starter-buki-earth-5","starter-buki-earth-2","starter-buki-earth-aoe","starter-buki-earth-6","starter-any-earth-1","starter-buki-earth-4","starter-buki-earth-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-nyra-bind","cinderhold-nyra-bulwark","cinderhold-nyra-riposte","cinderhold-nyra-stance","starter-universal-flicker","starter-buki-earth-5","starter-buki-earth-2","starter-buki-earth-aoe","starter-buki-lightning-2","starter-any-earth-1","starter-buki-earth-4","starter-buki-lightning-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-nyra-bind","level":1,"xp":0},{"jutsuId":"cinderhold-nyra-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-nyra-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-nyra-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-earth-5","level":1,"xp":0},{"jutsuId":"starter-buki-earth-2","level":1,"xp":0},{"jutsuId":"starter-buki-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-earth-6","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-buki-earth-4","level":1,"xp":0},{"jutsuId":"starter-buki-earth-3","level":1,"xp":0},{"jutsuId":"starter-buki-lightning-2","level":1,"xp":0},{"jutsuId":"starter-buki-lightning-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"cracked-bone-dagger","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"cracked-bone-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"ironwall-crown","body":"ironwall-chest","waist":"ironwall-waist","legs":"ironwall-legs","feet":"ironwall-feet"}},
            {"minLevel":55,"equipment":{"hand":"worldsplitter-katana","head":"ironwall-crown","body":"ironwall-chest","waist":"ironwall-waist","legs":"ironwall-legs","feet":"ironwall-feet"}},
        ],
        pets: [
            {"templateId":"legendary-29","species":"Verdant Treant","rarity":"legendary","nickname":"Pyreburr","signature":true,"instanceId":"legendary-29:npc-nyra-1","trait":"Loyal"},
            {"templateId":"legendary-27","species":"Titan Golem","rarity":"legendary","nickname":"Pumicepaw","signature":false,"instanceId":"legendary-27:npc-nyra-2","trait":"Loyal"},
            {"templateId":"legendary-11","species":"Thunder Drake","rarity":"legendary","nickname":"Ashwhisker","signature":false,"instanceId":"legendary-11:npc-nyra-3","trait":"Loyal"},
            {"templateId":"rare-11","species":"Glass Serpent","rarity":"rare","nickname":"Pumicedancer","signature":false,"instanceId":"rare-11:npc-nyra-4","trait":"Loyal"},
        ],
        deck: { name: "Black Glass Bastion", cards: ["tc-26","tc-26","tc-26","tc-47","tc-47","tc-07","tc-07","tc-07","tc-121","tc-121","tc-121","tc-48","tc-48","tc-48","tc-03","tc-03","tc-03","tc-28","tc-110","tc-110","tc-110","tc-128","chronicle-defiant-rampart","chronicle-defiant-rampart","chronicle-field-desert","chronicle-field-desert","chronicle-forbidden-archive","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-stoneplate-harness","chronicle-final-trial-binding","chronicle-long-watch","chronicle-long-watch","chronicle-long-watch","chronicle-returning-cylinder-seal"] },
        collection: ["chronicle-defiant-rampart","chronicle-defiant-rampart","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-field-desert","chronicle-final-trial-binding","chronicle-forbidden-archive","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-long-watch","chronicle-long-watch","chronicle-long-watch","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-returning-cylinder-seal","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stoneplate-harness","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-03","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-110","tc-110","tc-110","tc-121","tc-121","tc-121","tc-128","tc-15","tc-19","tc-21","tc-23","tc-26","tc-26","tc-26","tc-28","tc-31","tc-36","tc-38","tc-47","tc-47","tc-48","tc-48","tc-48","tc-54","tc-67","tc-70"],
    },
    {
        id: "roy",
        name: "Roy",
        rank: "elite",
        personality: "aggressive",
        avatar: "/npc-portraits/roy.avif",
        specialty: "Taijutsu",
        elements: ["Fire","Lightning"],
        stats: {"strength":1,"speed":0.93,"intelligence":0.39,"willpower":0.38,"bukijutsuOffense":0.15,"bukijutsuDefense":0.49,"taijutsuOffense":1,"taijutsuDefense":0.52,"genjutsuOffense":0.19,"genjutsuDefense":0.54,"ninjutsuOffense":0.11,"ninjutsuDefense":0.55},
        bloodline: { ...{"id":"cinderhold-roy-bloodline","name":"Ember Howl","rank":"A Rank","specialElement":"Emberblood","weatherElement":"Fire","lore":"Ember Howl shinobi fight like a wildfire chasing the wind. Their blood runs hot enough to light dry grass when it is spilled.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-roy-nuke","name":"Emberblood Ruin","type":"Taijutsu","element":"Emberblood","ap":60,"range":4,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Wound","percent":30}],"battleDescription":"Emberblood chakra erupts over %target in one ruinous blast.","description":"Emberblood chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-roy-pierce","name":"Emberblood Needle","type":"Taijutsu","element":"Emberblood","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pierce","percent":0}],"battleDescription":"A Emberblood lance drives straight through the guard of %target.","description":"A Emberblood lance drives straight through the guard of %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-roy-burst","name":"Emberblood Burst","type":"Taijutsu","element":"Emberblood","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Ignition","percent":30},{"name":"Wound","percent":30}],"battleDescription":"A Emberblood burst detonates around %target.","description":"A Emberblood burst detonates around %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-roy-trance","name":"Emberblood Trance","type":"Any","element":"Emberblood","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Overclock","percent":0},{"name":"Decrease Damage Taken","percent":30}],"battleDescription":"%user breathes in Emberblood heat and moves faster than thought.","description":"%user breathes in Emberblood heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-roy-nuke","cinderhold-roy-pierce","cinderhold-roy-burst","cinderhold-roy-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-lightning-aoe","starter-any-fire-1","starter-tai-fire-3","starter-tai-lightning-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-roy-nuke","cinderhold-roy-pierce","cinderhold-roy-burst","cinderhold-roy-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-roy-nuke","cinderhold-roy-pierce","cinderhold-roy-burst","cinderhold-roy-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-fire-2","starter-any-fire-1","starter-tai-fire-3","starter-tai-fire-4"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-roy-nuke","cinderhold-roy-pierce","cinderhold-roy-burst","cinderhold-roy-trance","starter-universal-flicker","starter-tai-fire-6","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-lightning-aoe","starter-any-fire-1","starter-tai-fire-3","starter-tai-lightning-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-roy-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-roy-pierce","level":1,"xp":0},{"jutsuId":"cinderhold-roy-burst","level":1,"xp":0},{"jutsuId":"cinderhold-roy-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-fire-6","level":1,"xp":0},{"jutsuId":"starter-tai-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-fire-5","level":1,"xp":0},{"jutsuId":"starter-tai-fire-2","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-tai-fire-3","level":1,"xp":0},{"jutsuId":"starter-tai-fire-4","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"stormcoil-kusarigama","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
            {"minLevel":55,"equipment":{"hand":"glacier-king-cleaver","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"legendary-17","species":"Magma Behemoth","rarity":"legendary","nickname":"Coalflick","signature":true,"instanceId":"legendary-17:npc-roy-1","trait":"Battleborn"},
            {"templateId":"legendary-26","species":"Galvanic Manticore","rarity":"legendary","nickname":"Hazefang","signature":false,"instanceId":"legendary-26:npc-roy-2","trait":"Battleborn"},
            {"templateId":"legendary-25","species":"Storm Wyvern","rarity":"legendary","nickname":"Smolderbite","signature":false,"instanceId":"legendary-25:npc-roy-3","trait":"Battleborn"},
            {"templateId":"rare-41","species":"Surge Stoat","rarity":"rare","nickname":"Blazeheart","signature":false,"instanceId":"rare-41:npc-roy-4","trait":"Battleborn"},
        ],
        deck: { name: "Pack of the Pyre", cards: ["tc-08","tc-08","tc-08","tc-117","tc-117","tc-135","tc-42","tc-42","tc-42","tc-81","tc-91","tc-91","tc-108","tc-108","tc-44","tc-44","tc-99","tc-99","tc-99","tc-133","tc-133","tc-149","chronicle-ancestral-muster","chronicle-field-volcano","chronicle-hollow-breach","chronicle-hundredfold-tempest","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-great-maw-seal","chronicle-hearthfire-expulsion","chronicle-imperial-silence-ward","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-ringed-detonation","chronicle-sovereigns-decree","chronicle-still-water-rebuttal"] },
        collection: ["chronicle-ancestral-muster","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-great-maw-seal","chronicle-guard-stance","chronicle-guard-stance","chronicle-hearthfire-expulsion","chronicle-hollow-breach","chronicle-hundredfold-tempest","chronicle-imperial-silence-ward","chronicle-imperial-silence-ward","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-ringed-detonation","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-sovereigns-decree","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-08","tc-08","tc-09","tc-09","tc-108","tc-108","tc-11","tc-117","tc-117","tc-133","tc-133","tc-135","tc-149","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-42","tc-42","tc-42","tc-44","tc-44","tc-54","tc-67","tc-70","tc-81","tc-91","tc-91","tc-99","tc-99","tc-99"],
    },
    {
        id: "mizuki",
        name: "Mizuki",
        rank: "jonin",
        personality: "aggressive",
        avatar: "/npc-portraits/mizuki.avif",
        specialty: "Bukijutsu",
        elements: ["Wind","Fire"],
        stats: {"strength":1,"speed":0.38,"intelligence":0.94,"willpower":0.39,"bukijutsuOffense":1,"bukijutsuDefense":0.55,"taijutsuOffense":0.18,"taijutsuDefense":0.51,"genjutsuOffense":0.18,"genjutsuDefense":0.46,"ninjutsuOffense":0.19,"ninjutsuDefense":0.53},
        bloodline: { ...{"id":"cinderhold-mizuki-bloodline","name":"Searing Gale","rank":"A Rank","specialElement":"Searwind","weatherElement":"Wind","lore":"The Searing Gale turns a thrown blade into a streak of burning wind. Its users were once the border hunters of the village.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-mizuki-nuke","name":"Searwind Cataclysm","type":"Bukijutsu","element":"Searwind","ap":60,"range":4,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Searwind chakra erupts over %target in one ruinous blast.","description":"Searwind chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-mizuki-pierce","name":"Searwind Lance","type":"Bukijutsu","element":"Searwind","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pierce","percent":0}],"battleDescription":"A Searwind lance drives straight through the guard of %target.","description":"A Searwind lance drives straight through the guard of %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-mizuki-rend","name":"Searwind Brand","type":"Bukijutsu","element":"Searwind","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Ignition","percent":30}],"battleDescription":"Searwind claws tear into %target and leave the wound burning.","description":"Searwind claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-mizuki-burst","name":"Searwind Burst","type":"Bukijutsu","element":"Searwind","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Lifesteal","percent":25}],"battleDescription":"A Searwind burst detonates around %target.","description":"A Searwind burst detonates around %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-mizuki-trance","name":"Searwind Trance","type":"Any","element":"Searwind","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Overclock","percent":0}],"battleDescription":"%user breathes in Searwind heat and moves faster than thought.","description":"%user breathes in Searwind heat and moves faster than thought.","isUtility":true,"weatherElement":"Wind"},
        ] },
        equippedJutsuIds: ["cinderhold-mizuki-nuke","cinderhold-mizuki-pierce","cinderhold-mizuki-rend","cinderhold-mizuki-burst","cinderhold-mizuki-trance","starter-universal-flicker","starter-buki-wind-2","starter-buki-wind-aoe","starter-buki-fire-2","starter-buki-wind-3","starter-buki-wind-4","starter-buki-fire-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-mizuki-nuke","cinderhold-mizuki-pierce","cinderhold-mizuki-rend","cinderhold-mizuki-burst","cinderhold-mizuki-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-mizuki-nuke","cinderhold-mizuki-pierce","cinderhold-mizuki-rend","cinderhold-mizuki-burst","cinderhold-mizuki-trance","starter-universal-flicker","starter-buki-wind-2","starter-buki-wind-aoe","starter-buki-wind-5","starter-buki-wind-3","starter-buki-wind-4","starter-buki-wind-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-mizuki-nuke","cinderhold-mizuki-pierce","cinderhold-mizuki-rend","cinderhold-mizuki-burst","cinderhold-mizuki-trance","starter-universal-flicker","starter-buki-wind-2","starter-buki-wind-aoe","starter-buki-fire-2","starter-buki-wind-3","starter-buki-wind-4","starter-buki-fire-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-mizuki-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-mizuki-pierce","level":1,"xp":0},{"jutsuId":"cinderhold-mizuki-rend","level":1,"xp":0},{"jutsuId":"cinderhold-mizuki-burst","level":1,"xp":0},{"jutsuId":"cinderhold-mizuki-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-wind-2","level":1,"xp":0},{"jutsuId":"starter-buki-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-wind-5","level":1,"xp":0},{"jutsuId":"starter-buki-wind-3","level":1,"xp":0},{"jutsuId":"starter-buki-wind-4","level":1,"xp":0},{"jutsuId":"starter-buki-wind-1","level":1,"xp":0},{"jutsuId":"starter-buki-fire-2","level":1,"xp":0},{"jutsuId":"starter-buki-fire-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"cracked-bone-dagger","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"cracked-bone-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
            {"minLevel":55,"equipment":{"hand":"void-leech-nodachi","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"legendary-22","species":"Tempest Pegasus","rarity":"legendary","nickname":"Lumenhorn","signature":true,"instanceId":"legendary-22:npc-mizuki-1","trait":"Aggressive"},
            {"templateId":"legendary-1","species":"Tempest Hawk","rarity":"legendary","nickname":"Scoriaclaw","signature":false,"instanceId":"legendary-1:npc-mizuki-2","trait":"Battleborn"},
            {"templateId":"rare-36","species":"Zephyr Osprey","rarity":"rare","nickname":"Sparknose","signature":false,"instanceId":"rare-36:npc-mizuki-3","trait":"Aggressive"},
            {"templateId":"rare-28","species":"Scoria Mongoose","rarity":"rare","nickname":"Hazebite","signature":false,"instanceId":"rare-28:npc-mizuki-4","trait":"Battleborn"},
        ],
        deck: { name: "Firestorm Front", cards: ["tc-125","tc-125","tc-125","tc-31","tc-31","tc-31","tc-61","tc-61","tc-02","tc-02","tc-02","tc-118","tc-118","tc-17","tc-17","tc-17","tc-49","tc-49","tc-49","tc-83","tc-75","tc-75","chronicle-defiant-rampart","chronicle-field-sky","chronicle-field-sky","chronicle-forbidden-archive","chronicle-hollow-breach","chronicle-hollow-breach","chronicle-hundredfold-tempest","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-sealbreak-verdict","chronicle-storm-shear","chronicle-abyssal-pitfall","chronicle-counter-script-cache","chronicle-great-maw-seal","chronicle-kage-judgment-seal","chronicle-sovereigns-decree","chronicle-substitution-mirror","chronicle-substitution-mirror"] },
        collection: ["chronicle-abyssal-pitfall","chronicle-counter-script-cache","chronicle-defiant-rampart","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-sky","chronicle-field-sky","chronicle-forbidden-archive","chronicle-great-maw-seal","chronicle-guard-stance","chronicle-guard-stance","chronicle-hollow-breach","chronicle-hollow-breach","chronicle-hundredfold-tempest","chronicle-kage-judgment-seal","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-sovereigns-decree","chronicle-storm-shear","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-substitution-mirror","tc-01","tc-01","tc-02","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-118","tc-118","tc-125","tc-125","tc-125","tc-15","tc-17","tc-17","tc-17","tc-19","tc-21","tc-23","tc-31","tc-31","tc-31","tc-36","tc-38","tc-49","tc-49","tc-49","tc-54","tc-61","tc-61","tc-67","tc-70","tc-75","tc-75","tc-83"],
    },
    {
        id: "sly",
        name: "Sly",
        rank: "jonin",
        personality: "guardian",
        avatar: "/npc-portraits/sly.avif",
        specialty: "Taijutsu",
        elements: ["Earth","Water"],
        stats: {"strength":1,"speed":0.94,"intelligence":0.32,"willpower":0.34,"bukijutsuOffense":0.14,"bukijutsuDefense":0.85,"taijutsuOffense":1,"taijutsuDefense":0.88,"genjutsuOffense":0.17,"genjutsuDefense":0.86,"ninjutsuOffense":0.16,"ninjutsuDefense":0.81},
        bloodline: { ...{"id":"cinderhold-sly-bloodline","name":"Pumice Shell","rank":"A Rank","specialElement":"Pumice","weatherElement":"Earth","lore":"Pumice Shell chakra is light and porous, and it swallows the force of a blow before it reaches the bone. The line has never lost a gate it was ordered to hold.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-sly-bulwark","name":"Pumice Aegis","type":"Taijutsu","element":"Pumice","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0},{"name":"Absorb","percent":30}],"battleDescription":"A Pumice shell closes around %user before the blow lands.","description":"A Pumice shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-sly-bind","name":"Pumice Bind","type":"Taijutsu","element":"Pumice","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0}],"battleDescription":"Pumice chains lock %target where they stand.","description":"Pumice chains lock %target where they stand.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-sly-riposte","name":"Pumice Counter","type":"Taijutsu","element":"Pumice","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":30}],"battleDescription":"%user turns the force of %target back on them with a Pumice counter.","description":"%user turns the force of %target back on them with a Pumice counter.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-sly-sap","name":"Pumice Sapping Haze","type":"Taijutsu","element":"Pumice","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0}],"battleDescription":"Pumice smoke saps the strength from the strikes of %target.","description":"Pumice smoke saps the strength from the strikes of %target.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-sly-stance","name":"Pumice Skin","type":"Any","element":"Pumice","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":30},{"name":"Absorb","percent":25},{"name":"Increase Heal","percent":25}],"battleDescription":"%user plants their feet as Pumice hardens over their skin.","description":"%user plants their feet as Pumice hardens over their skin.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-sly-bulwark","cinderhold-sly-bind","cinderhold-sly-riposte","cinderhold-sly-sap","cinderhold-sly-stance","starter-universal-flicker","starter-tai-earth-aoe","starter-tai-earth-2","starter-tai-water-2","starter-tai-earth-4","starter-tai-earth-3","starter-tai-water-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-sly-bulwark","cinderhold-sly-bind","cinderhold-sly-riposte","cinderhold-sly-sap","cinderhold-sly-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-sly-bulwark","cinderhold-sly-bind","cinderhold-sly-riposte","cinderhold-sly-sap","cinderhold-sly-stance","starter-universal-flicker","starter-tai-earth-aoe","starter-tai-earth-2","starter-tai-earth-6","starter-tai-earth-4","starter-tai-earth-3","starter-any-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-sly-bulwark","cinderhold-sly-bind","cinderhold-sly-riposte","cinderhold-sly-sap","cinderhold-sly-stance","starter-universal-flicker","starter-tai-earth-aoe","starter-tai-earth-2","starter-tai-water-2","starter-tai-earth-4","starter-tai-earth-3","starter-tai-water-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-sly-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-sly-bind","level":1,"xp":0},{"jutsuId":"cinderhold-sly-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-sly-sap","level":1,"xp":0},{"jutsuId":"cinderhold-sly-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-earth-2","level":1,"xp":0},{"jutsuId":"starter-tai-earth-6","level":1,"xp":0},{"jutsuId":"starter-tai-earth-4","level":1,"xp":0},{"jutsuId":"starter-tai-earth-3","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-tai-water-2","level":1,"xp":0},{"jutsuId":"starter-tai-water-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"spirit-leech-wakizashi","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"ironwall-crown","body":"ironwall-chest","waist":"ironwall-waist","legs":"ironwall-legs","feet":"ironwall-feet"}},
            {"minLevel":55,"equipment":{"hand":"glacier-king-cleaver","head":"ironwall-crown","body":"ironwall-chest","waist":"ironwall-waist","legs":"ironwall-legs","feet":"ironwall-feet"}},
        ],
        pets: [
            {"templateId":"legendary-7","species":"Moon Serpent","rarity":"legendary","nickname":"Glownose","signature":true,"instanceId":"legendary-7:npc-sly-1","trait":"Loyal"},
            {"templateId":"legendary-19","species":"Frost Wyrm","rarity":"legendary","nickname":"Smolderclaw","signature":false,"instanceId":"legendary-19:npc-sly-2","trait":"Loyal"},
            {"templateId":"rare-23","species":"Granite Badger","rarity":"rare","nickname":"Scoriawhisker","signature":false,"instanceId":"rare-23:npc-sly-3","trait":"Loyal"},
            {"templateId":"rare-19","species":"Mossback Toad","rarity":"rare","nickname":"Pumicetail","signature":false,"instanceId":"rare-19:npc-sly-4","trait":"Loyal"},
        ],
        deck: { name: "Stoneskin Vigil", cards: ["tc-130","tc-130","tc-130","tc-145","tc-145","tc-24","tc-24","tc-24","tc-26","tc-26","tc-47","tc-47","tc-47","tc-51","tc-82","tc-114","tc-114","tc-132","tc-132","tc-96","tc-96","chronicle-ancestral-muster","chronicle-defiant-rampart","chronicle-field-desert","chronicle-healers-reserve","chronicle-stoneplate-harness","chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-earthen-grave-array","chronicle-ironwood-bulwark","chronicle-ironwood-bulwark","chronicle-long-watch","chronicle-scorpion-wire","chronicle-scorpion-wire","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier","chronicle-substitution-mirror","chronicle-substitution-mirror"] },
        collection: ["chronicle-ancestral-muster","chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-defiant-rampart","chronicle-earthen-grave-array","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-ironwood-bulwark","chronicle-ironwood-bulwark","chronicle-long-watch","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-scorpion-wire","chronicle-scorpion-wire","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier","chronicle-stoneplate-harness","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-substitution-mirror","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-114","tc-114","tc-130","tc-130","tc-130","tc-132","tc-132","tc-145","tc-145","tc-15","tc-19","tc-21","tc-23","tc-24","tc-24","tc-24","tc-26","tc-26","tc-31","tc-36","tc-38","tc-47","tc-47","tc-47","tc-51","tc-54","tc-67","tc-70","tc-82","tc-96","tc-96"],
    },
    {
        id: "seiran",
        name: "Seiran",
        rank: "jonin",
        personality: "medic",
        avatar: "/npc-portraits/seiran.avif",
        specialty: "Genjutsu",
        elements: ["Water","Wind"],
        stats: {"strength":0.35,"speed":0.32,"intelligence":1,"willpower":0.91,"bukijutsuOffense":0.19,"bukijutsuDefense":0.74,"taijutsuOffense":0.12,"taijutsuDefense":0.66,"genjutsuOffense":1,"genjutsuDefense":0.71,"ninjutsuOffense":0.1,"ninjutsuDefense":0.73},
        bloodline: { ...{"id":"cinderhold-seiran-bloodline","name":"Censer Smoke","rank":"A Rank","specialElement":"Incense","weatherElement":"Water","lore":"Censer Smoke began as a temple rite for calming the dying. In battle the same incense soothes allies and drags enemies into a heavy sleep.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-seiran-mend","name":"Incense Mending","type":"Any","element":"Incense","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Increase Heal","percent":25}],"battleDescription":"Incense warmth closes the wounds of %user.","description":"Incense warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Water"},
            {"id":"cinderhold-seiran-leech","name":"Incense Draw","type":"Genjutsu","element":"Incense","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Incense threads pull life out of %target.","description":"Incense threads pull life out of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-seiran-vamp","name":"Incense Thirst","type":"Genjutsu","element":"Incense","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":25},{"name":"Siphon","percent":30}],"battleDescription":"A Incense strike feeds %user on the strength of %target.","description":"A Incense strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-seiran-toxin","name":"Incense Blight","type":"Genjutsu","element":"Incense","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":30},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Incense fumes seep into the chakra of %target.","description":"Incense fumes seep into the chakra of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-seiran-seal","name":"Incense Smother","type":"Genjutsu","element":"Incense","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Elemental Seal","percent":0}],"battleDescription":"A Incense seal smothers the chakra of %target.","description":"A Incense seal smothers the chakra of %target.","isUtility":false,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-seiran-mend","cinderhold-seiran-leech","cinderhold-seiran-vamp","cinderhold-seiran-toxin","cinderhold-seiran-seal","starter-universal-flicker","starter-gen-water-6","starter-gen-water-aoe","starter-gen-wind-5","starter-any-water-1","starter-gen-water-1","starter-gen-wind-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-seiran-mend","cinderhold-seiran-leech","cinderhold-seiran-vamp","cinderhold-seiran-toxin","cinderhold-seiran-seal","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-seiran-mend","cinderhold-seiran-leech","cinderhold-seiran-vamp","cinderhold-seiran-toxin","cinderhold-seiran-seal","starter-universal-flicker","starter-gen-water-6","starter-gen-water-aoe","starter-gen-water-5","starter-any-water-1","starter-gen-water-1","starter-gen-water-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-seiran-mend","cinderhold-seiran-leech","cinderhold-seiran-vamp","cinderhold-seiran-toxin","cinderhold-seiran-seal","starter-universal-flicker","starter-gen-water-6","starter-gen-water-aoe","starter-gen-wind-5","starter-any-water-1","starter-gen-water-1","starter-gen-wind-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-seiran-mend","level":1,"xp":0},{"jutsuId":"cinderhold-seiran-leech","level":1,"xp":0},{"jutsuId":"cinderhold-seiran-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-seiran-toxin","level":1,"xp":0},{"jutsuId":"cinderhold-seiran-seal","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-water-6","level":1,"xp":0},{"jutsuId":"starter-gen-water-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-water-5","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-gen-water-1","level":1,"xp":0},{"jutsuId":"starter-gen-water-3","level":1,"xp":0},{"jutsuId":"starter-gen-wind-5","level":1,"xp":0},{"jutsuId":"starter-gen-wind-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
            {"minLevel":55,"equipment":{"hand":"eclipse-fang-dagger","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"legendary-0","species":"Glacier Wolf","rarity":"legendary","nickname":"Ashburr","signature":true,"instanceId":"legendary-0:npc-seiran-1","trait":"Lucky"},
            {"templateId":"legendary-20","species":"Abyss Kraken","rarity":"legendary","nickname":"Charwhisker","signature":false,"instanceId":"legendary-20:npc-seiran-2","trait":"Lucky"},
            {"templateId":"rare-33","species":"Brine Cormorant","rarity":"rare","nickname":"Rustear","signature":false,"instanceId":"rare-33:npc-seiran-3","trait":"Lucky"},
            {"templateId":"rare-38","species":"Squall Plover","rarity":"rare","nickname":"Rustheart","signature":false,"instanceId":"rare-38:npc-seiran-4","trait":"Lucky"},
        ],
        deck: { name: "Temple Censer", cards: ["tc-86","tc-86","tc-86","tc-91","tc-91","tc-91","tc-02","tc-02","tc-141","tc-141","tc-141","tc-82","tc-82","tc-82","tc-98","tc-98","tc-132","tc-132","tc-132","tc-38","tc-38","tc-120","tc-120","tc-111","tc-111","chronicle-ancestral-muster","chronicle-chakra-ledger","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-field-ocean","chronicle-grave-lantern-rite","chronicle-hundred-shrine-benediction","chronicle-hundred-shrine-benediction","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-storm-shear","chronicle-avalanche-seal","chronicle-substitution-mirror"] },
        collection: ["chronicle-ancestral-muster","chronicle-avalanche-seal","chronicle-chakra-ledger","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-hundred-shrine-benediction","chronicle-hundred-shrine-benediction","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-storm-shear","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-111","tc-111","tc-120","tc-120","tc-132","tc-132","tc-132","tc-141","tc-141","tc-141","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-38","tc-54","tc-67","tc-70","tc-82","tc-82","tc-82","tc-86","tc-86","tc-86","tc-91","tc-91","tc-91","tc-98","tc-98"],
    },
    {
        id: "akari",
        name: "Akari",
        rank: "jonin",
        personality: "trickster",
        avatar: "/npc-portraits/akari.avif",
        specialty: "Ninjutsu",
        elements: ["Lightning","Earth"],
        stats: {"strength":0.31,"speed":0.87,"intelligence":0.3,"willpower":1,"bukijutsuOffense":0.15,"bukijutsuDefense":0.6,"taijutsuOffense":0.12,"taijutsuDefense":0.58,"genjutsuOffense":0.18,"genjutsuDefense":0.62,"ninjutsuOffense":1,"ninjutsuDefense":0.62},
        bloodline: { ...{"id":"cinderhold-akari-bloodline","name":"Struck Glass","rank":"A Rank","specialElement":"Fulgurite","weatherElement":"Lightning","lore":"Where lightning meets the volcanic sand it leaves tubes of glass behind. The Struck Glass line reads those tubes like scripture and strikes in the same crooked paths.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-akari-lock","name":"Fulgurite Stillness","type":"Ninjutsu","element":"Fulgurite","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0}],"battleDescription":"Fulgurite sparks freeze %target in place.","description":"Fulgurite sparks freeze %target in place.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-akari-sever","name":"Fulgurite Cut","type":"Ninjutsu","element":"Fulgurite","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Bloodline Seal","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"A Fulgurite seal cuts %target off from their bloodline.","description":"A Fulgurite seal cuts %target off from their bloodline.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-akari-shove","name":"Fulgurite Gust","type":"Ninjutsu","element":"Fulgurite","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Push","percent":0},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"A Fulgurite gust throws %target across the field.","description":"A Fulgurite gust throws %target across the field.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-akari-venom","name":"Fulgurite Venom","type":"Ninjutsu","element":"Fulgurite","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":25},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"Fulgurite haze poisons %target and dulls their strikes.","description":"Fulgurite haze poisons %target and dulls their strikes.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-akari-fog","name":"Fulgurite Veil","type":"Any","element":"Fulgurite","ap":40,"range":4,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Buff Prevent","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Fulgurite fog clouds the senses of %target.","description":"Fulgurite fog clouds the senses of %target.","isUtility":true,"weatherElement":"Lightning"},
        ] },
        equippedJutsuIds: ["cinderhold-akari-lock","cinderhold-akari-sever","cinderhold-akari-shove","cinderhold-akari-venom","cinderhold-akari-fog","starter-universal-flicker","starter-nin-lightning-6","starter-nin-lightning-aoe","starter-nin-earth-2","starter-nin-lightning-3","starter-nin-lightning-4","starter-nin-earth-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-akari-lock","cinderhold-akari-sever","cinderhold-akari-shove","cinderhold-akari-venom","cinderhold-akari-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-akari-lock","cinderhold-akari-sever","cinderhold-akari-shove","cinderhold-akari-venom","cinderhold-akari-fog","starter-universal-flicker","starter-nin-lightning-6","starter-nin-lightning-aoe","starter-nin-lightning-5","starter-nin-lightning-3","starter-nin-lightning-4","starter-nin-lightning-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-akari-lock","cinderhold-akari-sever","cinderhold-akari-shove","cinderhold-akari-venom","cinderhold-akari-fog","starter-universal-flicker","starter-nin-lightning-6","starter-nin-lightning-aoe","starter-nin-earth-2","starter-nin-lightning-3","starter-nin-lightning-4","starter-nin-earth-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-akari-lock","level":1,"xp":0},{"jutsuId":"cinderhold-akari-sever","level":1,"xp":0},{"jutsuId":"cinderhold-akari-shove","level":1,"xp":0},{"jutsuId":"cinderhold-akari-venom","level":1,"xp":0},{"jutsuId":"cinderhold-akari-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-6","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-5","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-3","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-4","level":1,"xp":0},{"jutsuId":"starter-nin-lightning-1","level":1,"xp":0},{"jutsuId":"starter-nin-earth-2","level":1,"xp":0},{"jutsuId":"starter-nin-earth-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
            {"minLevel":55,"equipment":{"hand":"ashen-dragon-katana","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"legendary-8","species":"Storm Lion","rarity":"legendary","nickname":"Slagscale","signature":true,"instanceId":"legendary-8:npc-akari-1","trait":"Lucky"},
            {"templateId":"legendary-28","species":"Granite Gargoyle","rarity":"legendary","nickname":"Glowburr","signature":false,"instanceId":"legendary-28:npc-akari-2","trait":"Lucky"},
            {"templateId":"rare-2","species":"Night Panther","rarity":"rare","nickname":"Tindershade","signature":false,"instanceId":"rare-2:npc-akari-3","trait":"Lucky"},
            {"templateId":"rare-18","species":"Duskwings Bat","rarity":"rare","nickname":"Flintburr","signature":false,"instanceId":"rare-18:npc-akari-4","trait":"Lucky"},
        ],
        deck: { name: "Glassfall Storm", cards: ["tc-24","tc-24","tc-26","tc-76","tc-76","tc-103","tc-103","tc-103","tc-146","tc-146","tc-146","tc-32","tc-37","tc-37","tc-43","tc-43","tc-122","tc-122","tc-147","tc-147","tc-44","tc-44","tc-115","tc-115","tc-106","chronicle-ancestral-muster","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-mirage-displacement","chronicle-whirlwind-dismissal","chronicle-whirlwind-dismissal","chronicle-counter-script-cache","chronicle-final-trial-binding","chronicle-grounding-rod-script","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-palm-ward","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-mirror"] },
        collection: ["chronicle-ancestral-muster","chronicle-counter-script-cache","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-final-trial-binding","chronicle-grounding-rod-script","chronicle-guard-stance","chronicle-guard-stance","chronicle-kage-archive-lock","chronicle-kage-judgment-seal","chronicle-medical-salve","chronicle-medical-salve","chronicle-mirage-displacement","chronicle-palm-ward","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-whirlwind-dismissal","chronicle-whirlwind-dismissal","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-103","tc-103","tc-103","tc-106","tc-11","tc-115","tc-115","tc-122","tc-122","tc-146","tc-146","tc-146","tc-147","tc-147","tc-15","tc-19","tc-21","tc-23","tc-24","tc-24","tc-26","tc-31","tc-32","tc-36","tc-37","tc-37","tc-38","tc-43","tc-43","tc-44","tc-44","tc-54","tc-67","tc-70","tc-76","tc-76"],
    },
    {
        id: "kaien",
        name: "Kaien",
        rank: "jonin",
        personality: "aggressive",
        avatar: "/npc-portraits/kaien.avif",
        specialty: "Ninjutsu",
        elements: ["Fire","Water"],
        stats: {"strength":0.35,"speed":0.89,"intelligence":0.32,"willpower":1,"bukijutsuOffense":0.13,"bukijutsuDefense":0.49,"taijutsuOffense":0.17,"taijutsuDefense":0.5,"genjutsuOffense":0.19,"genjutsuDefense":0.5,"ninjutsuOffense":1,"ninjutsuDefense":0.5},
        bloodline: { ...{"id":"cinderhold-kaien-bloodline","name":"Pyroclast Surge","rank":"A Rank","specialElement":"Pyroclast","weatherElement":"Fire","lore":"A Pyroclast Surge is the moment a mountain decides to fall on its enemies. Its users carry that moment folded inside their chakra.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-kaien-nuke","name":"Pyroclast Cataclysm","type":"Ninjutsu","element":"Pyroclast","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":25}],"battleDescription":"Pyroclast chakra erupts over %target in one ruinous blast.","description":"Pyroclast chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kaien-pierce","name":"Pyroclast Needle","type":"Ninjutsu","element":"Pyroclast","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pierce","percent":0}],"battleDescription":"A Pyroclast lance drives straight through the guard of %target.","description":"A Pyroclast lance drives straight through the guard of %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kaien-rend","name":"Pyroclast Brand","type":"Ninjutsu","element":"Pyroclast","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Ignition","percent":30}],"battleDescription":"Pyroclast claws tear into %target and leave the wound burning.","description":"Pyroclast claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kaien-burst","name":"Pyroclast Bloom","type":"Ninjutsu","element":"Pyroclast","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"AOE_BURST","tags":[{"name":"Lifesteal","percent":30}],"battleDescription":"A Pyroclast burst detonates around %target.","description":"A Pyroclast burst detonates around %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-kaien-trance","name":"Pyroclast Frenzy","type":"Any","element":"Pyroclast","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Overclock","percent":0}],"battleDescription":"%user breathes in Pyroclast heat and moves faster than thought.","description":"%user breathes in Pyroclast heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-kaien-nuke","cinderhold-kaien-pierce","cinderhold-kaien-rend","cinderhold-kaien-burst","cinderhold-kaien-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-water-2","starter-nin-fire-4","starter-nin-fire-3","starter-nin-water-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-kaien-nuke","cinderhold-kaien-pierce","cinderhold-kaien-rend","cinderhold-kaien-burst","cinderhold-kaien-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-kaien-nuke","cinderhold-kaien-pierce","cinderhold-kaien-rend","cinderhold-kaien-burst","cinderhold-kaien-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-fire-6","starter-nin-fire-4","starter-nin-fire-3","starter-any-fire-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-kaien-nuke","cinderhold-kaien-pierce","cinderhold-kaien-rend","cinderhold-kaien-burst","cinderhold-kaien-trance","starter-universal-flicker","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-water-2","starter-nin-fire-4","starter-nin-fire-3","starter-nin-water-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-kaien-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-kaien-pierce","level":1,"xp":0},{"jutsuId":"cinderhold-kaien-rend","level":1,"xp":0},{"jutsuId":"cinderhold-kaien-burst","level":1,"xp":0},{"jutsuId":"cinderhold-kaien-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-fire-2","level":1,"xp":0},{"jutsuId":"starter-nin-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-fire-6","level":1,"xp":0},{"jutsuId":"starter-nin-fire-4","level":1,"xp":0},{"jutsuId":"starter-nin-fire-3","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-2","level":1,"xp":0},{"jutsuId":"starter-nin-water-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"mistfang-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"mistfang-tanto","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
            {"minLevel":55,"equipment":{"hand":"ashen-dragon-katana","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"legendary-15","species":"Inferno Chimera","rarity":"legendary","nickname":"Glowtuft","signature":true,"instanceId":"legendary-15:npc-kaien-1","trait":"Battleborn"},
            {"templateId":"legendary-5","species":"Azure Kirin","rarity":"legendary","nickname":"Blazepip","signature":false,"instanceId":"legendary-5:npc-kaien-2","trait":"Battleborn"},
            {"templateId":"rare-8","species":"Azure Toad","rarity":"rare","nickname":"Cinderfang","signature":false,"instanceId":"rare-8:npc-kaien-3","trait":"Aggressive"},
            {"templateId":"rare-12","species":"Mist Lynx","rarity":"rare","nickname":"Cinderheart","signature":false,"instanceId":"rare-12:npc-kaien-4","trait":"Aggressive"},
        ],
        deck: { name: "Eruption Line", cards: ["tc-01","tc-01","tc-01","tc-117","tc-117","tc-117","tc-42","tc-42","tc-108","tc-108","tc-13","tc-13","tc-67","tc-67","tc-67","tc-142","tc-38","tc-38","tc-99","tc-99","tc-70","tc-70","chronicle-ancestral-muster","chronicle-bannerlords-rally","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-crimson-insight","chronicle-field-volcano","chronicle-giant-felling-edict","chronicle-rift-cleaving-script","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-stacked-scrolls","chronicle-war-camp-feast","chronicle-counter-script-cache","chronicle-counter-script-cache","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-still-water-rebuttal","chronicle-substitution-mirror"] },
        collection: ["chronicle-ancestral-muster","chronicle-bannerlords-rally","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-counter-script-cache","chronicle-counter-script-cache","chronicle-crimson-insight","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-giant-felling-edict","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stacked-scrolls","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-war-camp-feast","tc-01","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-108","tc-108","tc-11","tc-117","tc-117","tc-117","tc-13","tc-13","tc-142","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-38","tc-42","tc-42","tc-54","tc-67","tc-67","tc-67","tc-70","tc-70","tc-99","tc-99"],
    },
    {
        id: "kairo",
        name: "Kairo",
        rank: "jonin",
        personality: "guardian",
        avatar: "/npc-portraits/kairo.avif",
        specialty: "Bukijutsu",
        elements: ["Water","Earth"],
        stats: {"strength":1,"speed":0.32,"intelligence":0.86,"willpower":0.31,"bukijutsuOffense":1,"bukijutsuDefense":0.89,"taijutsuOffense":0.12,"taijutsuDefense":0.82,"genjutsuOffense":0.2,"genjutsuDefense":0.83,"ninjutsuOffense":0.17,"ninjutsuDefense":0.87},
        bloodline: { ...{"id":"cinderhold-kairo-bloodline","name":"Ashen Tide","rank":"A Rank","specialElement":"Ashwater","weatherElement":"Water","lore":"The Ashen Tide rolls grey water thick with cinders across the field. It stops arrows, blades and jutsu with the same patient weight.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-kairo-bulwark","name":"Ashwater Bulwark","type":"Bukijutsu","element":"Ashwater","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0},{"name":"Decrease Damage Taken","percent":30}],"battleDescription":"A Ashwater shell closes around %user before the blow lands.","description":"A Ashwater shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-kairo-bind","name":"Ashwater Shackle","type":"Bukijutsu","element":"Ashwater","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Bloodline Seal","percent":0}],"battleDescription":"Ashwater chains lock %target where they stand.","description":"Ashwater chains lock %target where they stand.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-kairo-riposte","name":"Ashwater Riposte","type":"Bukijutsu","element":"Ashwater","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Recoil","percent":30},{"name":"Wound","percent":25}],"battleDescription":"%user turns the force of %target back on them with a Ashwater counter.","description":"%user turns the force of %target back on them with a Ashwater counter.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-kairo-sap","name":"Ashwater Sapping Haze","type":"Bukijutsu","element":"Ashwater","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Ashwater smoke saps the strength from the strikes of %target.","description":"Ashwater smoke saps the strength from the strikes of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-kairo-stance","name":"Ashwater Stance","type":"Any","element":"Ashwater","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":25},{"name":"Absorb","percent":30},{"name":"Increase Heal","percent":25}],"battleDescription":"%user plants their feet as Ashwater hardens over their skin.","description":"%user plants their feet as Ashwater hardens over their skin.","isUtility":true,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-kairo-bulwark","cinderhold-kairo-bind","cinderhold-kairo-riposte","cinderhold-kairo-sap","cinderhold-kairo-stance","starter-universal-flicker","starter-buki-water-aoe","starter-buki-water-5","starter-buki-earth-aoe","starter-any-water-1","starter-buki-water-1","starter-buki-earth-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-kairo-bulwark","cinderhold-kairo-bind","cinderhold-kairo-riposte","cinderhold-kairo-sap","cinderhold-kairo-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-kairo-bulwark","cinderhold-kairo-bind","cinderhold-kairo-riposte","cinderhold-kairo-sap","cinderhold-kairo-stance","starter-universal-flicker","starter-buki-water-aoe","starter-buki-water-5","starter-buki-water-2","starter-any-water-1","starter-buki-water-1","starter-buki-water-4"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-kairo-bulwark","cinderhold-kairo-bind","cinderhold-kairo-riposte","cinderhold-kairo-sap","cinderhold-kairo-stance","starter-universal-flicker","starter-buki-water-aoe","starter-buki-water-5","starter-buki-earth-aoe","starter-any-water-1","starter-buki-water-1","starter-buki-earth-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-kairo-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-kairo-bind","level":1,"xp":0},{"jutsuId":"cinderhold-kairo-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-kairo-sap","level":1,"xp":0},{"jutsuId":"cinderhold-kairo-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-water-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-water-5","level":1,"xp":0},{"jutsuId":"starter-buki-water-2","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-buki-water-1","level":1,"xp":0},{"jutsuId":"starter-buki-water-4","level":1,"xp":0},{"jutsuId":"starter-buki-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-earth-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"cracked-bone-dagger","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"cracked-bone-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
            {"minLevel":55,"equipment":{"hand":"void-leech-nodachi","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
        ],
        pets: [
            {"templateId":"legendary-23","species":"Cyclone Sphinx","rarity":"legendary","nickname":"Magmahorn","signature":true,"instanceId":"legendary-23:npc-kairo-1","trait":"Loyal"},
            {"templateId":"legendary-3","species":"Spirit Deer","rarity":"legendary","nickname":"Tindersong","signature":false,"instanceId":"legendary-3:npc-kairo-2","trait":"Loyal"},
            {"templateId":"rare-1","species":"Frost Hare","rarity":"rare","nickname":"Scoriatail","signature":false,"instanceId":"rare-1:npc-kairo-3","trait":"Loyal"},
            {"templateId":"rare-9","species":"Bristle Boar","rarity":"rare","nickname":"Charburr","signature":false,"instanceId":"rare-9:npc-kairo-4","trait":"Loyal"},
        ],
        deck: { name: "Grey Tide Guard", cards: ["tc-102","tc-102","tc-102","tc-130","tc-130","tc-145","tc-145","tc-136","tc-136","tc-27","tc-27","tc-77","tc-77","tc-77","tc-03","tc-132","tc-132","tc-73","tc-73","tc-73","tc-138","tc-138","chronicle-crimson-insight","chronicle-field-ocean","chronicle-final-bulwark","chronicle-final-bulwark","chronicle-grave-lantern-rite","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-second-wind-recall","chronicle-final-trial-binding","chronicle-guardians-reversal","chronicle-guardians-reversal","chronicle-pitfall-tag-array","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-crimson-insight","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-final-bulwark","chronicle-final-bulwark","chronicle-final-trial-binding","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-guardians-reversal","chronicle-guardians-reversal","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-sealing-circle","chronicle-second-wind-recall","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-102","tc-102","tc-102","tc-11","tc-130","tc-130","tc-132","tc-132","tc-136","tc-136","tc-138","tc-138","tc-145","tc-145","tc-15","tc-19","tc-21","tc-23","tc-27","tc-27","tc-31","tc-36","tc-38","tc-54","tc-67","tc-70","tc-73","tc-73","tc-73","tc-77","tc-77","tc-77"],
    },
    {
        id: "suiren",
        name: "Suiren",
        rank: "jonin",
        personality: "trickster",
        avatar: "/npc-portraits/suiren.avif",
        specialty: "Taijutsu",
        elements: ["Lightning","Fire"],
        stats: {"strength":1,"speed":0.92,"intelligence":0.31,"willpower":0.36,"bukijutsuOffense":0.14,"bukijutsuDefense":0.6,"taijutsuOffense":1,"taijutsuDefense":0.61,"genjutsuOffense":0.17,"genjutsuDefense":0.61,"ninjutsuOffense":0.14,"ninjutsuDefense":0.56},
        bloodline: { ...{"id":"cinderhold-suiren-bloodline","name":"Arc Ember","rank":"A Rank","specialElement":"Arcflame","weatherElement":"Lightning","lore":"Arc Ember fighters jump between sparks faster than the eye can follow. They are rarely where the enemy last saw them.","totalPoints":10}, jutsus: [
            {"id":"cinderhold-suiren-lock","name":"Arcflame Stillness","type":"Taijutsu","element":"Arcflame","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Arcflame sparks freeze %target in place.","description":"Arcflame sparks freeze %target in place.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-suiren-sever","name":"Arcflame Cut","type":"Taijutsu","element":"Arcflame","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Bloodline Seal","percent":0}],"battleDescription":"A Arcflame seal cuts %target off from their bloodline.","description":"A Arcflame seal cuts %target off from their bloodline.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-suiren-shove","name":"Arcflame Gust","type":"Taijutsu","element":"Arcflame","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Push","percent":0}],"battleDescription":"A Arcflame gust throws %target across the field.","description":"A Arcflame gust throws %target across the field.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-suiren-venom","name":"Arcflame Venom","type":"Taijutsu","element":"Arcflame","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":25},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Arcflame haze poisons %target and dulls their strikes.","description":"Arcflame haze poisons %target and dulls their strikes.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-suiren-fog","name":"Arcflame Veil","type":"Any","element":"Arcflame","ap":40,"range":5,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Buff Prevent","percent":0},{"name":"Decrease Damage Given","percent":30}],"battleDescription":"Arcflame fog clouds the senses of %target.","description":"Arcflame fog clouds the senses of %target.","isUtility":true,"weatherElement":"Lightning"},
        ] },
        equippedJutsuIds: ["cinderhold-suiren-lock","cinderhold-suiren-sever","cinderhold-suiren-shove","cinderhold-suiren-venom","cinderhold-suiren-fog","starter-universal-flicker","starter-tai-lightning-5","starter-tai-lightning-2","starter-tai-fire-2","starter-tai-lightning-1","starter-any-lightning-1","starter-tai-fire-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-suiren-lock","cinderhold-suiren-sever","cinderhold-suiren-shove","cinderhold-suiren-venom","cinderhold-suiren-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-suiren-lock","cinderhold-suiren-sever","cinderhold-suiren-shove","cinderhold-suiren-venom","cinderhold-suiren-fog","starter-universal-flicker","starter-tai-lightning-5","starter-tai-lightning-2","starter-tai-lightning-6","starter-tai-lightning-1","starter-any-lightning-1","starter-tai-lightning-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-suiren-lock","cinderhold-suiren-sever","cinderhold-suiren-shove","cinderhold-suiren-venom","cinderhold-suiren-fog","starter-universal-flicker","starter-tai-lightning-5","starter-tai-lightning-2","starter-tai-fire-2","starter-tai-lightning-1","starter-any-lightning-1","starter-tai-fire-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-suiren-lock","level":1,"xp":0},{"jutsuId":"cinderhold-suiren-sever","level":1,"xp":0},{"jutsuId":"cinderhold-suiren-shove","level":1,"xp":0},{"jutsuId":"cinderhold-suiren-venom","level":1,"xp":0},{"jutsuId":"cinderhold-suiren-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-5","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-2","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-6","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-1","level":1,"xp":0},{"jutsuId":"starter-any-lightning-1","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-3","level":1,"xp":0},{"jutsuId":"starter-tai-fire-2","level":1,"xp":0},{"jutsuId":"starter-tai-fire-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"spirit-leech-wakizashi","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
            {"minLevel":55,"equipment":{"hand":"glacier-king-cleaver","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"legendary-24","species":"Thunder Raiju","rarity":"legendary","nickname":"Ashbite","signature":true,"instanceId":"legendary-24:npc-suiren-1","trait":"Swift"},
            {"templateId":"legendary-21","species":"Storm Roc","rarity":"legendary","nickname":"Pumiceshade","signature":false,"instanceId":"legendary-21:npc-suiren-2","trait":"Swift"},
            {"templateId":"rare-13","species":"Steel Beetle","rarity":"rare","nickname":"Coalsong","signature":false,"instanceId":"rare-13:npc-suiren-3","trait":"Lucky"},
            {"templateId":"rare-27","species":"Pyre Kestrel","rarity":"rare","nickname":"Tinderpaw","signature":false,"instanceId":"rare-27:npc-suiren-4","trait":"Lucky"},
        ],
        deck: { name: "Live Wire", cards: ["tc-61","tc-113","tc-113","tc-113","tc-131","tc-131","tc-131","tc-146","tc-146","tc-33","tc-33","tc-33","tc-72","tc-72","tc-44","tc-44","tc-63","tc-63","tc-88","tc-45","tc-45","tc-64","tc-64","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-rift-cleaving-script","chronicle-rift-cleaving-script","chronicle-shrine-purge","chronicle-stoneplate-harness","chronicle-storm-shear","chronicle-whirlwind-dismissal","chronicle-final-trial-binding","chronicle-flash-burial-tag","chronicle-kage-archive-lock","chronicle-mirror-moon-rebuttal","chronicle-palm-ward","chronicle-palm-ward","chronicle-substitution-mirror"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-final-trial-binding","chronicle-flash-burial-tag","chronicle-guard-stance","chronicle-guard-stance","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-kage-archive-lock","chronicle-medical-salve","chronicle-medical-salve","chronicle-mirror-moon-rebuttal","chronicle-palm-ward","chronicle-palm-ward","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-rift-cleaving-script","chronicle-sealing-circle","chronicle-shrine-purge","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stoneplate-harness","chronicle-storm-shear","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-whirlwind-dismissal","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-113","tc-113","tc-113","tc-131","tc-131","tc-131","tc-146","tc-146","tc-15","tc-19","tc-21","tc-23","tc-31","tc-33","tc-33","tc-33","tc-36","tc-38","tc-44","tc-44","tc-45","tc-45","tc-54","tc-61","tc-63","tc-63","tc-64","tc-64","tc-67","tc-70","tc-72","tc-72","tc-88"],
    },
    {
        id: "tavi",
        name: "Tavi",
        rank: "chunin",
        personality: "aggressive",
        avatar: "/npc-portraits/tavi.avif",
        specialty: "Ninjutsu",
        elements: ["Fire","Earth"],
        stats: {"strength":0.36,"speed":0.89,"intelligence":0.38,"willpower":1,"bukijutsuOffense":0.12,"bukijutsuDefense":0.54,"taijutsuOffense":0.15,"taijutsuDefense":0.5,"genjutsuOffense":0.16,"genjutsuDefense":0.52,"ninjutsuOffense":1,"ninjutsuDefense":0.51},
        bloodline: { ...{"id":"cinderhold-tavi-bloodline","name":"Kindled Vein","rank":"B Rank","specialElement":"Kindling","weatherElement":"Fire","lore":"The Kindled Vein catches slowly and then all at once. Young Cinderhold shinobi with this blood are told to count to three before they let it burn.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-tavi-nuke","name":"Kindling Cataclysm","type":"Ninjutsu","element":"Kindling","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Kindling chakra erupts over %target in one ruinous blast.","description":"Kindling chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-tavi-rend","name":"Kindling Brand","type":"Ninjutsu","element":"Kindling","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Wound","percent":25},{"name":"Lifesteal","percent":30}],"battleDescription":"Kindling claws tear into %target and leave the wound burning.","description":"Kindling claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-tavi-strike","name":"Kindling Crash","type":"Ninjutsu","element":"Kindling","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Recoil","percent":25}],"battleDescription":"A Kindling strike crashes into %target.","description":"A Kindling strike crashes into %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-tavi-trance","name":"Kindling Frenzy","type":"Any","element":"Kindling","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Decrease Damage Taken","percent":30}],"battleDescription":"%user breathes in Kindling heat and moves faster than thought.","description":"%user breathes in Kindling heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-tavi-nuke","cinderhold-tavi-rend","cinderhold-tavi-strike","cinderhold-tavi-trance","starter-universal-flicker","starter-nin-fire-5","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-earth-aoe","starter-nin-fire-3","starter-any-fire-1","starter-nin-earth-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-tavi-nuke","cinderhold-tavi-rend","cinderhold-tavi-strike","cinderhold-tavi-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-tavi-nuke","cinderhold-tavi-rend","cinderhold-tavi-strike","cinderhold-tavi-trance","starter-universal-flicker","starter-nin-fire-5","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-fire-6","starter-nin-fire-3","starter-any-fire-1","starter-nin-fire-4"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-tavi-nuke","cinderhold-tavi-rend","cinderhold-tavi-strike","cinderhold-tavi-trance","starter-universal-flicker","starter-nin-fire-5","starter-nin-fire-2","starter-nin-fire-aoe","starter-nin-earth-aoe","starter-nin-fire-3","starter-any-fire-1","starter-nin-earth-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-tavi-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-tavi-rend","level":1,"xp":0},{"jutsuId":"cinderhold-tavi-strike","level":1,"xp":0},{"jutsuId":"cinderhold-tavi-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-fire-5","level":1,"xp":0},{"jutsuId":"starter-nin-fire-2","level":1,"xp":0},{"jutsuId":"starter-nin-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-fire-6","level":1,"xp":0},{"jutsuId":"starter-nin-fire-3","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-nin-fire-4","level":1,"xp":0},{"jutsuId":"starter-nin-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-earth-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"mistfang-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"mistfang-tanto","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"rare-7","species":"Ashwing Raven","rarity":"rare","nickname":"Emberburr","signature":true,"instanceId":"rare-7:npc-tavi-1","trait":"Aggressive"},
            {"templateId":"rare-45","species":"Granite Wombat","rarity":"rare","nickname":"Flintpaw","signature":false,"instanceId":"rare-45:npc-tavi-2","trait":"Battleborn"},
            {"templateId":"rare-25","species":"Magma Hyena","rarity":"rare","nickname":"Lumenflick","signature":false,"instanceId":"rare-25:npc-tavi-3","trait":"Battleborn"},
            {"templateId":"standard-11","species":"Sand Snake","rarity":"standard","nickname":"Blazemane","signature":false,"instanceId":"standard-11:npc-tavi-4","trait":"Aggressive"},
        ],
        deck: { name: "Spark and Tinder", cards: ["tc-01","tc-01","tc-117","tc-117","tc-117","tc-26","tc-56","tc-56","tc-126","tc-126","tc-126","tc-48","tc-48","tc-92","tc-92","tc-28","tc-28","tc-78","tc-78","tc-78","tc-94","tc-60","tc-60","chronicle-field-volcano","chronicle-flame-tempered-blade","chronicle-flame-tempered-blade","chronicle-soldier-pill","chronicle-stacked-scrolls","chronicle-tempered-kunai","chronicle-tempered-kunai","chronicle-tideguard-mantle","chronicle-tideguard-mantle","chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-pitfall-tag-array","chronicle-ringed-detonation","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-flame-tempered-blade","chronicle-flame-tempered-blade","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-ringed-detonation","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stacked-scrolls","chronicle-substitution-log","chronicle-substitution-log","chronicle-tempered-kunai","chronicle-tempered-kunai","chronicle-tideguard-mantle","chronicle-tideguard-mantle","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-117","tc-117","tc-117","tc-126","tc-126","tc-126","tc-15","tc-19","tc-21","tc-23","tc-26","tc-28","tc-28","tc-31","tc-36","tc-38","tc-48","tc-48","tc-54","tc-56","tc-56","tc-60","tc-60","tc-67","tc-70","tc-78","tc-78","tc-78","tc-92","tc-92","tc-94"],
    },
    {
        id: "sayo",
        name: "Sayo",
        rank: "chunin",
        personality: "medic",
        avatar: "/npc-portraits/sayo.avif",
        specialty: "Ninjutsu",
        elements: ["Water","Fire"],
        stats: {"strength":0.37,"speed":0.88,"intelligence":0.3,"willpower":1,"bukijutsuOffense":0.15,"bukijutsuDefense":0.67,"taijutsuOffense":0.2,"taijutsuDefense":0.72,"genjutsuOffense":0.16,"genjutsuDefense":0.74,"ninjutsuOffense":1,"ninjutsuDefense":0.74},
        bloodline: { ...{"id":"cinderhold-sayo-bloodline","name":"Hearthwater","rank":"B Rank","specialElement":"Hearth","weatherElement":"Water","lore":"Hearthwater carries the warmth of a home fire in a cupped palm. Its healers keep the wounded of the village alive through the cold nights on the mountain.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-sayo-mend","name":"Hearth Rekindling","type":"Any","element":"Hearth","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Decrease Damage Taken","percent":30}],"battleDescription":"Hearth warmth closes the wounds of %user.","description":"Hearth warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Water"},
            {"id":"cinderhold-sayo-leech","name":"Hearth Leech","type":"Ninjutsu","element":"Hearth","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0},{"name":"Decrease Damage Given","percent":30}],"battleDescription":"Hearth threads pull life out of %target.","description":"Hearth threads pull life out of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-sayo-vamp","name":"Hearth Thirst","type":"Ninjutsu","element":"Hearth","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":25}],"battleDescription":"A Hearth strike feeds %user on the strength of %target.","description":"A Hearth strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-sayo-toxin","name":"Hearth Blight","type":"Ninjutsu","element":"Hearth","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":30},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Hearth fumes seep into the chakra of %target.","description":"Hearth fumes seep into the chakra of %target.","isUtility":false,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-sayo-mend","cinderhold-sayo-leech","cinderhold-sayo-vamp","cinderhold-sayo-toxin","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-fire-2","starter-nin-water-3","starter-any-water-1","starter-any-fire-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-sayo-mend","cinderhold-sayo-leech","cinderhold-sayo-vamp","cinderhold-sayo-toxin","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-sayo-mend","cinderhold-sayo-leech","cinderhold-sayo-vamp","cinderhold-sayo-toxin","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-water-aoe","starter-nin-water-3","starter-any-water-1","starter-nin-water-4"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-sayo-mend","cinderhold-sayo-leech","cinderhold-sayo-vamp","cinderhold-sayo-toxin","starter-universal-flicker","starter-nin-water-6","starter-nin-water-2","starter-nin-water-5","starter-nin-fire-2","starter-nin-water-3","starter-any-water-1","starter-any-fire-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-sayo-mend","level":1,"xp":0},{"jutsuId":"cinderhold-sayo-leech","level":1,"xp":0},{"jutsuId":"cinderhold-sayo-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-sayo-toxin","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-water-6","level":1,"xp":0},{"jutsuId":"starter-nin-water-2","level":1,"xp":0},{"jutsuId":"starter-nin-water-5","level":1,"xp":0},{"jutsuId":"starter-nin-water-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-water-3","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-4","level":1,"xp":0},{"jutsuId":"starter-nin-fire-2","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"rare-30","species":"Tidal Mink","rarity":"rare","nickname":"Kindlesong","signature":true,"instanceId":"rare-30:npc-sayo-1","trait":"Loyal"},
            {"templateId":"rare-32","species":"Coral Serval","rarity":"rare","nickname":"Sparktuft","signature":false,"instanceId":"rare-32:npc-sayo-2","trait":"Loyal"},
            {"templateId":"rare-22","species":"Shrine Salamander","rarity":"rare","nickname":"Flintheart","signature":false,"instanceId":"rare-22:npc-sayo-3","trait":"Lucky"},
            {"templateId":"standard-26","species":"Ember Mole","rarity":"standard","nickname":"Magmawing","signature":false,"instanceId":"standard-26:npc-sayo-4","trait":"Lucky"},
        ],
        deck: { name: "Warm Hearth", cards: ["tc-01","tc-107","tc-107","tc-107","tc-108","tc-141","tc-141","tc-27","tc-27","tc-27","tc-62","tc-62","tc-62","tc-77","tc-82","tc-82","tc-132","tc-73","tc-73","tc-83","tc-83","tc-95","tc-95","tc-95","chronicle-ancestral-muster","chronicle-crimson-insight","chronicle-crimson-insight","chronicle-field-ocean","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-storm-shear","chronicle-great-maw-seal","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-ancestral-muster","chronicle-crimson-insight","chronicle-crimson-insight","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-great-maw-seal","chronicle-guard-stance","chronicle-guard-stance","chronicle-hall-of-mirrors","chronicle-hall-of-mirrors","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-storm-shear","chronicle-substitution-log","chronicle-substitution-log","chronicle-widespread-kunai-line","chronicle-widespread-kunai-line","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-107","tc-107","tc-107","tc-108","tc-11","tc-132","tc-141","tc-141","tc-15","tc-19","tc-21","tc-23","tc-27","tc-27","tc-27","tc-31","tc-36","tc-38","tc-54","tc-62","tc-62","tc-62","tc-67","tc-70","tc-73","tc-73","tc-77","tc-82","tc-82","tc-83","tc-83","tc-95","tc-95","tc-95"],
    },
    {
        id: "hayate",
        name: "Hayate",
        rank: "chunin",
        personality: "guardian",
        avatar: "/npc-portraits/hayate.avif",
        specialty: "Taijutsu",
        elements: ["Earth","Fire"],
        stats: {"strength":1,"speed":0.94,"intelligence":0.36,"willpower":0.33,"bukijutsuOffense":0.12,"bukijutsuDefense":0.86,"taijutsuOffense":1,"taijutsuDefense":0.83,"genjutsuOffense":0.16,"genjutsuDefense":0.88,"ninjutsuOffense":0.17,"ninjutsuDefense":0.89},
        bloodline: { ...{"id":"cinderhold-hayate-bloodline","name":"Slagplate","rank":"B Rank","specialElement":"Slag","weatherElement":"Earth","lore":"Slagplate shinobi wear the waste of the village forges as armor. What the smiths throw away, they turn into a wall.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-hayate-bulwark","name":"Slag Aegis","type":"Taijutsu","element":"Slag","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0},{"name":"Decrease Damage Taken","percent":25}],"battleDescription":"A Slag shell closes around %user before the blow lands.","description":"A Slag shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-hayate-bind","name":"Slag Shackle","type":"Taijutsu","element":"Slag","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0}],"battleDescription":"Slag chains lock %target where they stand.","description":"Slag chains lock %target where they stand.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-hayate-riposte","name":"Slag Riposte","type":"Taijutsu","element":"Slag","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":30}],"battleDescription":"%user turns the force of %target back on them with a Slag counter.","description":"%user turns the force of %target back on them with a Slag counter.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-hayate-stance","name":"Slag Stance","type":"Any","element":"Slag","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":25},{"name":"Absorb","percent":30}],"battleDescription":"%user plants their feet as Slag hardens over their skin.","description":"%user plants their feet as Slag hardens over their skin.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-hayate-bulwark","cinderhold-hayate-bind","cinderhold-hayate-riposte","cinderhold-hayate-stance","starter-universal-flicker","starter-tai-earth-2","starter-tai-earth-6","starter-tai-earth-aoe","starter-tai-fire-aoe","starter-tai-earth-3","starter-tai-earth-4","starter-tai-fire-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-hayate-bulwark","cinderhold-hayate-bind","cinderhold-hayate-riposte","cinderhold-hayate-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-hayate-bulwark","cinderhold-hayate-bind","cinderhold-hayate-riposte","cinderhold-hayate-stance","starter-universal-flicker","starter-tai-earth-2","starter-tai-earth-6","starter-tai-earth-aoe","starter-tai-earth-5","starter-tai-earth-3","starter-tai-earth-4","starter-any-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-hayate-bulwark","cinderhold-hayate-bind","cinderhold-hayate-riposte","cinderhold-hayate-stance","starter-universal-flicker","starter-tai-earth-2","starter-tai-earth-6","starter-tai-earth-aoe","starter-tai-fire-aoe","starter-tai-earth-3","starter-tai-earth-4","starter-tai-fire-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-hayate-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-hayate-bind","level":1,"xp":0},{"jutsuId":"cinderhold-hayate-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-hayate-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-earth-2","level":1,"xp":0},{"jutsuId":"starter-tai-earth-6","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-earth-5","level":1,"xp":0},{"jutsuId":"starter-tai-earth-3","level":1,"xp":0},{"jutsuId":"starter-tai-earth-4","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-tai-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-fire-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"stormcoil-kusarigama","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"embercoil-scythe","head":"ironwall-crown","body":"ironwall-chest","waist":"ironwall-waist","legs":"ironwall-legs","feet":"ironwall-feet"}},
        ],
        pets: [
            {"templateId":"rare-49","species":"Bramble Capybara","rarity":"rare","nickname":"Pyrewing","signature":true,"instanceId":"rare-49:npc-hayate-1","trait":"Loyal"},
            {"templateId":"rare-6","species":"Dune Viper","rarity":"rare","nickname":"Cindersong","signature":false,"instanceId":"rare-6:npc-hayate-2","trait":"Loyal"},
            {"templateId":"rare-15","species":"Cinder Weasel","rarity":"rare","nickname":"Pyredrift","signature":false,"instanceId":"rare-15:npc-hayate-3","trait":"Loyal"},
            {"templateId":"standard-15","species":"Cinder Rat","rarity":"standard","nickname":"Sparkpip","signature":false,"instanceId":"standard-15:npc-hayate-4","trait":"Loyal"},
        ],
        deck: { name: "Forge Wall", cards: ["tc-21","tc-21","tc-21","tc-24","tc-24","tc-42","tc-42","tc-12","tc-12","tc-12","tc-43","tc-43","tc-43","tc-48","tc-48","tc-67","tc-03","tc-03","tc-03","tc-68","tc-68","tc-78","tc-35","tc-40","tc-40","chronicle-field-desert","chronicle-final-bulwark","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-stoneplate-harness","chronicle-ironwood-bulwark","chronicle-long-watch","chronicle-long-watch","chronicle-palm-ward","chronicle-returning-cylinder-seal","chronicle-scorpion-wire","chronicle-scorpion-wire","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-final-bulwark","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-ironwood-bulwark","chronicle-long-watch","chronicle-long-watch","chronicle-medical-salve","chronicle-medical-salve","chronicle-palm-ward","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-returning-cylinder-seal","chronicle-scorpion-wire","chronicle-scorpion-wire","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier","chronicle-stoneplate-harness","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-03","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-12","tc-12","tc-12","tc-15","tc-19","tc-21","tc-21","tc-21","tc-23","tc-24","tc-24","tc-31","tc-35","tc-36","tc-38","tc-40","tc-40","tc-42","tc-42","tc-43","tc-43","tc-43","tc-48","tc-48","tc-54","tc-67","tc-68","tc-68","tc-70","tc-78"],
    },
    {
        id: "kohaku",
        name: "Kohaku",
        rank: "chunin",
        personality: "trickster",
        avatar: "/npc-portraits/kohaku.avif",
        specialty: "Genjutsu",
        elements: ["Wind","Water"],
        stats: {"strength":0.32,"speed":0.33,"intelligence":1,"willpower":0.93,"bukijutsuOffense":0.1,"bukijutsuDefense":0.62,"taijutsuOffense":0.17,"taijutsuDefense":0.58,"genjutsuOffense":1,"genjutsuDefense":0.56,"ninjutsuOffense":0.18,"ninjutsuDefense":0.63},
        bloodline: { ...{"id":"cinderhold-kohaku-bloodline","name":"Haze Dancer","rank":"B Rank","specialElement":"Haze","weatherElement":"Wind","lore":"A Haze Dancer moves inside the shimmer that rises from hot stone. Enemies strike at where she seems to be and find only warm air.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-kohaku-lock","name":"Haze Stillness","type":"Genjutsu","element":"Haze","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Haze sparks freeze %target in place.","description":"Haze sparks freeze %target in place.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-kohaku-shove","name":"Haze Heave","type":"Genjutsu","element":"Haze","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Push","percent":0},{"name":"Poison","percent":30}],"battleDescription":"A Haze gust throws %target across the field.","description":"A Haze gust throws %target across the field.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-kohaku-hex","name":"Haze Hex","type":"Genjutsu","element":"Haze","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":25},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"A Haze hex weakens %target.","description":"A Haze hex weakens %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-kohaku-fog","name":"Haze Fog","type":"Any","element":"Haze","ap":40,"range":4,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":30},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Haze fog clouds the senses of %target.","description":"Haze fog clouds the senses of %target.","isUtility":true,"weatherElement":"Wind"},
        ] },
        equippedJutsuIds: ["cinderhold-kohaku-lock","cinderhold-kohaku-shove","cinderhold-kohaku-hex","cinderhold-kohaku-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-5","starter-gen-wind-2","starter-gen-water-5","starter-any-wind-1","starter-gen-wind-4","starter-gen-water-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-kohaku-lock","cinderhold-kohaku-shove","cinderhold-kohaku-hex","cinderhold-kohaku-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-kohaku-lock","cinderhold-kohaku-shove","cinderhold-kohaku-hex","cinderhold-kohaku-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-5","starter-gen-wind-2","starter-gen-wind-6","starter-any-wind-1","starter-gen-wind-4","starter-gen-wind-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-kohaku-lock","cinderhold-kohaku-shove","cinderhold-kohaku-hex","cinderhold-kohaku-fog","starter-universal-flicker","starter-gen-wind-aoe","starter-gen-wind-5","starter-gen-wind-2","starter-gen-water-5","starter-any-wind-1","starter-gen-wind-4","starter-gen-water-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-kohaku-lock","level":1,"xp":0},{"jutsuId":"cinderhold-kohaku-shove","level":1,"xp":0},{"jutsuId":"cinderhold-kohaku-hex","level":1,"xp":0},{"jutsuId":"cinderhold-kohaku-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-wind-5","level":1,"xp":0},{"jutsuId":"starter-gen-wind-2","level":1,"xp":0},{"jutsuId":"starter-gen-wind-6","level":1,"xp":0},{"jutsuId":"starter-any-wind-1","level":1,"xp":0},{"jutsuId":"starter-gen-wind-4","level":1,"xp":0},{"jutsuId":"starter-gen-wind-3","level":1,"xp":0},{"jutsuId":"starter-gen-water-5","level":1,"xp":0},{"jutsuId":"starter-gen-water-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"rare-14","species":"Pearl Crane","rarity":"rare","nickname":"Kindlestep","signature":true,"instanceId":"rare-14:npc-kohaku-1","trait":"Lucky"},
            {"templateId":"rare-4","species":"Tide Otter","rarity":"rare","nickname":"Lumenclaw","signature":false,"instanceId":"rare-4:npc-kohaku-2","trait":"Lucky"},
            {"templateId":"rare-3","species":"Sky Falcon","rarity":"rare","nickname":"Flintfang","signature":false,"instanceId":"rare-3:npc-kohaku-3","trait":"Lucky"},
            {"templateId":"standard-30","species":"Brook Newt","rarity":"standard","nickname":"Sootpaw","signature":false,"instanceId":"standard-30:npc-kohaku-4","trait":"Swift"},
        ],
        deck: { name: "Heat Shimmer", cards: ["tc-06","tc-06","tc-31","tc-31","tc-31","tc-76","tc-76","tc-02","tc-02","tc-02","tc-10","tc-10","tc-10","tc-17","tc-17","tc-18","tc-49","tc-49","tc-93","tc-93","tc-144","tc-15","chronicle-field-sky","chronicle-field-sky","chronicle-final-bulwark","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-sealbreak-verdict","chronicle-second-wind-recall","chronicle-moonshadow-slip","chronicle-palm-ward","chronicle-sovereigns-decree","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-substitution-mirror"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-sky","chronicle-field-sky","chronicle-final-bulwark","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-moonshadow-slip","chronicle-palm-ward","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-second-wind-recall","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-sovereigns-decree","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","chronicle-substitution-mirror","tc-01","tc-01","tc-02","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-10","tc-10","tc-10","tc-11","tc-144","tc-15","tc-17","tc-17","tc-18","tc-19","tc-21","tc-23","tc-31","tc-31","tc-31","tc-36","tc-38","tc-49","tc-49","tc-54","tc-67","tc-70","tc-76","tc-76","tc-93","tc-93"],
    },
    {
        id: "alisia",
        name: "Alisia",
        rank: "chunin",
        personality: "aggressive",
        avatar: "/npc-portraits/alisia.avif",
        specialty: "Bukijutsu",
        elements: ["Fire","Wind"],
        stats: {"strength":1,"speed":0.38,"intelligence":0.86,"willpower":0.34,"bukijutsuOffense":1,"bukijutsuDefense":0.46,"taijutsuOffense":0.1,"taijutsuDefense":0.47,"genjutsuOffense":0.12,"genjutsuDefense":0.54,"ninjutsuOffense":0.18,"ninjutsuDefense":0.49},
        bloodline: { ...{"id":"cinderhold-alisia-bloodline","name":"Lantern Blade","rank":"B Rank","specialElement":"Lanternfire","weatherElement":"Fire","lore":"Lantern Blade wielders light their weapons from the festival lanterns of Cinderhold. The flame stays on the steel until the fight is won.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-alisia-nuke","name":"Lanternfire Ruin","type":"Bukijutsu","element":"Lanternfire","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30}],"battleDescription":"Lanternfire chakra erupts over %target in one ruinous blast.","description":"Lanternfire chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-alisia-rend","name":"Lanternfire Rend","type":"Bukijutsu","element":"Lanternfire","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Ignition","percent":30},{"name":"Siphon","percent":30}],"battleDescription":"Lanternfire claws tear into %target and leave the wound burning.","description":"Lanternfire claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-alisia-strike","name":"Lanternfire Strike","type":"Bukijutsu","element":"Lanternfire","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":25}],"battleDescription":"A Lanternfire strike crashes into %target.","description":"A Lanternfire strike crashes into %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-alisia-trance","name":"Lanternfire Trance","type":"Any","element":"Lanternfire","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":25},{"name":"Lifesteal","percent":30}],"battleDescription":"%user breathes in Lanternfire heat and moves faster than thought.","description":"%user breathes in Lanternfire heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-alisia-nuke","cinderhold-alisia-rend","cinderhold-alisia-strike","cinderhold-alisia-trance","starter-universal-flicker","starter-buki-fire-2","starter-buki-fire-5","starter-buki-fire-aoe","starter-buki-wind-2","starter-buki-fire-4","starter-any-fire-1","starter-buki-wind-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-alisia-nuke","cinderhold-alisia-rend","cinderhold-alisia-strike","cinderhold-alisia-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-alisia-nuke","cinderhold-alisia-rend","cinderhold-alisia-strike","cinderhold-alisia-trance","starter-universal-flicker","starter-buki-fire-2","starter-buki-fire-5","starter-buki-fire-aoe","starter-buki-fire-6","starter-buki-fire-4","starter-any-fire-1","starter-buki-fire-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-alisia-nuke","cinderhold-alisia-rend","cinderhold-alisia-strike","cinderhold-alisia-trance","starter-universal-flicker","starter-buki-fire-2","starter-buki-fire-5","starter-buki-fire-aoe","starter-buki-wind-2","starter-buki-fire-4","starter-any-fire-1","starter-buki-wind-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-alisia-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-alisia-rend","level":1,"xp":0},{"jutsuId":"cinderhold-alisia-strike","level":1,"xp":0},{"jutsuId":"cinderhold-alisia-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-fire-2","level":1,"xp":0},{"jutsuId":"starter-buki-fire-5","level":1,"xp":0},{"jutsuId":"starter-buki-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-fire-6","level":1,"xp":0},{"jutsuId":"starter-buki-fire-4","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-buki-fire-3","level":1,"xp":0},{"jutsuId":"starter-buki-wind-2","level":1,"xp":0},{"jutsuId":"starter-buki-wind-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rustfang-kunai","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rustfang-kunai","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"rare-26","species":"Ember Ocelot","rarity":"rare","nickname":"Hazewing","signature":true,"instanceId":"rare-26:npc-alisia-1","trait":"Aggressive"},
            {"templateId":"rare-20","species":"Bamboo Ape","rarity":"rare","nickname":"Glowclaw","signature":false,"instanceId":"rare-20:npc-alisia-2","trait":"Battleborn"},
            {"templateId":"rare-10","species":"Silver Owl","rarity":"rare","nickname":"Ashfang","signature":false,"instanceId":"rare-10:npc-alisia-3","trait":"Battleborn"},
            {"templateId":"standard-35","species":"Breeze Finch","rarity":"standard","nickname":"Sparkear","signature":false,"instanceId":"standard-35:npc-alisia-4","trait":"Battleborn"},
        ],
        deck: { name: "Lantern Parade", cards: ["tc-08","tc-08","tc-08","tc-42","tc-42","tc-42","tc-61","tc-61","tc-61","tc-13","tc-13","tc-67","tc-67","tc-67","tc-142","tc-83","tc-83","tc-83","tc-54","tc-54","chronicle-ancestral-muster","chronicle-bannerlords-rally","chronicle-field-volcano","chronicle-field-volcano","chronicle-hollow-breach","chronicle-revival-scroll","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-cinder-minefield","chronicle-cinder-minefield","chronicle-ember-cipher","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-pitfall-tag-array","chronicle-pitfall-tag-array","chronicle-ringed-detonation","chronicle-sovereigns-decree","chronicle-wall-of-smoke","chronicle-wall-of-smoke"] },
        collection: ["chronicle-ancestral-muster","chronicle-bannerlords-rally","chronicle-cinder-minefield","chronicle-cinder-minefield","chronicle-ember-cipher","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-field-volcano","chronicle-guard-stance","chronicle-guard-stance","chronicle-hollow-breach","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-ringed-detonation","chronicle-sealbreak-verdict","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-sovereigns-decree","chronicle-substitution-log","chronicle-substitution-log","chronicle-wall-of-smoke","chronicle-wall-of-smoke","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-08","tc-08","tc-09","tc-09","tc-11","tc-13","tc-13","tc-142","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-42","tc-42","tc-42","tc-54","tc-54","tc-61","tc-61","tc-61","tc-67","tc-67","tc-67","tc-70","tc-83","tc-83","tc-83"],
    },
    {
        id: "ayame",
        name: "Ayame",
        rank: "chunin",
        personality: "medic",
        avatar: "/npc-portraits/ayame.avif",
        specialty: "Taijutsu",
        elements: ["Earth","Water"],
        stats: {"strength":1,"speed":0.93,"intelligence":0.34,"willpower":0.34,"bukijutsuOffense":0.15,"bukijutsuDefense":0.71,"taijutsuOffense":1,"taijutsuDefense":0.67,"genjutsuOffense":0.15,"genjutsuDefense":0.72,"ninjutsuOffense":0.19,"ninjutsuDefense":0.66},
        bloodline: { ...{"id":"cinderhold-ayame-bloodline","name":"Hot Stone","rank":"B Rank","specialElement":"Geotherm","weatherElement":"Earth","lore":"Hot Stone medics press heated rock to a wound and draw the poison out with it. The technique is older than the village itself.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-ayame-mend","name":"Geotherm Rekindling","type":"Any","element":"Geotherm","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Decrease Damage Taken","percent":25}],"battleDescription":"Geotherm warmth closes the wounds of %user.","description":"Geotherm warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Earth"},
            {"id":"cinderhold-ayame-leech","name":"Geotherm Leech","type":"Taijutsu","element":"Geotherm","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Geotherm threads pull life out of %target.","description":"Geotherm threads pull life out of %target.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-ayame-vamp","name":"Geotherm Feast","type":"Taijutsu","element":"Geotherm","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":30}],"battleDescription":"A Geotherm strike feeds %user on the strength of %target.","description":"A Geotherm strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-ayame-toxin","name":"Geotherm Fumes","type":"Taijutsu","element":"Geotherm","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":25},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"Geotherm fumes seep into the chakra of %target.","description":"Geotherm fumes seep into the chakra of %target.","isUtility":false,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-ayame-mend","cinderhold-ayame-leech","cinderhold-ayame-vamp","cinderhold-ayame-toxin","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-2","starter-tai-earth-aoe","starter-tai-water-6","starter-tai-earth-4","starter-tai-earth-3","starter-tai-water-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-ayame-mend","cinderhold-ayame-leech","cinderhold-ayame-vamp","cinderhold-ayame-toxin","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-ayame-mend","cinderhold-ayame-leech","cinderhold-ayame-vamp","cinderhold-ayame-toxin","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-2","starter-tai-earth-aoe","starter-tai-earth-5","starter-tai-earth-4","starter-tai-earth-3","starter-tai-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-ayame-mend","cinderhold-ayame-leech","cinderhold-ayame-vamp","cinderhold-ayame-toxin","starter-universal-flicker","starter-tai-earth-6","starter-tai-earth-2","starter-tai-earth-aoe","starter-tai-water-6","starter-tai-earth-4","starter-tai-earth-3","starter-tai-water-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-ayame-mend","level":1,"xp":0},{"jutsuId":"cinderhold-ayame-leech","level":1,"xp":0},{"jutsuId":"cinderhold-ayame-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-ayame-toxin","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-earth-6","level":1,"xp":0},{"jutsuId":"starter-tai-earth-2","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-earth-5","level":1,"xp":0},{"jutsuId":"starter-tai-earth-4","level":1,"xp":0},{"jutsuId":"starter-tai-earth-3","level":1,"xp":0},{"jutsuId":"starter-tai-earth-1","level":1,"xp":0},{"jutsuId":"starter-tai-water-6","level":1,"xp":0},{"jutsuId":"starter-tai-water-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"spirit-leech-wakizashi","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"rare-46","species":"Stoneback Tapir","rarity":"rare","nickname":"Cinderdrift","signature":true,"instanceId":"rare-46:npc-ayame-1","trait":"Lucky"},
            {"templateId":"rare-47","species":"Quartz Aardvark","rarity":"rare","nickname":"Charpaw","signature":false,"instanceId":"rare-47:npc-ayame-2","trait":"Loyal"},
            {"templateId":"rare-34","species":"Glacier Marten","rarity":"rare","nickname":"Scoriasong","signature":false,"instanceId":"rare-34:npc-ayame-3","trait":"Loyal"},
            {"templateId":"standard-5","species":"Stone Turtle","rarity":"standard","nickname":"Slagtuft","signature":false,"instanceId":"standard-5:npc-ayame-4","trait":"Loyal"},
        ],
        deck: { name: "Stone Bath", cards: ["tc-21","tc-21","tc-26","tc-26","tc-26","tc-47","tc-47","tc-51","tc-51","tc-51","tc-71","tc-71","tc-71","tc-121","tc-82","tc-82","tc-114","tc-114","tc-58","tc-58","tc-58","tc-59","tc-59","chronicle-chakra-ledger","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-field-desert","chronicle-field-desert","chronicle-grave-lantern-rite","chronicle-recall-seal","chronicle-recall-seal","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-revival-scroll","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb"] },
        collection: ["chronicle-chakra-ledger","chronicle-cleansing-radiance","chronicle-cleansing-radiance","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-field-desert","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-recall-seal","chronicle-recall-seal","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-reinforced-vest","chronicle-reinforced-vest","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-114","tc-114","tc-121","tc-15","tc-19","tc-21","tc-21","tc-23","tc-26","tc-26","tc-26","tc-31","tc-36","tc-38","tc-47","tc-47","tc-51","tc-51","tc-51","tc-54","tc-58","tc-58","tc-58","tc-59","tc-59","tc-67","tc-70","tc-71","tc-71","tc-71","tc-82","tc-82"],
    },
    {
        id: "shion",
        name: "Shion",
        rank: "chunin",
        personality: "trickster",
        avatar: "/npc-portraits/shion.avif",
        specialty: "Genjutsu",
        elements: ["Lightning","Wind"],
        stats: {"strength":0.35,"speed":0.35,"intelligence":1,"willpower":0.92,"bukijutsuOffense":0.12,"bukijutsuDefense":0.55,"taijutsuOffense":0.2,"taijutsuDefense":0.56,"genjutsuOffense":1,"genjutsuDefense":0.59,"ninjutsuOffense":0.17,"ninjutsuDefense":0.63},
        bloodline: { ...{"id":"cinderhold-shion-bloodline","name":"Soot Spark","rank":"B Rank","specialElement":"Sootlight","weatherElement":"Lightning","lore":"Soot Spark chakra glows only in darkness. Its users fight at night, when every spark looks like a star.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-shion-lock","name":"Sootlight Lock","type":"Genjutsu","element":"Sootlight","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Sootlight sparks freeze %target in place.","description":"Sootlight sparks freeze %target in place.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-shion-shove","name":"Sootlight Heave","type":"Genjutsu","element":"Sootlight","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pull","percent":0},{"name":"Poison","percent":25}],"battleDescription":"A Sootlight gust throws %target across the field.","description":"A Sootlight gust throws %target across the field.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-shion-hex","name":"Sootlight Hex","type":"Genjutsu","element":"Sootlight","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":30},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"A Sootlight hex weakens %target.","description":"A Sootlight hex weakens %target.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-shion-fog","name":"Sootlight Veil","type":"Any","element":"Sootlight","ap":40,"range":5,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":30}],"battleDescription":"Sootlight fog clouds the senses of %target.","description":"Sootlight fog clouds the senses of %target.","isUtility":true,"weatherElement":"Lightning"},
        ] },
        equippedJutsuIds: ["cinderhold-shion-lock","cinderhold-shion-shove","cinderhold-shion-hex","cinderhold-shion-fog","starter-universal-flicker","starter-gen-lightning-6","starter-gen-lightning-2","starter-gen-lightning-5","starter-gen-wind-5","starter-gen-lightning-3","starter-gen-lightning-4","starter-any-wind-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-shion-lock","cinderhold-shion-shove","cinderhold-shion-hex","cinderhold-shion-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-shion-lock","cinderhold-shion-shove","cinderhold-shion-hex","cinderhold-shion-fog","starter-universal-flicker","starter-gen-lightning-6","starter-gen-lightning-2","starter-gen-lightning-5","starter-gen-lightning-aoe","starter-gen-lightning-3","starter-gen-lightning-4","starter-gen-lightning-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-shion-lock","cinderhold-shion-shove","cinderhold-shion-hex","cinderhold-shion-fog","starter-universal-flicker","starter-gen-lightning-6","starter-gen-lightning-2","starter-gen-lightning-5","starter-gen-wind-5","starter-gen-lightning-3","starter-gen-lightning-4","starter-any-wind-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-shion-lock","level":1,"xp":0},{"jutsuId":"cinderhold-shion-shove","level":1,"xp":0},{"jutsuId":"cinderhold-shion-hex","level":1,"xp":0},{"jutsuId":"cinderhold-shion-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-6","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-2","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-5","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-3","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-4","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-1","level":1,"xp":0},{"jutsuId":"starter-gen-wind-5","level":1,"xp":0},{"jutsuId":"starter-any-wind-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"rare-42","species":"Thunder Jerboa","rarity":"rare","nickname":"Smokescale","signature":true,"instanceId":"rare-42:npc-shion-1","trait":"Lucky"},
            {"templateId":"rare-40","species":"Volt Polecat","rarity":"rare","nickname":"Kindleheart","signature":false,"instanceId":"rare-40:npc-shion-2","trait":"Swift"},
            {"templateId":"rare-17","species":"Stormfin Gull","rarity":"rare","nickname":"Pyretail","signature":false,"instanceId":"rare-17:npc-shion-3","trait":"Lucky"},
            {"templateId":"standard-18","species":"Shadow Bat","rarity":"standard","nickname":"Kindleshade","signature":false,"instanceId":"standard-18:npc-shion-4","trait":"Swift"},
        ],
        deck: { name: "Night Sparks", cards: ["tc-103","tc-103","tc-103","tc-113","tc-113","tc-33","tc-33","tc-33","tc-37","tc-37","tc-37","tc-72","tc-72","tc-72","tc-87","tc-87","tc-18","tc-18","tc-88","tc-88","tc-88","tc-115","tc-115","chronicle-field-lightning-storm","chronicle-grave-lantern-rite","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-flash-burial-tag","chronicle-flash-burial-tag","chronicle-gatekeepers-rebuke","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-lightning-storm","chronicle-flash-burial-tag","chronicle-flash-burial-tag","chronicle-gatekeepers-rebuke","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-kage-archive-lock","chronicle-kage-archive-lock","chronicle-medical-salve","chronicle-medical-salve","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-mirror","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-103","tc-103","tc-103","tc-11","tc-113","tc-113","tc-115","tc-115","tc-15","tc-18","tc-18","tc-19","tc-21","tc-23","tc-31","tc-33","tc-33","tc-33","tc-36","tc-37","tc-37","tc-37","tc-38","tc-54","tc-67","tc-70","tc-72","tc-72","tc-72","tc-87","tc-87","tc-88","tc-88","tc-88"],
    },
    {
        id: "veyl",
        name: "Veyl",
        rank: "genin",
        personality: "aggressive",
        avatar: "/npc-portraits/veyl.avif",
        specialty: "Taijutsu",
        elements: ["Fire","Lightning"],
        stats: {"strength":1,"speed":0.93,"intelligence":0.3,"willpower":0.35,"bukijutsuOffense":0.11,"bukijutsuDefense":0.49,"taijutsuOffense":1,"taijutsuDefense":0.47,"genjutsuOffense":0.14,"genjutsuDefense":0.55,"ninjutsuOffense":0.19,"ninjutsuDefense":0.5},
        bloodline: { ...{"id":"cinderhold-veyl-bloodline","name":"Spark Knuckle","rank":"B Rank","specialElement":"Sparkfire","weatherElement":"Fire","lore":"Spark Knuckle is the first bloodline many Cinderhold children awaken. It throws sparks with every punch and teaches them to keep their hands moving.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-veyl-nuke","name":"Sparkfire Ruin","type":"Taijutsu","element":"Sparkfire","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Sparkfire chakra erupts over %target in one ruinous blast.","description":"Sparkfire chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-veyl-rend","name":"Sparkfire Rend","type":"Taijutsu","element":"Sparkfire","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Wound","percent":25},{"name":"Siphon","percent":30}],"battleDescription":"Sparkfire claws tear into %target and leave the wound burning.","description":"Sparkfire claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-veyl-strike","name":"Sparkfire Strike","type":"Taijutsu","element":"Sparkfire","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":30}],"battleDescription":"A Sparkfire strike crashes into %target.","description":"A Sparkfire strike crashes into %target.","isUtility":false,"weatherElement":"Fire"},
            {"id":"cinderhold-veyl-trance","name":"Sparkfire Frenzy","type":"Any","element":"Sparkfire","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":25},{"name":"Lifesteal","percent":30}],"battleDescription":"%user breathes in Sparkfire heat and moves faster than thought.","description":"%user breathes in Sparkfire heat and moves faster than thought.","isUtility":true,"weatherElement":"Fire"},
        ] },
        equippedJutsuIds: ["cinderhold-veyl-nuke","cinderhold-veyl-rend","cinderhold-veyl-strike","cinderhold-veyl-trance","starter-universal-flicker","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-fire-6","starter-tai-lightning-5","starter-tai-fire-1","starter-tai-fire-3","starter-tai-lightning-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-veyl-nuke","cinderhold-veyl-rend","cinderhold-veyl-strike","cinderhold-veyl-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-veyl-nuke","cinderhold-veyl-rend","cinderhold-veyl-strike","cinderhold-veyl-trance","starter-universal-flicker","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-fire-6","starter-tai-fire-2","starter-tai-fire-1","starter-tai-fire-3","starter-any-fire-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-veyl-nuke","cinderhold-veyl-rend","cinderhold-veyl-strike","cinderhold-veyl-trance","starter-universal-flicker","starter-tai-fire-aoe","starter-tai-fire-5","starter-tai-fire-6","starter-tai-lightning-5","starter-tai-fire-1","starter-tai-fire-3","starter-tai-lightning-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-veyl-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-veyl-rend","level":1,"xp":0},{"jutsuId":"cinderhold-veyl-strike","level":1,"xp":0},{"jutsuId":"cinderhold-veyl-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-fire-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-fire-5","level":1,"xp":0},{"jutsuId":"starter-tai-fire-6","level":1,"xp":0},{"jutsuId":"starter-tai-fire-2","level":1,"xp":0},{"jutsuId":"starter-tai-fire-1","level":1,"xp":0},{"jutsuId":"starter-tai-fire-3","level":1,"xp":0},{"jutsuId":"starter-any-fire-1","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-5","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"stormcoil-kusarigama","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"rare-29","species":"Blaze Caracal","rarity":"rare","nickname":"Pyrewhisker","signature":true,"instanceId":"rare-29:npc-veyl-1","trait":"Battleborn"},
            {"templateId":"standard-43","species":"Storm Shrike","rarity":"standard","nickname":"Scoriaburr","signature":false,"instanceId":"standard-43:npc-veyl-2","trait":"Aggressive"},
            {"templateId":"standard-6","species":"Desert Lizard","rarity":"standard","nickname":"Scorianose","signature":false,"instanceId":"standard-6:npc-veyl-3","trait":"Aggressive"},
            {"templateId":"standard-41","species":"Bolt Mouse","rarity":"standard","nickname":"Kindlescale","signature":false,"instanceId":"standard-41:npc-veyl-4","trait":"Aggressive"},
        ],
        deck: { name: "First Flame", cards: ["tc-01","tc-01","tc-01","tc-08","tc-08","tc-56","tc-56","tc-56","tc-61","tc-61","tc-61","tc-13","tc-13","tc-13","tc-92","tc-92","tc-78","tc-83","tc-83","tc-83","tc-74","tc-74","tc-90","chronicle-bannerlords-rally","chronicle-field-volcano","chronicle-hall-of-mirrors","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-rift-cleaving-script","chronicle-storm-shear","chronicle-stormforged-senbon","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-still-water-rebuttal","chronicle-wall-of-smoke","chronicle-wall-of-smoke","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-bannerlords-rally","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-ember-cipher","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-volcano","chronicle-guard-stance","chronicle-guard-stance","chronicle-hall-of-mirrors","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-rift-cleaving-script","chronicle-rift-cleaving-script","chronicle-sealing-circle","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-still-water-rebuttal","chronicle-storm-shear","chronicle-stormforged-senbon","chronicle-substitution-log","chronicle-substitution-log","chronicle-wall-of-smoke","chronicle-wall-of-smoke","chronicle-widespread-kunai-line","tc-01","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-08","tc-09","tc-09","tc-11","tc-13","tc-13","tc-13","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-54","tc-56","tc-56","tc-56","tc-61","tc-61","tc-61","tc-67","tc-70","tc-74","tc-74","tc-78","tc-83","tc-83","tc-83","tc-90","tc-92","tc-92"],
    },
    {
        id: "riven",
        name: "Riven",
        rank: "genin",
        personality: "guardian",
        avatar: "/npc-portraits/riven.avif",
        specialty: "Bukijutsu",
        elements: ["Earth","Fire"],
        stats: {"strength":1,"speed":0.33,"intelligence":0.86,"willpower":0.38,"bukijutsuOffense":1,"bukijutsuDefense":0.83,"taijutsuOffense":0.19,"taijutsuDefense":0.83,"genjutsuOffense":0.12,"genjutsuDefense":0.89,"ninjutsuOffense":0.18,"ninjutsuDefense":0.81},
        bloodline: { ...{"id":"cinderhold-riven-bloodline","name":"Brick Kiln","rank":"B Rank","specialElement":"Kiln","weatherElement":"Earth","lore":"Brick Kiln chakra bakes the ground into a low wall around its user. It is slow and plain, and it holds.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-riven-bulwark","name":"Kiln Aegis","type":"Bukijutsu","element":"Kiln","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0}],"battleDescription":"A Kiln shell closes around %user before the blow lands.","description":"A Kiln shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-riven-bind","name":"Kiln Shackle","type":"Bukijutsu","element":"Kiln","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Kiln chains lock %target where they stand.","description":"Kiln chains lock %target where they stand.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-riven-riposte","name":"Kiln Counter","type":"Bukijutsu","element":"Kiln","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":30}],"battleDescription":"%user turns the force of %target back on them with a Kiln counter.","description":"%user turns the force of %target back on them with a Kiln counter.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-riven-stance","name":"Kiln Stance","type":"Any","element":"Kiln","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":25},{"name":"Increase Heal","percent":25}],"battleDescription":"%user plants their feet as Kiln hardens over their skin.","description":"%user plants their feet as Kiln hardens over their skin.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-riven-bulwark","cinderhold-riven-bind","cinderhold-riven-riposte","cinderhold-riven-stance","starter-universal-flicker","starter-buki-earth-2","starter-buki-earth-6","starter-buki-earth-5","starter-buki-fire-5","starter-buki-earth-4","starter-buki-earth-1","starter-buki-fire-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-riven-bulwark","cinderhold-riven-bind","cinderhold-riven-riposte","cinderhold-riven-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-riven-bulwark","cinderhold-riven-bind","cinderhold-riven-riposte","cinderhold-riven-stance","starter-universal-flicker","starter-buki-earth-2","starter-buki-earth-6","starter-buki-earth-5","starter-buki-earth-aoe","starter-buki-earth-4","starter-buki-earth-1","starter-any-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-riven-bulwark","cinderhold-riven-bind","cinderhold-riven-riposte","cinderhold-riven-stance","starter-universal-flicker","starter-buki-earth-2","starter-buki-earth-6","starter-buki-earth-5","starter-buki-fire-5","starter-buki-earth-4","starter-buki-earth-1","starter-buki-fire-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-riven-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-riven-bind","level":1,"xp":0},{"jutsuId":"cinderhold-riven-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-riven-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-earth-2","level":1,"xp":0},{"jutsuId":"starter-buki-earth-6","level":1,"xp":0},{"jutsuId":"starter-buki-earth-5","level":1,"xp":0},{"jutsuId":"starter-buki-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-earth-4","level":1,"xp":0},{"jutsuId":"starter-buki-earth-1","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-buki-fire-5","level":1,"xp":0},{"jutsuId":"starter-buki-fire-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rustfang-kunai","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rustfang-kunai","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
        ],
        pets: [
            {"templateId":"rare-48","species":"Terra Porcupine","rarity":"rare","nickname":"Rustflick","signature":true,"instanceId":"rare-48:npc-riven-1","trait":"Loyal"},
            {"templateId":"standard-47","species":"Dune Armadillo","rarity":"standard","nickname":"Tinderdrift","signature":false,"instanceId":"standard-47:npc-riven-2","trait":"Loyal"},
            {"templateId":"standard-45","species":"Clay Tortoise","rarity":"standard","nickname":"Slagpaw","signature":false,"instanceId":"standard-45:npc-riven-3","trait":"Loyal"},
            {"templateId":"standard-23","species":"Rock Badger","rarity":"standard","nickname":"Rustbite","signature":false,"instanceId":"standard-23:npc-riven-4","trait":"Loyal"},
        ],
        deck: { name: "Kiln Keeper", cards: ["tc-01","tc-01","tc-24","tc-26","tc-26","tc-26","tc-47","tc-47","tc-47","tc-07","tc-07","tc-07","tc-12","tc-12","tc-67","tc-58","tc-58","tc-58","tc-68","tc-68","tc-68","tc-94","tc-94","tc-96","tc-96","chronicle-field-desert","chronicle-field-desert","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-medical-salve","chronicle-medical-salve","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-ironwood-bulwark","chronicle-smoke-bomb","chronicle-smoke-bomb"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-field-desert","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-ironwood-bulwark","chronicle-medical-salve","chronicle-medical-salve","chronicle-moonfold-genjutsu","chronicle-moonfold-genjutsu","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-12","tc-12","tc-15","tc-19","tc-21","tc-23","tc-24","tc-26","tc-26","tc-26","tc-31","tc-36","tc-38","tc-47","tc-47","tc-47","tc-54","tc-58","tc-58","tc-58","tc-67","tc-68","tc-68","tc-68","tc-70","tc-94","tc-94","tc-96","tc-96"],
    },
    {
        id: "vesper",
        name: "Vesper",
        rank: "genin",
        personality: "medic",
        avatar: "/npc-portraits/vesper.avif",
        specialty: "Ninjutsu",
        elements: ["Water","Earth"],
        stats: {"strength":0.34,"speed":0.86,"intelligence":0.32,"willpower":1,"bukijutsuOffense":0.19,"bukijutsuDefense":0.66,"taijutsuOffense":0.11,"taijutsuDefense":0.71,"genjutsuOffense":0.12,"genjutsuDefense":0.73,"ninjutsuOffense":1,"ninjutsuDefense":0.72},
        bloodline: { ...{"id":"cinderhold-vesper-bloodline","name":"Mineral Spring","rank":"B Rank","specialElement":"Mineral","weatherElement":"Water","lore":"Mineral Spring water rises bitter and warm from the mountain. Those who carry its blood can make an ally drink strength back into their body.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-vesper-mend","name":"Mineral Mending","type":"Any","element":"Mineral","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Increase Heal","percent":25}],"battleDescription":"Mineral warmth closes the wounds of %user.","description":"Mineral warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Water"},
            {"id":"cinderhold-vesper-leech","name":"Mineral Draw","type":"Ninjutsu","element":"Mineral","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0}],"battleDescription":"Mineral threads pull life out of %target.","description":"Mineral threads pull life out of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-vesper-vamp","name":"Mineral Thirst","type":"Ninjutsu","element":"Mineral","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":25},{"name":"Wound","percent":25}],"battleDescription":"A Mineral strike feeds %user on the strength of %target.","description":"A Mineral strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-vesper-toxin","name":"Mineral Blight","type":"Ninjutsu","element":"Mineral","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":30}],"battleDescription":"Mineral fumes seep into the chakra of %target.","description":"Mineral fumes seep into the chakra of %target.","isUtility":false,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-vesper-mend","cinderhold-vesper-leech","cinderhold-vesper-vamp","cinderhold-vesper-toxin","starter-universal-flicker","starter-nin-water-aoe","starter-nin-water-5","starter-nin-water-6","starter-nin-earth-5","starter-nin-water-1","starter-nin-water-4","starter-nin-earth-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-vesper-mend","cinderhold-vesper-leech","cinderhold-vesper-vamp","cinderhold-vesper-toxin","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-vesper-mend","cinderhold-vesper-leech","cinderhold-vesper-vamp","cinderhold-vesper-toxin","starter-universal-flicker","starter-nin-water-aoe","starter-nin-water-5","starter-nin-water-6","starter-nin-water-2","starter-nin-water-1","starter-nin-water-4","starter-any-water-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-vesper-mend","cinderhold-vesper-leech","cinderhold-vesper-vamp","cinderhold-vesper-toxin","starter-universal-flicker","starter-nin-water-aoe","starter-nin-water-5","starter-nin-water-6","starter-nin-earth-5","starter-nin-water-1","starter-nin-water-4","starter-nin-earth-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-vesper-mend","level":1,"xp":0},{"jutsuId":"cinderhold-vesper-leech","level":1,"xp":0},{"jutsuId":"cinderhold-vesper-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-vesper-toxin","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-water-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-water-5","level":1,"xp":0},{"jutsuId":"starter-nin-water-6","level":1,"xp":0},{"jutsuId":"starter-nin-water-2","level":1,"xp":0},{"jutsuId":"starter-nin-water-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-4","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-nin-earth-5","level":1,"xp":0},{"jutsuId":"starter-nin-earth-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"rare-21","species":"Frostbite Cub","rarity":"rare","nickname":"Smoldermane","signature":true,"instanceId":"rare-21:npc-vesper-1","trait":"Lucky"},
            {"templateId":"standard-2","species":"Black Cat","rarity":"standard","nickname":"Tindernose","signature":false,"instanceId":"standard-2:npc-vesper-2","trait":"Loyal"},
            {"templateId":"standard-31","species":"Pebble Crab","rarity":"standard","nickname":"Ashstep","signature":false,"instanceId":"standard-31:npc-vesper-3","trait":"Lucky"},
            {"templateId":"standard-19","species":"Mud Toad","rarity":"standard","nickname":"Glowsong","signature":false,"instanceId":"standard-19:npc-vesper-4","trait":"Lucky"},
        ],
        deck: { name: "Spring Water", cards: ["tc-66","tc-66","tc-91","tc-91","tc-91","tc-07","tc-12","tc-12","tc-27","tc-27","tc-27","tc-62","tc-62","tc-62","tc-77","tc-77","tc-23","tc-53","tc-53","tc-68","tc-68","tc-15","tc-15","chronicle-chakra-ledger","chronicle-field-ocean","chronicle-field-ocean","chronicle-flame-tempered-blade","chronicle-flame-tempered-blade","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-hollow-breach","chronicle-medical-salve","chronicle-medical-salve","chronicle-medical-salve","chronicle-revival-scroll","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-drowned-formula","chronicle-smoke-bomb","chronicle-smoke-bomb"] },
        collection: ["chronicle-chakra-ledger","chronicle-drowned-formula","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-field-ocean","chronicle-flame-tempered-blade","chronicle-flame-tempered-blade","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-hollow-breach","chronicle-medical-salve","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-12","tc-12","tc-15","tc-15","tc-19","tc-21","tc-23","tc-27","tc-27","tc-27","tc-31","tc-36","tc-38","tc-53","tc-53","tc-54","tc-62","tc-62","tc-62","tc-66","tc-66","tc-67","tc-68","tc-68","tc-70","tc-77","tc-77","tc-91","tc-91","tc-91"],
    },
    {
        id: "reika",
        name: "Reika",
        rank: "genin",
        personality: "trickster",
        avatar: "/npc-portraits/reika.avif",
        specialty: "Genjutsu",
        elements: ["Wind","Fire"],
        stats: {"strength":0.36,"speed":0.3,"intelligence":1,"willpower":0.86,"bukijutsuOffense":0.11,"bukijutsuDefense":0.61,"taijutsuOffense":0.2,"taijutsuDefense":0.61,"genjutsuOffense":1,"genjutsuDefense":0.6,"ninjutsuOffense":0.12,"ninjutsuDefense":0.6},
        bloodline: { ...{"id":"cinderhold-reika-bloodline","name":"Sootwing","rank":"B Rank","specialElement":"Soot","weatherElement":"Wind","lore":"Sootwing illusions flutter like black moths at the edge of sight. Young users practice by hiding in the chimney smoke above the market.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-reika-lock","name":"Soot Stillness","type":"Genjutsu","element":"Soot","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Stun","percent":0}],"battleDescription":"Soot sparks freeze %target in place.","description":"Soot sparks freeze %target in place.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-reika-shove","name":"Soot Gust","type":"Genjutsu","element":"Soot","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Push","percent":0},{"name":"Poison","percent":30}],"battleDescription":"A Soot gust throws %target across the field.","description":"A Soot gust throws %target across the field.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-reika-hex","name":"Soot Hex","type":"Genjutsu","element":"Soot","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":25}],"battleDescription":"A Soot hex weakens %target.","description":"A Soot hex weakens %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-reika-fog","name":"Soot Fog","type":"Any","element":"Soot","ap":40,"range":5,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":30}],"battleDescription":"Soot fog clouds the senses of %target.","description":"Soot fog clouds the senses of %target.","isUtility":true,"weatherElement":"Wind"},
        ] },
        equippedJutsuIds: ["cinderhold-reika-lock","cinderhold-reika-shove","cinderhold-reika-hex","cinderhold-reika-fog","starter-universal-flicker","starter-gen-wind-2","starter-gen-wind-aoe","starter-gen-wind-6","starter-gen-fire-5","starter-gen-wind-4","starter-any-wind-1","starter-gen-fire-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-reika-lock","cinderhold-reika-shove","cinderhold-reika-hex","cinderhold-reika-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-reika-lock","cinderhold-reika-shove","cinderhold-reika-hex","cinderhold-reika-fog","starter-universal-flicker","starter-gen-wind-2","starter-gen-wind-aoe","starter-gen-wind-6","starter-gen-wind-5","starter-gen-wind-4","starter-any-wind-1","starter-gen-wind-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-reika-lock","cinderhold-reika-shove","cinderhold-reika-hex","cinderhold-reika-fog","starter-universal-flicker","starter-gen-wind-2","starter-gen-wind-aoe","starter-gen-wind-6","starter-gen-fire-5","starter-gen-wind-4","starter-any-wind-1","starter-gen-fire-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-reika-lock","level":1,"xp":0},{"jutsuId":"cinderhold-reika-shove","level":1,"xp":0},{"jutsuId":"cinderhold-reika-hex","level":1,"xp":0},{"jutsuId":"cinderhold-reika-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-wind-2","level":1,"xp":0},{"jutsuId":"starter-gen-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-wind-6","level":1,"xp":0},{"jutsuId":"starter-gen-wind-5","level":1,"xp":0},{"jutsuId":"starter-gen-wind-4","level":1,"xp":0},{"jutsuId":"starter-any-wind-1","level":1,"xp":0},{"jutsuId":"starter-gen-wind-1","level":1,"xp":0},{"jutsuId":"starter-gen-fire-5","level":1,"xp":0},{"jutsuId":"starter-gen-fire-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"rare-39","species":"Drift Albatross","rarity":"rare","nickname":"Ashwing","signature":true,"instanceId":"rare-39:npc-reika-1","trait":"Lucky"},
            {"templateId":"standard-7","species":"Ashen Crow","rarity":"standard","nickname":"Sootnose","signature":false,"instanceId":"standard-7:npc-reika-2","trait":"Lucky"},
            {"templateId":"standard-20","species":"Leaf Monkey","rarity":"standard","nickname":"Chartail","signature":false,"instanceId":"standard-20:npc-reika-3","trait":"Lucky"},
            {"templateId":"standard-27","species":"Cinder Moth","rarity":"standard","nickname":"Blazeclaw","signature":false,"instanceId":"standard-27:npc-reika-4","trait":"Swift"},
        ],
        deck: { name: "Smudged Ink", cards: ["tc-06","tc-06","tc-06","tc-31","tc-31","tc-36","tc-36","tc-02","tc-02","tc-10","tc-10","tc-10","tc-85","tc-85","tc-03","tc-03","tc-119","tc-49","tc-49","tc-20","tc-20","tc-20","chronicle-field-sky","chronicle-recall-seal","chronicle-recall-seal","chronicle-recall-seal","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-gale-reversal","chronicle-gale-reversal","chronicle-gatekeepers-rebuke","chronicle-moonshadow-slip","chronicle-moonshadow-slip","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-wall-of-smoke","chronicle-wall-of-smoke"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-sky","chronicle-gale-reversal","chronicle-gale-reversal","chronicle-gatekeepers-rebuke","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-moonshadow-slip","chronicle-moonshadow-slip","chronicle-recall-seal","chronicle-recall-seal","chronicle-recall-seal","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-wall-of-smoke","chronicle-wall-of-smoke","tc-01","tc-01","tc-02","tc-02","tc-03","tc-03","tc-04","tc-05","tc-06","tc-06","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-10","tc-10","tc-10","tc-11","tc-119","tc-15","tc-19","tc-20","tc-20","tc-20","tc-21","tc-23","tc-31","tc-31","tc-36","tc-36","tc-38","tc-49","tc-49","tc-54","tc-67","tc-70","tc-85","tc-85"],
    },
    {
        id: "jiro",
        name: "Jiro",
        rank: "genin",
        personality: "aggressive",
        avatar: "/npc-portraits/jiro.avif",
        specialty: "Bukijutsu",
        elements: ["Earth","Fire"],
        stats: {"strength":1,"speed":0.35,"intelligence":0.89,"willpower":0.37,"bukijutsuOffense":1,"bukijutsuDefense":0.55,"taijutsuOffense":0.12,"taijutsuDefense":0.5,"genjutsuOffense":0.17,"genjutsuDefense":0.53,"ninjutsuOffense":0.1,"ninjutsuDefense":0.47},
        bloodline: { ...{"id":"cinderhold-jiro-bloodline","name":"Flintspark","rank":"B Rank","specialElement":"Flint","weatherElement":"Earth","lore":"Flintspark shinobi strike stone against stone to start a fight. Every clash of their blades throws a spray of sparks.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-jiro-nuke","name":"Flint Ruin","type":"Bukijutsu","element":"Flint","ap":60,"range":5,"effectPower":50,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30}],"battleDescription":"Flint chakra erupts over %target in one ruinous blast.","description":"Flint chakra erupts over %target in one ruinous blast.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-jiro-rend","name":"Flint Brand","type":"Bukijutsu","element":"Flint","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Wound","percent":25},{"name":"Siphon","percent":25}],"battleDescription":"Flint claws tear into %target and leave the wound burning.","description":"Flint claws tear into %target and leave the wound burning.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-jiro-strike","name":"Flint Crash","type":"Bukijutsu","element":"Flint","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Increase Damage Taken","percent":30}],"battleDescription":"A Flint strike crashes into %target.","description":"A Flint strike crashes into %target.","isUtility":false,"weatherElement":"Earth"},
            {"id":"cinderhold-jiro-trance","name":"Flint Trance","type":"Any","element":"Flint","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Increase Damage Given","percent":30},{"name":"Lifesteal","percent":30}],"battleDescription":"%user breathes in Flint heat and moves faster than thought.","description":"%user breathes in Flint heat and moves faster than thought.","isUtility":true,"weatherElement":"Earth"},
        ] },
        equippedJutsuIds: ["cinderhold-jiro-nuke","cinderhold-jiro-rend","cinderhold-jiro-strike","cinderhold-jiro-trance","starter-universal-flicker","starter-buki-earth-aoe","starter-buki-earth-5","starter-buki-earth-6","starter-buki-fire-2","starter-buki-earth-1","starter-buki-earth-4","starter-buki-fire-4"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-jiro-nuke","cinderhold-jiro-rend","cinderhold-jiro-strike","cinderhold-jiro-trance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-jiro-nuke","cinderhold-jiro-rend","cinderhold-jiro-strike","cinderhold-jiro-trance","starter-universal-flicker","starter-buki-earth-aoe","starter-buki-earth-5","starter-buki-earth-6","starter-buki-earth-2","starter-buki-earth-1","starter-buki-earth-4","starter-any-earth-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-jiro-nuke","cinderhold-jiro-rend","cinderhold-jiro-strike","cinderhold-jiro-trance","starter-universal-flicker","starter-buki-earth-aoe","starter-buki-earth-5","starter-buki-earth-6","starter-buki-fire-2","starter-buki-earth-1","starter-buki-earth-4","starter-buki-fire-4"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-jiro-nuke","level":1,"xp":0},{"jutsuId":"cinderhold-jiro-rend","level":1,"xp":0},{"jutsuId":"cinderhold-jiro-strike","level":1,"xp":0},{"jutsuId":"cinderhold-jiro-trance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-buki-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-buki-earth-5","level":1,"xp":0},{"jutsuId":"starter-buki-earth-6","level":1,"xp":0},{"jutsuId":"starter-buki-earth-2","level":1,"xp":0},{"jutsuId":"starter-buki-earth-1","level":1,"xp":0},{"jutsuId":"starter-buki-earth-4","level":1,"xp":0},{"jutsuId":"starter-any-earth-1","level":1,"xp":0},{"jutsuId":"starter-buki-fire-2","level":1,"xp":0},{"jutsuId":"starter-buki-fire-4","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rustfang-kunai","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rustfang-kunai","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"ashen-leaf-saber","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"ashen-leaf-saber","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"ashglass-katana","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"tempest-fang-blade","head":"legendary-crown","body":"legendary-chest","waist":"legendary-waist","legs":"legendary-legs","feet":"legendary-feet"}},
        ],
        pets: [
            {"templateId":"standard-46","species":"Moss Hedgehog","rarity":"standard","nickname":"Smokedancer","signature":true,"instanceId":"standard-46:npc-jiro-1","trait":"Aggressive"},
            {"templateId":"standard-29","species":"Magma Pup","rarity":"standard","nickname":"Smolderwhisker","signature":false,"instanceId":"standard-29:npc-jiro-2","trait":"Battleborn"},
            {"templateId":"standard-25","species":"Flint Jackal","rarity":"standard","nickname":"Embersong","signature":false,"instanceId":"standard-25:npc-jiro-3","trait":"Aggressive"},
            {"templateId":"standard-9","species":"Wild Boar","rarity":"standard","nickname":"Chardancer","signature":false,"instanceId":"standard-9:npc-jiro-4","trait":"Battleborn"},
        ],
        deck: { name: "Strike Anywhere", cards: ["tc-08","tc-130","tc-130","tc-130","tc-24","tc-24","tc-26","tc-26","tc-51","tc-51","tc-51","tc-12","tc-12","tc-12","tc-121","tc-121","tc-03","tc-68","tc-68","tc-68","tc-30","tc-30","tc-30","chronicle-field-desert","chronicle-field-desert","chronicle-hall-of-mirrors","chronicle-medical-salve","chronicle-recon-scroll","chronicle-sealbreak-verdict","chronicle-stormforged-senbon","chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-counter-script-cache","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-pitfall-tag-array","chronicle-pitfall-tag-array","chronicle-sealing-circle","chronicle-smoke-bomb"] },
        collection: ["chronicle-chakra-jammer","chronicle-chakra-jammer","chronicle-counter-script-cache","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-desert","chronicle-field-desert","chronicle-guard-stance","chronicle-guard-stance","chronicle-hall-of-mirrors","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stormforged-senbon","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-12","tc-12","tc-12","tc-121","tc-121","tc-130","tc-130","tc-130","tc-15","tc-19","tc-21","tc-23","tc-24","tc-24","tc-26","tc-26","tc-30","tc-30","tc-30","tc-31","tc-36","tc-38","tc-51","tc-51","tc-51","tc-54","tc-67","tc-68","tc-68","tc-68","tc-70"],
    },
    {
        id: "daigo",
        name: "Daigo",
        rank: "genin",
        personality: "guardian",
        avatar: "/npc-portraits/daigo.avif",
        specialty: "Taijutsu",
        elements: ["Lightning","Earth"],
        stats: {"strength":1,"speed":0.89,"intelligence":0.34,"willpower":0.38,"bukijutsuOffense":0.19,"bukijutsuDefense":0.81,"taijutsuOffense":1,"taijutsuDefense":0.85,"genjutsuOffense":0.13,"genjutsuDefense":0.88,"ninjutsuOffense":0.2,"ninjutsuDefense":0.9},
        bloodline: { ...{"id":"cinderhold-daigo-bloodline","name":"Charcoal Guard","rank":"B Rank","specialElement":"Charcoal","weatherElement":"Lightning","lore":"Charcoal Guard chakra smolders under the skin like a banked fire. It burns low and lasts through the longest siege.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-daigo-bulwark","name":"Charcoal Aegis","type":"Taijutsu","element":"Charcoal","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Shield","percent":0}],"battleDescription":"A Charcoal shell closes around %user before the blow lands.","description":"A Charcoal shell closes around %user before the blow lands.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-daigo-bind","name":"Charcoal Bind","type":"Taijutsu","element":"Charcoal","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Charcoal chains lock %target where they stand.","description":"Charcoal chains lock %target where they stand.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-daigo-riposte","name":"Charcoal Counter","type":"Taijutsu","element":"Charcoal","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Reflect","percent":30},{"name":"Wound","percent":30}],"battleDescription":"%user turns the force of %target back on them with a Charcoal counter.","description":"%user turns the force of %target back on them with a Charcoal counter.","isUtility":false,"weatherElement":"Lightning"},
            {"id":"cinderhold-daigo-stance","name":"Charcoal Stance","type":"Any","element":"Charcoal","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Decrease Damage Taken","percent":25}],"battleDescription":"%user plants their feet as Charcoal hardens over their skin.","description":"%user plants their feet as Charcoal hardens over their skin.","isUtility":true,"weatherElement":"Lightning"},
        ] },
        equippedJutsuIds: ["cinderhold-daigo-bulwark","cinderhold-daigo-bind","cinderhold-daigo-riposte","cinderhold-daigo-stance","starter-universal-flicker","starter-tai-lightning-aoe","starter-tai-lightning-2","starter-tai-lightning-6","starter-tai-earth-aoe","starter-tai-lightning-4","starter-tai-lightning-3","starter-tai-earth-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-daigo-bulwark","cinderhold-daigo-bind","cinderhold-daigo-riposte","cinderhold-daigo-stance","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-daigo-bulwark","cinderhold-daigo-bind","cinderhold-daigo-riposte","cinderhold-daigo-stance","starter-universal-flicker","starter-tai-lightning-aoe","starter-tai-lightning-2","starter-tai-lightning-6","starter-tai-lightning-5","starter-tai-lightning-4","starter-tai-lightning-3","starter-tai-lightning-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-daigo-bulwark","cinderhold-daigo-bind","cinderhold-daigo-riposte","cinderhold-daigo-stance","starter-universal-flicker","starter-tai-lightning-aoe","starter-tai-lightning-2","starter-tai-lightning-6","starter-tai-earth-aoe","starter-tai-lightning-4","starter-tai-lightning-3","starter-tai-earth-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-daigo-bulwark","level":1,"xp":0},{"jutsuId":"cinderhold-daigo-bind","level":1,"xp":0},{"jutsuId":"cinderhold-daigo-riposte","level":1,"xp":0},{"jutsuId":"cinderhold-daigo-stance","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-2","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-6","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-5","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-4","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-3","level":1,"xp":0},{"jutsuId":"starter-tai-lightning-1","level":1,"xp":0},{"jutsuId":"starter-tai-earth-aoe","level":1,"xp":0},{"jutsuId":"starter-tai-earth-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"training-katana","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"training-katana","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"riverbone-spear","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"riverbone-spear","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"spirit-leech-wakizashi","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"frostfang-oathblade","head":"bulwark-crown","body":"bulwark-chest","waist":"bulwark-waist","legs":"bulwark-legs","feet":"bulwark-feet"}},
        ],
        pets: [
            {"templateId":"standard-44","species":"Zap Quail","rarity":"standard","nickname":"Smoldersong","signature":true,"instanceId":"standard-44:npc-daigo-1","trait":"Loyal"},
            {"templateId":"standard-40","species":"Spark Shrew","rarity":"standard","nickname":"Sootear","signature":false,"instanceId":"standard-40:npc-daigo-2","trait":"Loyal"},
            {"templateId":"standard-42","species":"Arc Vole","rarity":"standard","nickname":"Emberflick","signature":false,"instanceId":"standard-42:npc-daigo-3","trait":"Loyal"},
            {"templateId":"standard-49","species":"Loam Marmot","rarity":"standard","nickname":"Blazewhisker","signature":false,"instanceId":"standard-49:npc-daigo-4","trait":"Loyal"},
        ],
        deck: { name: "Banked Coals", cards: ["tc-11","tc-51","tc-51","tc-51","tc-81","tc-81","tc-81","tc-113","tc-113","tc-113","tc-52","tc-52","tc-72","tc-72","tc-87","tc-87","tc-63","tc-88","tc-88","tc-88","tc-04","tc-04","tc-106","tc-106","chronicle-defiant-rampart","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-foxfire-feint","chronicle-foxfire-feint","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-revival-scroll","chronicle-explosive-tag","chronicle-long-watch","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier"] },
        collection: ["chronicle-defiant-rampart","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-lightning-storm","chronicle-field-lightning-storm","chronicle-foxfire-feint","chronicle-foxfire-feint","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-long-watch","chronicle-medical-salve","chronicle-medical-salve","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-stone-clone-barrier","chronicle-stone-clone-barrier","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-106","tc-106","tc-11","tc-113","tc-113","tc-113","tc-15","tc-19","tc-21","tc-23","tc-31","tc-36","tc-38","tc-51","tc-51","tc-51","tc-52","tc-52","tc-54","tc-63","tc-67","tc-70","tc-72","tc-72","tc-81","tc-81","tc-81","tc-87","tc-87","tc-88","tc-88","tc-88"],
    },
    {
        id: "isamu",
        name: "Isamu",
        rank: "genin",
        personality: "medic",
        avatar: "/npc-portraits/isamu.avif",
        specialty: "Ninjutsu",
        elements: ["Wind","Water"],
        stats: {"strength":0.4,"speed":0.92,"intelligence":0.36,"willpower":1,"bukijutsuOffense":0.17,"bukijutsuDefense":0.68,"taijutsuOffense":0.15,"taijutsuDefense":0.65,"genjutsuOffense":0.12,"genjutsuDefense":0.71,"ninjutsuOffense":1,"ninjutsuDefense":0.69},
        bloodline: { ...{"id":"cinderhold-isamu-bloodline","name":"Ember Breath","rank":"B Rank","specialElement":"Warmwind","weatherElement":"Wind","lore":"Ember Breath carries warm air into tired lungs and stiff limbs. Its users are the first sent to a fallen comrade.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-isamu-mend","name":"Warmwind Mending","type":"Any","element":"Warmwind","ap":40,"range":0,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"SELF","method":"SINGLE","tags":[{"name":"Heal","percent":0},{"name":"Increase Heal","percent":30}],"battleDescription":"Warmwind warmth closes the wounds of %user.","description":"Warmwind warmth closes the wounds of %user.","isUtility":true,"weatherElement":"Wind"},
            {"id":"cinderhold-isamu-leech","name":"Warmwind Draw","type":"Ninjutsu","element":"Warmwind","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Drain","percent":0},{"name":"Decrease Damage Given","percent":25}],"battleDescription":"Warmwind threads pull life out of %target.","description":"Warmwind threads pull life out of %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-isamu-vamp","name":"Warmwind Thirst","type":"Ninjutsu","element":"Warmwind","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lifesteal","percent":30},{"name":"Wound","percent":25}],"battleDescription":"A Warmwind strike feeds %user on the strength of %target.","description":"A Warmwind strike feeds %user on the strength of %target.","isUtility":false,"weatherElement":"Wind"},
            {"id":"cinderhold-isamu-toxin","name":"Warmwind Fumes","type":"Ninjutsu","element":"Warmwind","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Poison","percent":25},{"name":"Increase Damage Taken","percent":25}],"battleDescription":"Warmwind fumes seep into the chakra of %target.","description":"Warmwind fumes seep into the chakra of %target.","isUtility":false,"weatherElement":"Wind"},
        ] },
        equippedJutsuIds: ["cinderhold-isamu-mend","cinderhold-isamu-leech","cinderhold-isamu-vamp","cinderhold-isamu-toxin","starter-universal-flicker","starter-nin-wind-6","starter-nin-wind-aoe","starter-nin-wind-5","starter-nin-water-2","starter-nin-wind-4","starter-nin-wind-1","starter-nin-water-3"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-isamu-mend","cinderhold-isamu-leech","cinderhold-isamu-vamp","cinderhold-isamu-toxin","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-isamu-mend","cinderhold-isamu-leech","cinderhold-isamu-vamp","cinderhold-isamu-toxin","starter-universal-flicker","starter-nin-wind-6","starter-nin-wind-aoe","starter-nin-wind-5","starter-nin-wind-2","starter-nin-wind-4","starter-nin-wind-1","starter-any-wind-1"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-isamu-mend","cinderhold-isamu-leech","cinderhold-isamu-vamp","cinderhold-isamu-toxin","starter-universal-flicker","starter-nin-wind-6","starter-nin-wind-aoe","starter-nin-wind-5","starter-nin-water-2","starter-nin-wind-4","starter-nin-wind-1","starter-nin-water-3"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-isamu-mend","level":1,"xp":0},{"jutsuId":"cinderhold-isamu-leech","level":1,"xp":0},{"jutsuId":"cinderhold-isamu-vamp","level":1,"xp":0},{"jutsuId":"cinderhold-isamu-toxin","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-nin-wind-6","level":1,"xp":0},{"jutsuId":"starter-nin-wind-aoe","level":1,"xp":0},{"jutsuId":"starter-nin-wind-5","level":1,"xp":0},{"jutsuId":"starter-nin-wind-2","level":1,"xp":0},{"jutsuId":"starter-nin-wind-4","level":1,"xp":0},{"jutsuId":"starter-nin-wind-1","level":1,"xp":0},{"jutsuId":"starter-any-wind-1","level":1,"xp":0},{"jutsuId":"starter-nin-water-2","level":1,"xp":0},{"jutsuId":"starter-nin-water-3","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"rookie-chain-sickle","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"rookie-chain-sickle","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"blue-thread-dagger","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"blue-thread-dagger","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"frostbite-cleaver","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"elderbranch-katana","head":"crimson-crown","body":"crimson-chest","waist":"crimson-waist","legs":"crimson-legs","feet":"crimson-feet"}},
        ],
        pets: [
            {"templateId":"standard-3","species":"Forest Hawk","rarity":"standard","nickname":"Embertuft","signature":true,"instanceId":"standard-3:npc-isamu-1","trait":"Loyal"},
            {"templateId":"standard-10","species":"Pine Owl","rarity":"standard","nickname":"Pyrefang","signature":false,"instanceId":"standard-10:npc-isamu-2","trait":"Lucky"},
            {"templateId":"standard-12","species":"Mist Ferret","rarity":"standard","nickname":"Slagfang","signature":false,"instanceId":"standard-12:npc-isamu-3","trait":"Lucky"},
            {"templateId":"standard-39","species":"Glide Sparrow","rarity":"standard","nickname":"Hazeflick","signature":false,"instanceId":"standard-39:npc-isamu-4","trait":"Loyal"},
        ],
        deck: { name: "Gentle Updraft", cards: ["tc-06","tc-06","tc-06","tc-36","tc-36","tc-36","tc-10","tc-10","tc-10","tc-17","tc-17","tc-17","tc-57","tc-57","tc-57","tc-85","tc-18","tc-18","tc-23","tc-63","tc-20","tc-20","chronicle-field-sky","chronicle-grave-lantern-rite","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-medical-salve","chronicle-medical-salve","chronicle-medical-salve","chronicle-recall-seal","chronicle-recall-seal","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-saints-edge","chronicle-saints-edge","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-smoke-bomb"] },
        collection: ["chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-sky","chronicle-grave-lantern-rite","chronicle-guard-stance","chronicle-guard-stance","chronicle-healers-reserve","chronicle-healers-reserve","chronicle-medical-salve","chronicle-medical-salve","chronicle-medical-salve","chronicle-recall-seal","chronicle-recall-seal","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-revival-scroll","chronicle-saints-edge","chronicle-saints-edge","chronicle-sealing-circle","chronicle-second-wind-recall","chronicle-second-wind-recall","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-substitution-log","chronicle-substitution-log","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-06","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-10","tc-10","tc-10","tc-11","tc-15","tc-17","tc-17","tc-17","tc-18","tc-18","tc-19","tc-20","tc-20","tc-21","tc-23","tc-31","tc-36","tc-36","tc-36","tc-38","tc-54","tc-57","tc-57","tc-57","tc-63","tc-67","tc-70","tc-85"],
    },
    {
        id: "lumen",
        name: "Lumen",
        rank: "genin",
        personality: "trickster",
        avatar: "/npc-portraits/lumen.avif",
        specialty: "Genjutsu",
        elements: ["Water","Lightning"],
        stats: {"strength":0.31,"speed":0.37,"intelligence":1,"willpower":0.94,"bukijutsuOffense":0.2,"bukijutsuDefense":0.64,"taijutsuOffense":0.13,"taijutsuDefense":0.59,"genjutsuOffense":1,"genjutsuDefense":0.62,"ninjutsuOffense":0.17,"ninjutsuDefense":0.58},
        bloodline: { ...{"id":"cinderhold-lumen-bloodline","name":"Marsh Lantern","rank":"B Rank","specialElement":"Marshlight","weatherElement":"Water","lore":"Marsh Lantern lights float over the wet ground at the foot of the volcano. Travelers who follow them rarely find the road again.","totalPoints":7}, jutsus: [
            {"id":"cinderhold-lumen-lock","name":"Marshlight Stillness","type":"Genjutsu","element":"Marshlight","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Lag","percent":0}],"battleDescription":"Marshlight sparks freeze %target in place.","description":"Marshlight sparks freeze %target in place.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-lumen-shove","name":"Marshlight Gust","type":"Genjutsu","element":"Marshlight","ap":60,"range":5,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Pull","percent":0},{"name":"Poison","percent":25}],"battleDescription":"A Marshlight gust throws %target across the field.","description":"A Marshlight gust throws %target across the field.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-lumen-hex","name":"Marshlight Curse","type":"Genjutsu","element":"Marshlight","ap":60,"range":4,"effectPower":40,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":25}],"battleDescription":"A Marshlight hex weakens %target.","description":"A Marshlight hex weakens %target.","isUtility":false,"weatherElement":"Water"},
            {"id":"cinderhold-lumen-fog","name":"Marshlight Fog","type":"Any","element":"Marshlight","ap":40,"range":4,"effectPower":0,"cooldown":7,"currentCooldown":0,"chakraCost":100,"staminaCost":100,"healthCost":0,"chakraCostReducePerLvl":0,"staminaCostReducePerLvl":0,"healthCostReducePerLvl":0,"target":"OPPONENT","method":"SINGLE","tags":[{"name":"Decrease Damage Given","percent":30},{"name":"Increase Damage Taken","percent":30}],"battleDescription":"Marshlight fog clouds the senses of %target.","description":"Marshlight fog clouds the senses of %target.","isUtility":true,"weatherElement":"Water"},
        ] },
        equippedJutsuIds: ["cinderhold-lumen-lock","cinderhold-lumen-shove","cinderhold-lumen-hex","cinderhold-lumen-fog","starter-universal-flicker","starter-gen-water-6","starter-gen-water-5","starter-gen-water-aoe","starter-gen-lightning-2","starter-any-water-1","starter-gen-water-4","starter-gen-lightning-1"],
        jutsuBands: [
            {"minLevel":1,"equippedJutsuIds":["cinderhold-lumen-lock","cinderhold-lumen-shove","cinderhold-lumen-hex","cinderhold-lumen-fog","starter-universal-flicker"]},
            {"minLevel":2,"equippedJutsuIds":["cinderhold-lumen-lock","cinderhold-lumen-shove","cinderhold-lumen-hex","cinderhold-lumen-fog","starter-universal-flicker","starter-gen-water-6","starter-gen-water-5","starter-gen-water-aoe","starter-gen-water-2","starter-any-water-1","starter-gen-water-4","starter-gen-water-3"]},
            {"minLevel":20,"equippedJutsuIds":["cinderhold-lumen-lock","cinderhold-lumen-shove","cinderhold-lumen-hex","cinderhold-lumen-fog","starter-universal-flicker","starter-gen-water-6","starter-gen-water-5","starter-gen-water-aoe","starter-gen-lightning-2","starter-any-water-1","starter-gen-water-4","starter-gen-lightning-1"]},
        ],
        jutsuMastery: [{"jutsuId":"cinderhold-lumen-lock","level":1,"xp":0},{"jutsuId":"cinderhold-lumen-shove","level":1,"xp":0},{"jutsuId":"cinderhold-lumen-hex","level":1,"xp":0},{"jutsuId":"cinderhold-lumen-fog","level":1,"xp":0},{"jutsuId":"starter-universal-flicker","level":1,"xp":0},{"jutsuId":"starter-gen-water-6","level":1,"xp":0},{"jutsuId":"starter-gen-water-5","level":1,"xp":0},{"jutsuId":"starter-gen-water-aoe","level":1,"xp":0},{"jutsuId":"starter-gen-water-2","level":1,"xp":0},{"jutsuId":"starter-any-water-1","level":1,"xp":0},{"jutsuId":"starter-gen-water-4","level":1,"xp":0},{"jutsuId":"starter-gen-water-3","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-2","level":1,"xp":0},{"jutsuId":"starter-gen-lightning-1","level":1,"xp":0}],
        gearBands: [
            {"minLevel":1,"equipment":{"hand":"ash-wrapped-tanto","head":"cloth-hood","body":"cloth-robe","waist":"cloth-sash","legs":"cloth-pants","feet":"cloth-sandals"}},
            {"minLevel":5,"equipment":{"hand":"ash-wrapped-tanto","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":10,"equipment":{"hand":"iron-fang-knuckles","head":"leather-headband","body":"reinforced-vest","waist":"leather-belt","legs":"padded-leggings","feet":"shinobi-boots"}},
            {"minLevel":20,"equipment":{"hand":"iron-fang-knuckles","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":25,"equipment":{"hand":"moonshadow-needleblade","head":"iron-kabuto","body":"rare-chest-plate","waist":"chain-obi","legs":"rare-greaves","feet":"rare-tabi"}},
            {"minLevel":40,"equipment":{"hand":"black-lotus-dagger","head":"mirror-crown","body":"mirror-chest","waist":"mirror-waist","legs":"mirror-legs","feet":"mirror-feet"}},
        ],
        pets: [
            {"templateId":"standard-21","species":"Frost Cub","rarity":"standard","nickname":"Magmawhisker","signature":true,"instanceId":"standard-21:npc-lumen-1","trait":"Swift"},
            {"templateId":"standard-34","species":"Marsh Eel","rarity":"standard","nickname":"Magmatail","signature":false,"instanceId":"standard-34:npc-lumen-2","trait":"Swift"},
            {"templateId":"standard-13","species":"Iron Beetle","rarity":"standard","nickname":"Smokedrift","signature":false,"instanceId":"standard-13:npc-lumen-3","trait":"Lucky"},
            {"templateId":"standard-22","species":"Temple Gecko","rarity":"standard","nickname":"Cinderscale","signature":false,"instanceId":"standard-22:npc-lumen-4","trait":"Swift"},
        ],
        deck: { name: "Marsh Glow", cards: ["tc-66","tc-66","tc-86","tc-86","tc-86","tc-62","tc-62","tc-62","tc-82","tc-82","tc-82","tc-98","tc-98","tc-98","tc-23","tc-23","tc-23","tc-53","tc-34","tc-34","tc-34","chronicle-field-ocean","chronicle-field-ocean","chronicle-sealbreak-verdict","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-whirlwind-dismissal","chronicle-whirlwind-dismissal","chronicle-drowned-formula","chronicle-gatekeepers-rebuke","chronicle-pitfall-tag-array","chronicle-sealing-circle","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-log","chronicle-undertow-gate","chronicle-widespread-kunai-line"] },
        collection: ["chronicle-drowned-formula","chronicle-explosive-tag","chronicle-explosive-tag","chronicle-field-ocean","chronicle-field-ocean","chronicle-gatekeepers-rebuke","chronicle-guard-stance","chronicle-guard-stance","chronicle-medical-salve","chronicle-medical-salve","chronicle-pitfall-tag-array","chronicle-recon-scroll","chronicle-recon-scroll","chronicle-sealbreak-verdict","chronicle-sealing-circle","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-smoke-bomb","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-soldier-pill","chronicle-still-water-rebuttal","chronicle-still-water-rebuttal","chronicle-substitution-log","chronicle-substitution-log","chronicle-substitution-log","chronicle-undertow-gate","chronicle-whirlwind-dismissal","chronicle-whirlwind-dismissal","chronicle-widespread-kunai-line","tc-01","tc-01","tc-02","tc-02","tc-03","tc-04","tc-05","tc-06","tc-07","tc-07","tc-08","tc-09","tc-09","tc-11","tc-15","tc-19","tc-21","tc-23","tc-23","tc-23","tc-31","tc-34","tc-34","tc-34","tc-36","tc-38","tc-53","tc-54","tc-62","tc-62","tc-62","tc-66","tc-66","tc-67","tc-70","tc-82","tc-82","tc-82","tc-86","tc-86","tc-86","tc-98","tc-98","tc-98"],
    },
]);

/** Every NPC account slug, kage first. */
export const NPC_ACCOUNT_SLUGS: readonly string[] = Object.freeze(NPC_VILLAGE_ROSTER.map((npc) => npc.id));
const NPC_SLUG_SET: ReadonlySet<string> = new Set(NPC_ACCOUNT_SLUGS);

/** True when a slug or display name belongs to a Cinderhold NPC (canonicalized like the server). */
export function isNpcAccount(slugOrName: unknown): boolean {
    if (typeof slugOrName !== 'string') return false;
    const slug = npcCanonicalSlug(slugOrName.trim());
    return slug.length > 0 && NPC_SLUG_SET.has(slug);
}

export function npcBySlug(slugOrName: unknown): NpcShinobi | undefined {
    if (typeof slugOrName !== 'string') return undefined;
    const slug = npcCanonicalSlug(slugOrName.trim());
    return NPC_VILLAGE_ROSTER.find((npc) => npc.id === slug);
}
