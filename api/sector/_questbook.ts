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

export type QuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored";

/** One branch option. Its effects are SEALED at choice-time and applied at claim. */
export interface QuestChoiceOption {
    key: string;
    label: string;
    blurb: string;
    /** +X% to the final ryo reward */
    bonusRyoPct?: number;
    /** extra fate shards on completion */
    bonusFateShards?: number;
    /** overrides the entry's default award title (mutually-exclusive endings) */
    title?: string;
    /** added to a LATER boss stage's difficulty (client builds the boss harder) */
    bossStatBonus?: number;
    /** a persistent world-standing flag stamped on the character at claim */
    standing?: string;
}

export interface QuestTimer {
    /** real-time window to clear the stage once it becomes active */
    durationMs: number;
    /** on expiry, reset to this stage index (default: the timed stage itself) */
    failResetToStage?: number;
}

export interface QuestStage {
    key: string;
    /** what the player must do this stage (player-facing) */
    text: string;
    metric: QuestMetric;
    /** delta required on `metric` since this stage's sealed baseline (0 for choice stages) */
    count: number;
    /** if set, the client launches this bestiary boss as the stage's foe */
    bossId?: string;
    /** if set, this is a BRANCH — the player picks one option to advance */
    choice?: { prompt: string; options: QuestChoiceOption[] };
    /** if set, this stage is TIMED */
    timer?: QuestTimer;
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
    /** cosmetic title granted on completion (a choice may override it) */
    award: string;
    /** only offered while the player's village is in an active war (client-gated availability) */
    requiresWar?: boolean;
    /** only offered while the player carries a wanderer nemesis (client-gated availability) */
    requiresRivalry?: boolean;
    /** on claim, ends the player's wanderer rivalry (the capstone's whole point) */
    clearsRivalry?: boolean;
    stages: QuestStage[];
}

