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

export interface QuestChoiceOption {
    key: string;
    label: string;
    blurb: string;
    bonusRyoPct?: number;
    bonusFateShards?: number;
    title?: string;
    bossStatBonus?: number;
    standing?: string;
}
export interface QuestTimer {
    durationMs: number;
    failResetToStage?: number;
}
export interface QuestStage {
    key: string;
    text: string;
    metric: QuestMetric;
    count: number;
    bossId?: string;
    choice?: { prompt: string; options: QuestChoiceOption[] };
    timer?: QuestTimer;
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
    requiresWar?: boolean;
    stages: QuestStage[];
}

export const QUEST_BOOK: Record<string, QuestBookEntry> = {
    "qb-bell": {
        id: "qb-bell", title: "The Bell That Doesn't Ring", giver: "Sister Yuki",
        bandMin: 20, bandMax: 45, weight: 8, fateShards: 1, award: "Bellbearer",
        stages: [
            { key: "thief",  text: "Hunt down the Ashbound raider who stole the temple bell's clapper.", metric: "totalAiKills", count: 1, bossId: "ashbound-raider" },
            { key: "curse",  text: "The clapper is cursed — the moment you lift it, it wants to ring. How will you carry it?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“Whatever you do — do not let it finish the sound. A bell that rings once will ring forever.”", options: [
                    { key: "raw",     label: "Carry it raw",   blurb: "Faster, but the Bell-Wraith wakes ENRAGED. A harder finish — and a bonus fate shard for the nerve.", bossStatBonus: 4, bonusFateShards: 1, standing: "bell-raw" },
                    { key: "cleanse", label: "Cleanse it first", blurb: "Spend the time to still the curse. The guardian wakes weaker. Base reward.", standing: "bell-cleansed" },
                ] } },
            { key: "carry",  text: "Carry the clapper to Yuki's ruined temple — scout 4 sectors before the bell finishes its sound.", metric: "totalTilesExplored", count: 4,
                timer: { durationMs: 30 * 60 * 1000, failResetToStage: 2 } },
            { key: "wraith", text: "Re-hang the clapper and put down the temple's sealed guardian, the Bell-Wraith.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail",   text: "Track Doteki's vanished caravan across three sectors — follow the worsening signs.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush",  text: "Survive the ambush at the wreck — three escalating bandit waves led by Captain Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "judgment", text: "Goro kneels, broken — and you realize he fought like a puppet on strings. What now?", metric: "totalAiKills", count: 0,
                choice: { prompt: "Goro was driven against his will. His fate is yours to decide.", options: [
                    { key: "spare",   label: "Spare Goro",   blurb: "He was a puppet. He'll remember the mercy and walk your roads as a friend. (+standing)", standing: "goro-spared" },
                    { key: "execute", label: "Execute Goro", blurb: "Justice — and a heavier purse, taken now. The wilds grow colder toward you. (−standing)", bonusRyoPct: 50, standing: "goro-executed" },
                ] } },
            { key: "strings", text: "Cut the strings: defeat the genjutsu puppeteer Itoguchi who drove the captain.", metric: "totalAiKills", count: 1, bossId: "puppeteer-itoguchi" },
        ],
    },
    "qb-defector": {
        id: "qb-defector", title: "The Frostfang Defector", giver: "The Defector",
        bandMin: 40, bandMax: 65, weight: 9, fateShards: 1, award: "Frostfang Survivor", requiresWar: true,
        stages: [
            { key: "offer", text: "A defector from the enemy village offers war-turning intel — for safe passage. What do you do?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“Get me out and the war is yours. Or turn me in for your Kage's coin. Choose — they're already hunting me.”", options: [
                    { key: "trust",  label: "Trust the defector", blurb: "Escort them out. Their intel feeds your village's war effort. Earns the title Border-Walker.", title: "Border-Walker", standing: "defector-trusted" },
                    { key: "turnin", label: "Turn them in",      blurb: "A bounty from your Kage — and the enmity of every sympathizer. +ryo, the title Kage's Blade.", title: "Kage's Blade", bonusRyoPct: 40, standing: "defector-turned" },
                ] } },
            { key: "silencer", text: "Either way, an elite Hunter-Nin — Shirakawa — is sent to erase the defector, and now you. End them.", metric: "totalAiKills", count: 1, bossId: "hunter-shirakawa" },
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
    "hunter-shirakawa":    { name: "Hunter-Nin Shirakawa",  icon: "🥷", statBonus: 6, loadoutId: "burst", levelOffset: 2, portraitKey: "nemesis", boss: true },
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

/**
 * The (stable) epic a given sage offers — band-matched, deterministic from its id.
 * War-gated epics (requiresWar) are only offered while the player's village is at war.
 */
export function epicForWanderer(wandererId: string, level: number, opts?: { atWar?: boolean }): QuestBookEntry | null {
    const lvl = Math.floor(Number(level) || 1);
    const atWar = !!opts?.atWar;
    const matching = Object.values(QUEST_BOOK).filter(q => lvl >= q.bandMin && lvl <= q.bandMax && (!q.requiresWar || atWar));
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

/** A branch stage — the player must pick an option to advance. */
export function stageIsChoice(stage: QuestStage | null | undefined): boolean {
    return !!stage?.choice && stage.choice.options.length > 0;
}

/**
 * Extra boss difficulty earned from the sealed branch choices (e.g. carrying the
 * cursed bell raw wakes the Bell-Wraith enraged). Summed across all made choices and
 * applied client-side when the next boss is built (the bonus reward is server-sealed).
 */
export function bossStatBonusFromChoices(
    id: string | null | undefined,
    choices: Record<string, string> | null | undefined,
): number {
    const entry = questbookEntry(id);
    if (!entry || !choices) return 0;
    let bonus = 0;
    for (const stage of entry.stages) {
        if (!stage.choice) continue;
        const opt = stage.choice.options.find(o => o.key === choices[stage.key]);
        if (opt?.bossStatBonus) bonus += opt.bossStatBonus;
    }
    return bonus;
}

/** mm:ss left on a timed stage, or null if no deadline / already expired. */
export function timeLeftLabel(deadline: number | null | undefined, now: number): string | null {
    if (!deadline) return null;
    const ms = deadline - now;
    if (ms <= 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}
