"use strict";
/*
 * Quest Book — the multi-stage "epic" sector quests (api/sector/questbook.ts).
 * Pure, testable core (no KV / auth / locks), same shape as _wanderer-quest.ts.
 *
 * Where the single wanderer bounties (_wanderer-quest.ts) are one objective →
 * one reward, an EPIC is an ordered chain of STAGES the player advances through
 * one at a time. A stage is one of:
 *   - a COUNTER stage: tracks one real character counter (foes defeated / pet duels
 *     won / card rounds won / tiles scouted) and advances when (current − the stage's
 *     sealed baseline) reaches its count. May carry a `bossId` the client renders.
 *   - a CHOICE stage (a BRANCH): the player picks one option; the choice is sealed
 *     and its effects (bonus ryo %, fate shards, a mutually-exclusive title, a later
 *     boss's difficulty, a world-standing flag) apply server-side at claim.
 * A stage may also be TIMED: a real-time deadline is sealed when the stage becomes
 * active, and it must be cleared before the clock runs out or the stage resets.
 *
 * The id, stage list, choice effects, and final reward are SEALED server-side; the
 * save's `activeQuestbook` is a display mirror only (the server never trusts it).
 * The bestiary (boss stats/art) lives client-side; the server only knows "a foe was
 * defeated", the same PvE trust model the shipped ambush/nemesis fights use.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEST_BOOK = void 0;
exports.isQuestBookId = isQuestBookId;
exports.questBookEntry = questBookEntry;
exports.questStage = questStage;
exports.finalStageIndex = finalStageIndex;
exports.questStageComplete = questStageComplete;
exports.stageIsChoice = stageIsChoice;
exports.choiceOption = choiceOption;
exports.stageTimerMs = stageTimerMs;
exports.timerResetStage = timerResetStage;
exports.bandMatches = bandMatches;
exports.questBookRyo = questBookRyo;
exports.aggregateChoiceEffects = aggregateChoiceEffects;
exports.QUEST_BOOK = {
    // Q1 — band ~20–45. Boss → BRANCH → TIMED carry → (boss difficulty set by the branch).
    "qb-bell": {
        id: "qb-bell", title: "The Bell That Doesn't Ring", giver: "Sister Yuki",
        bandMin: 20, bandMax: 45, weight: 8, fateShards: 1, award: "Bellbearer",
        stages: [
            { key: "thief", text: "Hunt down the Ashbound raider who stole the temple bell's clapper.", metric: "totalAiKills", count: 1, bossId: "ashbound-raider" },
            { key: "curse", text: "The clapper is cursed — the moment you lift it, it wants to ring. How will you carry it?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“Whatever you do — do not let it finish the sound. A bell that rings once will ring forever.”", options: [
                        { key: "raw", label: "Carry it raw", blurb: "Faster, but the Bell-Wraith wakes ENRAGED. A harder finish — and a bonus fate shard for the nerve.", bossStatBonus: 4, bonusFateShards: 1, standing: "bell-raw" },
                        { key: "cleanse", label: "Cleanse it first", blurb: "Spend the time to still the curse. The guardian wakes weaker. Base reward.", standing: "bell-cleansed" },
                    ] } },
            { key: "carry", text: "Carry the clapper to Yuki's ruined temple — scout 4 sectors before the bell finishes its sound.", metric: "totalTilesExplored", count: 4,
                timer: { durationMs: 30 * 60 * 1000, failResetToStage: 2 } },
            { key: "wraith", text: "Re-hang the clapper and put down the temple's sealed guardian, the Bell-Wraith.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    // Q2 — band ~12–35. Trail → waves(boss) → BRANCH (spare/execute) → boss.
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail", text: "Track Doteki's vanished caravan across three sectors — follow the worsening signs.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush", text: "Survive the ambush at the wreck — three escalating bandit waves led by Captain Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "judgment", text: "Goro kneels, broken — and you realize he fought like a puppet on strings. What now?", metric: "totalAiKills", count: 0,
                choice: { prompt: "Goro was driven against his will. His fate is yours to decide.", options: [
                        { key: "spare", label: "Spare Goro", blurb: "He was a puppet. He'll remember the mercy and walk your roads as a friend. (+standing)", standing: "goro-spared" },
                        { key: "execute", label: "Execute Goro", blurb: "Justice — and a heavier purse, taken now. The wilds grow colder toward you. (−standing)", bonusRyoPct: 50, standing: "goro-executed" },
                    ] } },
            { key: "strings", text: "Cut the strings: defeat the genjutsu puppeteer Itoguchi who drove the captain.", metric: "totalAiKills", count: 1, bossId: "puppeteer-itoguchi" },
        ],
    },
    // Q3 — band ~40–65, WAR-GATED. A heavy moral branch with two mutually-exclusive
    // titles, then an elite assassin. Only offered while your village is at war.
    "qb-defector": {
        id: "qb-defector", title: "The Frostfang Defector", giver: "The Defector",
        bandMin: 40, bandMax: 65, weight: 9, fateShards: 1, award: "Frostfang Survivor", requiresWar: true,
        stages: [
            { key: "offer", text: "A defector from the enemy village offers war-turning intel — for safe passage. What do you do?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“Get me out and the war is yours. Or turn me in for your Kage's coin. Choose — they're already hunting me.”", options: [
                        { key: "trust", label: "Trust the defector", blurb: "Escort them out. Their intel feeds your village's war effort. Earns the title Border-Walker.", title: "Border-Walker", standing: "defector-trusted" },
                        { key: "turnin", label: "Turn them in", blurb: "A bounty from your Kage — and the enmity of every sympathizer. +ryo, the title Kage's Blade.", title: "Kage's Blade", bonusRyoPct: 40, standing: "defector-turned" },
                    ] } },
            { key: "silencer", text: "Either way, an elite Hunter-Nin — Shirakawa — is sent to erase the defector, and now you. End them.", metric: "totalAiKills", count: 1, bossId: "hunter-shirakawa" },
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
    // Q5 — band any, MEDIUM. Card-flavored but cheat-safe: the real reward hangs on a
    // verifiable bodyguard duel, not the (unprovable) card games.
    "qb-debt": {
        id: "qb-debt", title: "The Gambler's Debt", giver: "Saji Two-Coins",
        bandMin: 1, bandMax: 100, weight: 5, fateShards: 0, award: "House Breaker",
        stages: [
            { key: "table", text: "Saji owes 'The House'. Buy him time — win two rounds of Shinobi Card Clash against the patron's enforcers.", metric: "cardClashWins", count: 2 },
            { key: "collection", text: "The House calls the debt anyway and sends its bodyguard, Kuroban, to collect it from Saji's hide — and yours.", metric: "totalAiKills", count: 1, bossId: "house-kuroban" },
        ],
    },
    // Q6 — CAPSTONE, rivalry-gated, VERY HARD. The nemesis arc delivered as a quest;
    // claiming it ends the rivalry for good.
    "qb-ashes": {
        id: "qb-ashes", title: "Ashes of the Ashbound", giver: "Old Hermit Roku",
        bandMin: 50, bandMax: 100, weight: 12, fateShards: 1, award: "Ash-Ender",
        requiresRivalry: true, clearsRivalry: true,
        stages: [
            { key: "cinder", text: "Burn down Kazan's promoted lieutenant Cinder, a glass-cannon firebrand, in a volcano sector.", metric: "totalAiKills", count: 1, bossId: "ashbound-cinder" },
            { key: "slag", text: "Break Slag, the stone wall who guards the lair road.", metric: "totalAiKills", count: 1, bossId: "ashbound-slag" },
            { key: "kazan", text: "End it. Kazan the Ashbound, in his promoted form, waits in the lair. Settle the rivalry for good.", metric: "totalAiKills", count: 1, bossId: "kazan-ashbound" },
        ],
    },
};
function isQuestBookId(id) {
    return Object.prototype.hasOwnProperty.call(exports.QUEST_BOOK, id);
}
function questBookEntry(id) {
    return isQuestBookId(id) ? exports.QUEST_BOOK[id] : null;
}
/** The stage at index `stage`, or null if out of range. */
function questStage(id, stage) {
    const entry = questBookEntry(id);
    if (!entry)
        return null;
    const s = Math.floor(Number(stage) || 0);
    return s >= 0 && s < entry.stages.length ? entry.stages[s] : null;
}
function finalStageIndex(entry) {
    return entry.stages.length - 1;
}
/** A counter stage's objective is met when (current − baseline) reaches count. */
function questStageComplete(baseline, current, count) {
    return (Number(current) || 0) - (Number(baseline) || 0) >= (Number(count) || 0);
}
/** A branch stage — the player must pick an option to advance. */
function stageIsChoice(stage) {
    return !!stage?.choice && Array.isArray(stage.choice.options) && stage.choice.options.length > 0;
}
function choiceOption(stage, optionKey) {
    if (!stageIsChoice(stage))
        return null;
    return stage.choice.options.find(o => o.key === optionKey) ?? null;
}
/** Milliseconds a timed stage allows, or 0 if the stage is untimed. */
function stageTimerMs(stage) {
    return Math.max(0, Math.floor(Number(stage?.timer?.durationMs) || 0));
}
/** Where a failed timer resets to (defaults to the timed stage itself). */
function timerResetStage(entry, stageIdx) {
    const stage = entry.stages[stageIdx];
    const to = stage?.timer?.failResetToStage;
    if (typeof to === "number" && to >= 0 && to < entry.stages.length)
        return Math.floor(to);
    return stageIdx;
}
function bandMatches(entry, level) {
    const lvl = Math.floor(Number(level) || 1);
    return lvl >= entry.bandMin && lvl <= entry.bandMax;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));
/** Base, level- and effort-scaled ryo for completing an epic (before choice bonuses). */
function questBookRyo(level, weight) {
    const lvl = clamp(level, 1, 100);
    const w = clamp(weight, 1, 20);
    return w * (40 + lvl * 5); // L40/w8 ≈ 1,920 · L100/w9 ≈ 4,860 — an epic, not a grind bounty
}
/** Aggregate the sealed branch choices into the final-reward modifiers. */
function aggregateChoiceEffects(entry, choices) {
    let ryoMult = 1;
    let bonusFateShards = 0;
    let titleOverride = null;
    const standings = [];
    const made = choices ?? {};
    for (const stage of entry.stages) {
        if (!stageIsChoice(stage))
            continue;
        const opt = choiceOption(stage, String(made[stage.key] ?? ""));
        if (!opt)
            continue;
        if (opt.bonusRyoPct)
            ryoMult *= 1 + opt.bonusRyoPct / 100;
        if (opt.bonusFateShards)
            bonusFateShards += opt.bonusFateShards;
        if (opt.title)
            titleOverride = opt.title;
        if (opt.standing)
            standings.push(opt.standing);
    }
    return { ryoMult, bonusFateShards, titleOverride, standings };
}
