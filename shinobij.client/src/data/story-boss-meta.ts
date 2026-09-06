/*
 * story-boss-meta — the COMPACT per-chapter boss facts (name, icon, level,
 * scale-derived HP/damage, AI profile id) that lib/combat-ai needs at module
 * scope to build storyBossAis into the builtin roster.
 *
 * Why this exists: combat-ai is on the boot-critical entry chunk, and reading
 * the boss facts out of data/storylines.ts dragged all ~270 KB of story prose
 * into the entry graph with it. This module carries ONLY the meta (a few KB);
 * the prose stays lazy behind lib/story-trigger-loader.
 *
 * SINGLE SOURCE OF TRUTH RULES:
 *   • bossScaleByLevel and storyAiId live HERE; data/storylines.ts imports
 *     them, so HP/damage/reward scaling and AI ids can never fork.
 *   • Boss names/icons/levels are duplicated from the milestone(...) calls in
 *     data/storylines.ts by necessity. data/story-boss-meta.test.ts asserts
 *     byte-exact parity with the full story data — if you rename a boss or
 *     add/move a chapter there, update VILLAGE_BOSSES here or the suite fails.
 */

export const bossScaleByLevel: Record<number, { hp: number; damage: number; xp: number; ryo: number }> = {
    // bossScaleByLevel = the authoritative story-boss HP curve. makeStoryBossAi
    // builds EVERY story boss hpFloorExempt, so these hp values are used verbatim
    // (no aiHpForLevel floor) and form one clean ascending level→HP curve. Tuned
    // down for winnability; damage / xp / ryo unchanged.
    4:   { hp: 900,   damage: 18,  xp: 120,   ryo: 75 },
    15:  { hp: 2000,  damage: 32,  xp: 500,   ryo: 250 },
    25:  { hp: 3200,  damage: 50,  xp: 900,   ryo: 500 },
    35:  { hp: 4600,  damage: 68,  xp: 1400,  ryo: 800 },
    50:  { hp: 6500,  damage: 90,  xp: 2200,  ryo: 1300 },
    65:  { hp: 8500,  damage: 120, xp: 3400,  ryo: 2000 },
    75:  { hp: 9500,  damage: 148, xp: 4600,  ryo: 2800 },
    85:  { hp: 11000, damage: 185, xp: 6200,  ryo: 4000 },
    // Kage finale: the peer-band AI (lvl 100) hits with uncapped damage + full
    // mastery, so 24k HP made the grind unwinnable for non-maxed players. This hp
    // is now AUTHORITATIVE: makeStoryBossAi builds the finale hpFloorExempt, so the
    // value here is used verbatim (it can sit below aiHpForLevel(100) ≈ 14.7k).
    100: { hp: 13000, damage: 250, xp: 10000, ryo: 7500 },
};

export function storyAiId(village: string, level: number) {
    return `story-ai-${village.toLowerCase().replace(/\W+/g, "-")}-${level}`;
}

// Every village runs the same nine chapter levels, in order.
const CHAPTER_LEVELS = [4, 15, 25, 35, 50, 65, 75, 85, 100] as const;

// Boss roster per village, index-aligned with CHAPTER_LEVELS. Names/icons are
// mirrored from the milestone(...) calls in data/storylines.ts (parity-tested).
// Insertion order matters: storyBossAis preserves it, and the builtin AI roster
// (and any UI listing it) sees the same order as before the split.
const VILLAGE_BOSSES: Record<string, { icon: string; names: readonly string[] }> = {
    "Stormveil Village": {
        icon: "⚡",
        names: [
            "Stormveil Training Scout",
            "Tempest Guard Captain",
            "Lightning-Sealed Informant",
            "Storm Engine Warden",
            "Jonin Rank Trial: Twin Tempest Duelists",
            "Tempest Execution Squad",
            "Mira Volt, Estate Bout Rigger",
            "Hollow Tempest General",
            "Kage Raiko Veyr, Hollow Storm Tyrant",
        ],
    },
    "Ashen Leaf Village": {
        icon: "🌿",
        names: [
            "Wooden Root Guardian",
            "Rootbound Guard Initiate",
            "Archive Spirit of the Root",
            "First Flame Sentinel",
            "Jonin Trial: Rootbound Master",
            "Rootbound Retrieval Squad",
            "Ancestor-Bound Flame Beast",
            "Rootbound Elder Champion",
            "Kage Hoshina Enju, First Flame Vessel",
        ],
    },
    "Frostfang Village": {
        icon: "❄",
        names: [
            "Snow Warden Pup",
            "Oathbound Soldier",
            "Frost Seal Guardian",
            "Oathbound Ice Captain",
            "Jonin Rank Trial: Glacier Twins",
            "Oathbound Purge Unit",
            "Frostfang Oathbreaker Hunter",
            "Oathbound Alpha Guard",
            "Kage Kael Whitefang, Hollow Oath Tyrant",
        ],
    },
    "Moonshadow Village": {
        icon: "🌙",
        names: [
            "Hidden Blade Trainee",
            "Veiled Hand Collector",
            "Masked Auction Enforcer",
            "Contract-Bound Shadow",
            "Jonin Trial: Mirror Assassin",
            "Veiled Hand Executioner",
            "Shadow Network Hunter",
            "Veiled Hand Grandmaster",
            "Kage Sable Nocturne, Hollow Moon Sovereign",
        ],
    },
};

export interface StoryBossMeta {
    village: string;
    levelReq: number;
    bossName: string;
    bossIcon: string;
    bossHp: number;
    bossDamage: number;
    aiProfileId: string;
}

export const storyBossMeta: StoryBossMeta[] = Object.entries(VILLAGE_BOSSES).flatMap(([village, roster]) =>
    roster.names.map((bossName, index) => {
        const levelReq = CHAPTER_LEVELS[index];
        const scale = bossScaleByLevel[levelReq];
        return {
            village,
            levelReq,
            bossName,
            bossIcon: roster.icon,
            bossHp: scale.hp,
            bossDamage: scale.damage,
            aiProfileId: storyAiId(village, levelReq),
        };
    }),
);
