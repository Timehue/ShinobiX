/*
 * Quest Book — the multi-stage "epic" sector quests (api/sector/questbook.ts).
 * Pure, testable core (no KV / auth / locks), same shape as _wanderer-quest.ts.
 *
 * Where the single wanderer bounties (_wanderer-quest.ts) are one objective →
 * one reward, an EPIC is an ordered chain of STAGES the player advances through
 * one at a time. Each stage tracks one real, server-tracked character counter
 * (foes defeated / pet duels won / card rounds won / tiles scouted); a stage
 * advances only when (current − the stage's sealed baseline) reaches its count.
 * Boss stages carry a `bossId` the client renders + scales (the bestiary lives
 * client-side; the server only knows "a foe was defeated", the same PvE trust
 * model the shipped ambush/nemesis fights already use — see
 * docs/sector-wanderers-content.md §11). The id, stage list, and final reward are
 * SEALED server-side; the save's `activeQuestbook` is a display mirror only.
 *
 * v1 is intentionally LINEAR — the branches / timers / full §12 bestiary in the
 * design doc remain design intent for a later pass. This is the engine + a first
 * three epics, built so more quests are pure data additions.
 */

export type QuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored";

export interface QuestStage {
    key: string;
    /** what the player must do this stage (player-facing) */
    text: string;
    metric: QuestMetric;
    /** delta required on `metric` since this stage's sealed baseline */
    count: number;
    /** if set, the client launches this bestiary boss as the stage's foe */
    bossId?: string;
}

export interface QuestBookEntry {
    id: string;
    title: string;
    giver: string;
    /** inclusive level band the epic rolls in */
    bandMin: number;
    bandMax: number;
    /** effort weight driving the ryo reward (NOT the raw stage count) */
    weight: number;
    /** sealed fate-shard bonus on completion (0 or 1 — epics are rare + cooldowned) */
    fateShards: number;
    /** cosmetic title granted on completion */
    award: string;
    stages: QuestStage[];
}

export const QUEST_BOOK: Record<string, QuestBookEntry> = {
    // Q1 — band ~25–40. A shinobi-duel chain with a travel beat in the middle.
    "qb-bell": {
        id: "qb-bell", title: "The Bell That Doesn't Ring", giver: "Sister Yuki",
        bandMin: 20, bandMax: 45, weight: 8, fateShards: 1, award: "Bellbearer",
        stages: [
            { key: "thief",  text: "Hunt down the Ashbound raider who stole the temple bell's clapper.", metric: "totalAiKills", count: 1, bossId: "ashbound-raider" },
            { key: "carry",  text: "Carry the cursed clapper to Yuki's ruined temple — scout 4 sectors before the bell wakes.", metric: "totalTilesExplored", count: 4 },
            { key: "wraith", text: "Re-hang the clapper and put down the temple's sealed guardian, the Bell-Wraith.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    // Q2 — band ~15–30. A low-band gateway into hard content: trail → waves → boss.
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail",  text: "Track Doteki's vanished caravan across three sectors — follow the worsening signs.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush", text: "Survive the ambush at the wreck — three escalating bandit waves led by Captain Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "strings", text: "Cut the strings: defeat the genjutsu puppeteer Itoguchi who drove the captain.", metric: "totalAiKills", count: 1, bossId: "puppeteer-itoguchi" },
        ],
    },
    // Q4 — pet-mode campaign. Scales to the player's pets; ends on a mythic boss pet.
    "qb-gauntlet": {
        id: "qb-gauntlet", title: "The Coliseum Gauntlet", giver: "Tamer Tomoe",
        bandMin: 1, bandMax: 100, weight: 9, fateShards: 1, award: "Beast-Crowned",
        stages: [
            { key: "gauntlet", text: "Win three coliseum pet duels against Tomoe's wandering beasts.", metric: "totalPetWins", count: 3 },
            { key: "stormhound", text: "Face the finale — Raijū, the Storm-Hound — and win.", metric: "totalPetWins", count: 1, bossId: "raiju-storm-hound" },
        ],
    },
};

export function isQuestBookId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(QUEST_BOOK, id);
}

export function questBookEntry(id: string): QuestBookEntry | null {
    return isQuestBookId(id) ? QUEST_BOOK[id] : null;
}

/** The stage at index `stage`, or null if out of range. */
export function questStage(id: string, stage: number): QuestStage | null {
    const entry = questBookEntry(id);
    if (!entry) return null;
    const s = Math.floor(Number(stage) || 0);
    return s >= 0 && s < entry.stages.length ? entry.stages[s] : null;
}

export function finalStageIndex(entry: QuestBookEntry): number {
    return entry.stages.length - 1;
}

/** A stage's objective is met when (current − baseline) on its metric reaches count. */
export function questStageComplete(baseline: number, current: number, count: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= (Number(count) || 0);
}

export function bandMatches(entry: QuestBookEntry, level: number): boolean {
    const lvl = Math.floor(Number(level) || 1);
    return lvl >= entry.bandMin && lvl <= entry.bandMax;
}

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

/** Conservative, level- and effort-scaled ryo for completing an epic. Tunable. */
export function questBookRyo(level: number, weight: number): number {
    const lvl = clamp(level, 1, 100);
    const w = clamp(weight, 1, 20);
    return w * (40 + lvl * 5); // L40/w8 ≈ 1,920 · L100/w9 ≈ 4,860 — an epic, not a grind bounty
}