export const QUEST_BOOK: Record<string, QuestBookEntry> = {
    // Q1 — band ~20–45. Boss → BRANCH → TIMED carry → (boss difficulty set by the branch).
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
            { key: "carry",  text: "Carry the wrapped clapper across 4 tiles before it completes the old alarm.", metric: "totalTilesExplored", count: 4,
                timer: { durationMs: 30 * 60 * 1000, failResetToStage: 2 } },
            { key: "wraith", text: "Return the clapper, then stop the temple guardian that answers the broken alarm.", metric: "totalAiKills", count: 1, bossId: "bell-wraith" },
        ],
    },
    // Q2 — band ~12–35. Trail → waves(boss) → BRANCH (spare/execute) → boss.
    "qb-caravan": {
        id: "qb-caravan", title: "The Hollow Caravan", giver: "Caravan-master Doteki",
        bandMin: 12, bandMax: 35, weight: 7, fateShards: 0, award: "Caravan's Shield",
        stages: [
            { key: "trail",   text: "Track Doteki's missing caravan across 3 tiles. Count the wheel ruts, abandoned loads, and blood.", metric: "totalTilesExplored", count: 3 },
            { key: "ambush",  text: "At the wreck, survive 3 bandit waves and disarm their captain, Goro.", metric: "totalAiKills", count: 3, bossId: "bandit-captain-goro" },
            { key: "judgment", text: "Goro drops his blade. Genjutsu marks behind his ears explain the empty look in his eyes. What now?", metric: "totalAiKills", count: 0,
                choice: { prompt: "Goro was forced to lead the attack, but caravan guards still died. Decide what happens to him.", options: [
                    { key: "spare",   label: "Spare Goro",   blurb: "Bind his wounds and take his testimony. He may help on the road later.", standing: "goro-spared" },
                    { key: "execute", label: "Execute Goro", blurb: "Carry out the caravan guards' sentence and collect their larger bounty. Goro's allies will remember it.", bonusRyoPct: 50, standing: "goro-executed" },
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
            { key: "offer", text: "A Frostfang signaler offers copied routes and testimony in exchange for protection from the unit hunting them. What do you do?", metric: "totalAiKills", count: 0,
                choice: { prompt: "“I copied the altered roll calls and the order behind them. Protect my testimony or arrest me, but decide now. The erasure team is close.”", options: [
                    { key: "trust",  label: "Protect the witness", blurb: "Escort them to an independent waystation, where a neutral courier can carry their testimony without returning them to Frostfang custody. Earns the title Border-Walker.", title: "Border-Walker", standing: "defector-trusted" },
                    { key: "turnin", label: "Make the arrest",      blurb: "Deliver the prisoner and route copies to your village's intelligence office for interrogation and a larger bounty. Earns the title Kage's Blade.", title: "Kage's Blade", bonusRyoPct: 40, standing: "defector-turned" },
                ] } },
            { key: "silencer", text: "Frostfang Hunter-nin Shirakawa catches the trail and moves to erase the signaler before the testimony arrives. Stop them.", metric: "totalAiKills", count: 1, bossId: "hunter-shirakawa" },
        ],
    },
    // Q4 — pet-mode campaign. Scales to the player's pets; ends on a mythic boss pet.
    "qb-gauntlet": {
        id: "qb-gauntlet", title: "The Colosseum Gauntlet", giver: "Tamer Tomoe",
        bandMin: 1, bandMax: 100, weight: 9, fateShards: 1, award: "Beast-Crowned",
        stages: [
            { key: "gauntlet", text: "Win three pet duels to prepare your companion for Tomoe's gauntlet.", metric: "totalPetWins", count: 3 },
            { key: "stormhound", text: "Face Tomoe's final companion, Raijū the Storm-Hound, and win the pet duel.", metric: "totalPetWins", count: 1, bossId: "raiju-storm-hound" },
        ],
    },
    // Q5 — band any, MEDIUM. Card-flavored but cheat-safe: the real reward hangs on a
    // verifiable bodyguard duel, not the (unprovable) card games.
    "qb-debt": {
        id: "qb-debt", title: "The Gambler's Debt", giver: "Saji Two-Coins",
        bandMin: 1, bandMax: 100, weight: 5, fateShards: 0, award: "House Breaker",
        stages: [
            { key: "table", text: "Saji owes the House. Buy him time by winning 2 Shinobi Chronicle Showdowns against its enforcers.", metric: "cardClashWins", count: 2 },
            { key: "collection", text: "The House calls the debt anyway. Its bodyguard, Kuroban, finds Saji's hide and decides you owe as well.", metric: "totalAiKills", count: 1, bossId: "house-kuroban" },
        ],
    },
    // Q6 — CAPSTONE, rivalry-gated, VERY HARD. The nemesis arc delivered as a quest;
    // claiming it ends the rivalry for good.
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

export function isQuestBookId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(QUEST_BOOK, id);
}

export function questBookEntry(id: string): QuestBookEntry | null {
    return isQuestBookId(id) ? QUEST_BOOK[id] : null;
}

/** The sealed epic state — persisted BOTH in KV (`questbook:<player>`, 14d TTL)
 *  and durably on the save record (`activeQuestbookSeal`) so an in-flight epic
 *  survives the KV TTL and the cPanel→Postgres cutover (the KV namespace was not
 *  carried). Mirrors WandererQuestSeal / RiftQuestSeal. */
export interface QuestbookSeal {
    id: string;
    stage: number;
    baseline: number;
    at?: number;
    deadline?: number;
    choices?: Record<string, string>;
}

/** Validate a persisted epic seal from either store; returns null if malformed. */
export function parseQuestbookSeal(raw: unknown): QuestbookSeal | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const stage = Math.floor(Number(value.stage));
    const baseline = Number(value.baseline);
    if (!isQuestBookId(id) || !Number.isFinite(baseline) || !Number.isInteger(stage) || stage < 0) return null;
    const seal: QuestbookSeal = { id, stage, baseline };
    const at = Number(value.at);
    if (Number.isSafeInteger(at) && at >= 0) seal.at = at;
    const deadline = Number(value.deadline);
    if (Number.isFinite(deadline) && deadline > 0) seal.deadline = deadline;
    if (value.choices && typeof value.choices === 'object' && !Array.isArray(value.choices)) {
        const choices: Record<string, string> = {};
        for (const [k, v] of Object.entries(value.choices as Record<string, unknown>)) {
            if (typeof v === 'string') choices[k] = v;
        }
        seal.choices = choices;
    }
    return seal;
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

/** A counter stage's objective is met when (current − baseline) reaches count. */
export function questStageComplete(baseline: number, current: number, count: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= (Number(count) || 0);
}

/** A branch stage — the player must pick an option to advance. */
export function stageIsChoice(stage: QuestStage | null | undefined): boolean {
    return !!stage?.choice && Array.isArray(stage.choice.options) && stage.choice.options.length > 0;
}

export function choiceOption(stage: QuestStage | null | undefined, optionKey: string): QuestChoiceOption | null {
    if (!stageIsChoice(stage)) return null;
    return stage!.choice!.options.find(o => o.key === optionKey) ?? null;
}

/** Milliseconds a timed stage allows, or 0 if the stage is untimed. */
export function stageTimerMs(stage: QuestStage | null | undefined): number {
    return Math.max(0, Math.floor(Number(stage?.timer?.durationMs) || 0));
}

/** Where a failed timer resets to (defaults to the timed stage itself). */
export function timerResetStage(entry: QuestBookEntry, stageIdx: number): number {
    const stage = entry.stages[stageIdx];
    const to = stage?.timer?.failResetToStage;
    if (typeof to === "number" && to >= 0 && to < entry.stages.length) return Math.floor(to);
    return stageIdx;
}

export function bandMatches(entry: QuestBookEntry, level: number): boolean {
    const lvl = Math.floor(Number(level) || 1);
    return lvl >= entry.bandMin && lvl <= entry.bandMax;
}

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

/** Base, level- and effort-scaled ryo for completing an epic (before choice bonuses). */
export function questBookRyo(level: number, weight: number): number {
    const lvl = clamp(level, 1, 100);
    const w = clamp(weight, 1, 20);
    return w * (40 + lvl * 5); // L40/w8 ≈ 1,920 · L100/w9 ≈ 4,860 — an epic, not a grind bounty
}

/** Aggregate the sealed branch choices into the final-reward modifiers. */
export function aggregateChoiceEffects(
    entry: QuestBookEntry,
    choices: Record<string, string> | null | undefined,
): { ryoMult: number; bonusFateShards: number; titleOverride: string | null; standings: string[] } {
    let ryoMult = 1;
    let bonusFateShards = 0;
    let titleOverride: string | null = null;
    const standings: string[] = [];
    const made = choices ?? {};
    for (const stage of entry.stages) {
        if (!stageIsChoice(stage)) continue;
        const opt = choiceOption(stage, String(made[stage.key] ?? ""));
        if (!opt) continue;
        if (opt.bonusRyoPct) ryoMult *= 1 + opt.bonusRyoPct / 100;
        if (opt.bonusFateShards) bonusFateShards += opt.bonusFateShards;
        if (opt.title) titleOverride = opt.title;
        if (opt.standing) standings.push(opt.standing);
    }
    return { ryoMult, bonusFateShards, titleOverride, standings };
}
