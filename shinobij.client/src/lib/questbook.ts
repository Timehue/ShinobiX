/*
 * Quest Book — client DISPLAY mirror of the server-sealed epic catalog
 * (api/sector/_questbook.ts owns the authoritative stages + reward; accept /
 * advance / claim are all recomputed there). Same mirror pattern as the wanderer
 * quest catalog + mercenaries. Keep QUEST_BOOK in sync with the server module.
 *
 * QUEST_BOSSES is the client-only bestiary: it maps a stage's bossId to the data
 * <WorldMap> needs to build + scale the foe AI (the server only tracks the counter,
 * not which foe — the same PvE trust model the shipped ambush/nemesis fights use).
 */
import type { AiLoadoutId } from "../types/creator-ai";

export type QuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored";

export interface QuestStage {
    key: string;
    text: string;
    metric: QuestMetric;
    count: number;
    bossId?: string;
}
export interface QuestBookEntry {
    id: string;
    title: string;
    giver: string;
    bandMin: number;
    bandMax: number;
    weight: number;
    fateShards: number;
    award: string;
    stages: QuestStage[];
}

export const QUEST_BOOK: Record<string, QuestBookEntry> = {
    "qb-bell": {
        id: "qb-bell", title: "The Bell That Doesn't Ring", giver: "Sister Yuki",
        bandMin: 20, bandMax: 45, weight: 8, fateShards: 1, award: "Bellbearer",
        stages: [
            { key: "thief",  text: "Hunt down the Ashbound raider who stole the temple bell's clapper.", metric: "totalAiKills", count: 1, bossId: "ashbound-raider" },
            { key: "carry",  text: "Carry the cursed clapper to Yuki's ruined temple — scout 4 sectors before the bell wakes.", metric: "totalTilesExplored", count: 4 },
            { key: "wraith", text: "Re-hang the clapper and put down the temple's sealed guardian, the Bell-Wraith.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail",   text: "Track Doteki's vanished caravan across three sectors — follow the worsening signs.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush",  text: "Survive the ambush at the wreck — three escalating bandit waves led by Captain Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "strings", text: "Cut the strings: defeat the genjutsu puppeteer Itoguchi who drove the captain.", metric: "totalAiKills", count: 1, bossId: "puppeteer-itoguchi" },
        ],
    },
    "qb-gauntlet": {
        id: "qb-gauntlet", title: "The Coliseum Gauntlet", giver: "Tamer Tomoe",
        bandMin: 1, bandMax: 100, weight: 9, fateShards: 1, award: "Beast-Crowned",
        stages: [
            { key: "gauntlet",   text: "Win three coliseum pet duels against Tomoe's wandering beasts.", metric: "totalPetWins", count: 3 },
            { key: "stormhound", text: "Face the finale — Raijū, the Storm-Hound — and win a pet duel.", metric: "totalPetWins", count: 1, bossId: "raiju-storm-hound" },
        ],
    },
};

export interface QuestBossSpec {
    name: string;
    icon: string;
    statBonus: number;
    loadoutId: AiLoadoutId;
    levelOffset: number;
    /** key WorldMap maps to a portrait image (reuses the wanderer art for now) */
    portraitKey: "bandit2" | "bandit3" | "boss" | "nemesis" | "beast";
    boss?: boolean;
}

export const QUEST_BOSSES: Record<string, QuestBossSpec> = {
    "ashbound-raider":     { name: "Ashbound Raider",      icon: "🔥", statBonus: 2, loadoutId: "bruiser", levelOffset: 1, portraitKey: "bandit2" },
    "bell-wraith":         { name: "The Bell-Wraith",      icon: "👻", statBonus: 6, loadoutId: "boss",    levelOffset: 2, portraitKey: "boss", boss: true },
    "bandit-captain-goro": { name: "Bandit Captain Goro",  icon: "🥷", statBonus: 3, loadoutId: "bruiser", levelOffset: 1, portraitKey: "bandit3" },
    "puppeteer-itoguchi":  { name: "Itoguchi, the Hand",   icon: "🎭", statBonus: 5, loadoutId: "boss",    levelOffset: 2, portraitKey: "nemesis", boss: true },
    "raiju-storm-hound":   { name: "Raijū, the Storm-Hound", icon: "⚡", statBonus: 4, loadoutId: "boss",  levelOffset: 2, portraitKey: "beast", boss: true },
};

export function questbookEntry(id: string | null | undefined): QuestBookEntry | null {
    if (!id || !Object.prototype.hasOwnProperty.call(QUEST_BOOK, id)) return null;
    return QUEST_BOOK[id];
}

export function questbookStage(id: string | null | undefined, stage: number): QuestStage | null {
    const entry = questbookEntry(id);
    if (!entry) return null;
    const s = Math.floor(Number(stage) || 0);
    return s >= 0 && s < entry.stages.length ? entry.stages[s] : null;
}

/** The (stable) epic a given sage offers — band-matched, deterministic from its id. */
export function epicForWanderer(wandererId: string, level: number): QuestBookEntry | null {
    const lvl = Math.floor(Number(level) || 1);
    const matching = Object.values(QUEST_BOOK).filter(q => lvl >= q.bandMin && lvl <= q.bandMax);
    if (matching.length === 0) return null;
    let h = 0;
    for (let i = 0; i < wandererId.length; i++) h = (Math.imul(h, 31) + wandererId.charCodeAt(i)) >>> 0;
    return matching[h % matching.length];
}

/** Short, honest label for a stage's counter (the foe name carries the flavor). */
export function metricLabel(metric: QuestMetric): string {
    switch (metric) {
        case "totalPetWins": return "pet duels won";
        case "cardClashWins": return "card rounds won";
        case "totalTilesExplored": return "sectors scouted";
        default: return "foes defeated";
    }
}
