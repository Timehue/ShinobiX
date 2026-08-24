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

// Epic-questbook stages use the first four. `relicSurveyCount` is a WANDERER
// metric that reaches metricLabel() through the Missions bounty card, which
// renders whichever catalog the active quest came from — so the union has to
// cover it or a new wanderer metric fails to typecheck at the call site.
export type QuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored" | "relicSurveyCount";

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
    requiresRivalry?: boolean;
    clearsRivalry?: boolean;
    stages: QuestStage[];
}

export const QUEST_BOOK: Record<string, QuestBookEntry> = {
    "qb-bell": {
        id: "qb-bell", title: "The Bell That Doesn't Ring", giver: "Sister Yuki",
        bandMin: 20, bandMax: 45, weight: 8, fateShards: 1, award: "Bellbearer",
        stages: [
            { key: "thief",  text: "Find the Ashbound raider who stole the clapper from Yuki's ruined temple.", metric: "totalAiKills", count: 1, bossId: "ashbound-raider" },
            { key: "curse",  text: "Court-era seals on the clapper are trying to finish the temple's last alarm. How will you carry it?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“If that clapper completes one ring, the old guardian will answer. Decide how much time we can spare.”", options: [
                    { key: "raw",     label: "Wrap it and run",   blurb: "Reach the temple sooner, but face the Bell-Wraith at full strength. Yuki adds a fate shard for the risk.", bossStatBonus: 4, bonusFateShards: 1, standing: "bell-raw" },
                    { key: "cleanse", label: "Quiet the seals first", blurb: "Spend time breaking the alarm sequence. The guardian will wake weaker.", standing: "bell-cleansed" },
                ] } },
            { key: "carry",  text: "Carry the wrapped clapper across 4 sectors before it completes the old alarm.", metric: "totalTilesExplored", count: 4,
                timer: { durationMs: 30 * 60 * 1000, failResetToStage: 2 } },
            { key: "wraith", text: "Return the clapper, then stop the temple guardian that answers the broken alarm.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail",   text: "Track Doteki's missing caravan across 3 sectors. Count the wheel ruts, abandoned loads, and blood.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush",  text: "At the wreck, survive 3 bandit waves and disarm their captain, Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "judgment", text: "Goro drops his blade. Genjutsu marks behind his ears explain the empty look in his eyes. What now?", metric: "totalAiKills", count: 0,
                choice: { prompt: "Goro was forced to lead the attack, but caravan guards still died. Decide what happens to him.", options: [
                    { key: "spare",   label: "Spare Goro",   blurb: "Bind his wounds and take his testimony. He may help on the road later.", standing: "goro-spared" },
                    { key: "execute", label: "Execute Goro", blurb: "Carry out the caravan guards' sentence and collect their larger bounty. Goro's allies will remember it.", bonusRyoPct: 50, standing: "goro-executed" },
                ] } },
            { key: "strings", text: "Cut the strings: defeat the genjutsu puppeteer Itoguchi who drove the captain.", metric: "totalAiKills", count: 1, bossId: "puppeteer-itoguchi" },
        ],
    },
    "qb-defector": {
        id: "qb-defector", title: "The Frostfang Defector", giver: "The Defector",
        bandMin: 40, bandMax: 65, weight: 9, fateShards: 1, award: "Frostfang Survivor", requiresWar: true,
        stages: [
            { key: "offer", text: "A Frostfang signaler offers patrol routes and roll-call codes in exchange for safe passage. What do you do?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“Get me across the border and I will give your Kage every route I copied. Decide now. My hunters are close.”", options: [
                    { key: "trust",  label: "Trust the defector", blurb: "Escort them out. Their intel feeds your village's war effort. Earns the title Border-Walker.", title: "Border-Walker", standing: "defector-trusted" },
                    { key: "turnin", label: "Turn them in",      blurb: "Hand them to your Kage's intelligence office for a larger bounty and the title Kage's Blade.", title: "Kage's Blade", bonusRyoPct: 40, standing: "defector-turned" },
                ] } },
            { key: "silencer", text: "Frostfang Hunter-nin Shirakawa catches the trail and moves to kill the defector, then you. Stop them.", metric: "totalAiKills", count: 1, bossId: "hunter-shirakawa" },
        ],
    },
    "qb-gauntlet": {
        id: "qb-gauntlet", title: "The Colosseum Gauntlet", giver: "Tamer Tomoe",
        bandMin: 1, bandMax: 100, weight: 9, fateShards: 1, award: "Beast-Crowned",
        stages: [
            { key: "gauntlet",   text: "Win three colosseum pet duels against Tomoe's wandering beasts.", metric: "totalPetWins", count: 3 },
            { key: "stormhound", text: "Face Tomoe's final companion, Raijū the Storm-Hound, and win the pet duel.", metric: "totalPetWins", count: 1, bossId: "raiju-storm-hound" },
        ],
    },
    "qb-debt": {
        id: "qb-debt", title: "The Gambler's Debt", giver: "Saji Two-Coins",
        bandMin: 1, bandMax: 100, weight: 5, fateShards: 0, award: "House Breaker",
        stages: [
            { key: "table", text: "Saji owes the House. Buy him time by winning 2 Shinobi Chronicle Showdowns against its enforcers.", metric: "cardClashWins", count: 2 },
            { key: "collection", text: "The House calls the debt anyway. Its bodyguard, Kuroban, finds Saji's hide and decides you owe as well.", metric: "totalAiKills", count: 1, bossId: "house-kuroban" },
        ],
    },
    "qb-ashes": {
        id: "qb-ashes", title: "Ashes of the Ashbound", giver: "Old Hermit Roku",
        bandMin: 50, bandMax: 100, weight: 12, fateShards: 1, award: "Ash-Ender",
        requiresRivalry: true, clearsRivalry: true,
        stages: [
            { key: "cinder", text: "Find Cinder, Kazan's fire-style lieutenant, at the abandoned volcano watch and cut off the Ashbound scouts.", metric: "totalAiKills", count: 1, bossId: "ashbound-cinder" },
            { key: "slag",   text: "Break through Slag, the armored lieutenant holding the road into Kazan's lair.", metric: "totalAiKills", count: 1, bossId: "ashbound-slag" },
            { key: "kazan",  text: "Kazan waits in the lair with every lesson learned from your rivalry. End it.", metric: "totalAiKills", count: 1, bossId: "kazan-ashbound" },
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
    /** the capstone boss escalates with the player's wanderer-rivalry tier */
    scalesWithRivalry?: boolean;
}

export const QUEST_BOSSES: Record<string, QuestBossSpec> = {
    "ashbound-raider":     { name: "Ashbound Raider",      icon: "🔥", statBonus: 2, loadoutId: "bruiser", levelOffset: 1, portraitKey: "bandit2" },
    "bell-wraith":         { name: "The Bell-Wraith",      icon: "👻", statBonus: 6, loadoutId: "boss",    levelOffset: 2, portraitKey: "boss", boss: true },
    "bandit-captain-goro": { name: "Bandit Captain Goro",  icon: "🥷", statBonus: 3, loadoutId: "bruiser", levelOffset: 1, portraitKey: "bandit3" },
    "puppeteer-itoguchi":  { name: "Itoguchi, the Hand",   icon: "🎭", statBonus: 5, loadoutId: "boss",    levelOffset: 2, portraitKey: "nemesis", boss: true },
    "raiju-storm-hound":   { name: "Raijū, the Storm-Hound", icon: "⚡", statBonus: 4, loadoutId: "boss",  levelOffset: 2, portraitKey: "beast", boss: true },
    "hunter-shirakawa":    { name: "Hunter-Nin Shirakawa",  icon: "🥷", statBonus: 6, loadoutId: "burst", levelOffset: 2, portraitKey: "nemesis", boss: true },
    "house-kuroban":       { name: "Kuroban, the Bodyguard", icon: "🗡️", statBonus: 4, loadoutId: "bruiser",  levelOffset: 1, portraitKey: "boss", boss: true },
    "ashbound-cinder":     { name: "Cinder",                 icon: "🔥", statBonus: 3, loadoutId: "burst",    levelOffset: 0, portraitKey: "bandit2" },
    "ashbound-slag":       { name: "Slag",                   icon: "🪨", statBonus: 4, loadoutId: "defender", levelOffset: 0, portraitKey: "bandit3" },
    "kazan-ashbound":      { name: "Kazan the Ashbound",     icon: "🌋", statBonus: 8, loadoutId: "boss",     levelOffset: 3, portraitKey: "boss", boss: true, scalesWithRivalry: true },
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
export function epicForWanderer(wandererId: string, level: number, opts?: { atWar?: boolean; hasRivalry?: boolean }): QuestBookEntry | null {
    const lvl = Math.floor(Number(level) || 1);
    const atWar = !!opts?.atWar;
    const hasRivalry = !!opts?.hasRivalry;
    const matching = Object.values(QUEST_BOOK).filter(q =>
        lvl >= q.bandMin && lvl <= q.bandMax && (!q.requiresWar || atWar) && (!q.requiresRivalry || hasRivalry));
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
        case "relicSurveyCount": return "countries walked";
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

/**
 * The capstone's Kazan reflects YOUR specific rivalry: the more times your nemesis
 * has bested you on the road (wandererNemesis.tier), the harder his promoted form —
 * extra level + stat bonus, both capped so it stays very-hard, not impossible. A
 * fresh tier-1 rivalry barely bumps him; a long-running grudge makes him a wall.
 */
export function rivalryEscalation(tier: number | null | undefined): { level: number; stat: number } {
    const t = Math.max(0, Math.floor(Number(tier) || 0));
    return { level: Math.min(12, t * 2), stat: Math.min(8, t * 2) };
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
