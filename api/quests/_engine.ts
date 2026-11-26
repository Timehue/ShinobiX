/*
 * The quest-line rules, as pure decisions.
 *
 * Each function takes the player's record and character and answers with what
 * should be written and what to tell the client. Nothing here reads KV, checks
 * auth or takes a lock: api/quests/lines.ts does that and runs these inside one
 * mutatePlayerSave, so a stage advance, an item debit and a reward always land
 * in the same save write.
 *
 * Nothing the client sends decides an outcome. The client names a quest and an
 * action; where the player stands, what they hold and what they have won are
 * all read from the server's own copies.
 */
import { addOwned, countOwned, removeOwned } from '../craft/_forge.js';
import { hasInventoryRoom, inventoryGrowthBlock } from '../_inventory-capacity.js';
import { aggregateStageChoiceEffects, choiceOption, stageIsChoice } from './_stage-core.js';
import type { QuestLineCatalogue } from './_catalog-rules.js';
import {
    questLineGate,
    questLineMarks,
    type ActiveQuestLine,
    type QuestLinesRecord,
} from './_record.js';
import { questStageFightId, type DropStage, type MakeStage, type QuestClanFacts, type QuestLine, type QuestLinePlace, type QuestLineStage, type QuestSay } from './_types.js';
import { COAST_TALE_LINES } from './_coast-tales.js';
import { coastLandingTier } from '../coast/_landing-rules.js';

type Character = Record<string, unknown>;

/** Where the server believes the player is standing. Null when they are offline. */
export type QuestPresence = { sector: number; tile?: number; travelingUntil?: number; inBattle?: boolean } | null;

export interface QuestEngineDeps {
    catalogue: QuestLineCatalogue;
    /** The approach tile of a named building, or null if it does not exist. */
    buildingPlace(buildingId: string): QuestLinePlace | null;
    /** Ryo for finishing a quest of this weight at this level. */
    ryo(level: number, weight: number): number;
    /** Pay one-time stat points the way the main story does. */
    grantStatPoints(character: Character, points: number): Character;
    /** Chebyshev distance between two tiles of one sector. */
    tileDistance(a: number, b: number): number;
    /**
     * Roll a quest's gear chance for this player: the id of the piece it gives,
     * or null. It must give the same answer every time it is asked about the
     * same player and quest, so a retried claim cannot roll again. Left out, no
     * quest drops gear.
     */
    rollGear?(character: Character, chanceBp: number, questId: string): string | null;
}

export interface QuestDecision {
    ok: boolean;
    /** Why not, in a word the client maps to a sentence. */
    reason?: string;
    /** Set when something changed and must be written. */
    record?: QuestLinesRecord;
    character?: Character;
    /** Extra facts for the reply. */
    body?: Record<string, unknown>;
}

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const refuse = (reason: string, body?: Record<string, unknown>): QuestDecision => ({ ok: false, reason, ...(body ? { body } : {}) });

const DEFAULT_RADIUS = 2;
const TALES_BADGE = 'coast-tales-v1';
const coastTaleIds = Object.keys(COAST_TALE_LINES);

function completesCoastTales(id: string, record: QuestLinesRecord): boolean {
    return Object.hasOwn(COAST_TALE_LINES, id) && coastTaleIds.every(tale => tale === id || Object.hasOwn(record.done, tale));
}

/** Why the player is not at a place, or null when they are. */
export function questPresenceReason(
    place: QuestLinePlace,
    presence: QuestPresence,
    now: number,
    tileDistance: (a: number, b: number) => number,
): 'presence' | 'traveling' | 'in-battle' | 'wrong-place' | null {
    if (!presence) return 'presence';
    if ((presence.travelingUntil ?? 0) > now) return 'traveling';
    if (presence.inBattle) return 'in-battle';
    if (presence.sector !== place.sector) return 'wrong-place';
    if (place.tile === undefined) return null;
    // A tile is required but the server has not seen one yet: do not guess.
    if (presence.tile === undefined || !Number.isFinite(presence.tile)) return 'wrong-place';
    return tileDistance(presence.tile, place.tile) <= (place.radius ?? DEFAULT_RADIUS) ? null : 'wrong-place';
}

function currentStage(line: QuestLine, active: ActiveQuestLine): QuestLineStage | null {
    return active.stage >= 0 && active.stage < line.stages.length ? line.stages[active.stage] : null;
}

/** The record with one quest's active entry replaced. Never mutates its input. */
function withActive(record: QuestLinesRecord, id: string, active: ActiveQuestLine): QuestLinesRecord {
    return { ...record, active: { ...record.active, [id]: active } };
}

/** Move to the next stage. A stage index equal to the stage count means "ready to claim". */
function nextStage(active: ActiveQuestLine, now: number, patch: Partial<ActiveQuestLine> = {}): ActiveQuestLine {
    return { ...active, ...patch, stage: active.stage + 1, at: now };
}

function advanced(record: QuestLinesRecord, line: QuestLine, active: ActiveQuestLine, character?: Character): QuestDecision {
    return {
        ok: true,
        record: withActive(record, line.id, active),
        ...(character ? { character } : {}),
        body: { id: line.id, stage: active.stage, advanced: true, readyToClaim: active.stage >= line.stages.length },
    };
}

// ── Clan quests ──────────────────────────────────────────────────────────────

/**
 * Why a clan quest cannot move right now, or null when it can. It is taken with
 * a clan and moves only while the player is in that same clan and has been for
 * the coast's member tenure. Nothing is lost while it waits: it stands where it
 * stood. A quest that is not a clan quest never pauses.
 */
export function questClanPause(line: QuestLine, active: ActiveQuestLine | undefined, clan: QuestClanFacts | null | undefined): QuestDecision | null {
    if (!line.gate.clan) return null;
    if (!clan || (active?.clanGeneration && clan.generation !== active.clanGeneration)) {
        return refuse('clan-left', { error: 'This quest waits for the clan you took it with.' });
    }
    if (!clan.tenured) return refuse('clan-tenure', { error: 'You must be in your clan for two days before its quests move.' });
    return null;
}

/** Why a stage's Landing condition is not met, or null when it is. */
function landingRefusal(need: { tier: number }, clan: QuestClanFacts | null | undefined, stage: number): QuestDecision | null {
    const landing = clan?.landing;
    if (!landing) return refuse('landing', { stage, error: 'Your clan has not staked a Landing yet.' });
    if (!landing.active) return refuse('landing', { stage, error: 'Your clan’s Landing is dormant. Fill its stores first.' });
    if (landing.tier < need.tier) {
        return refuse('landing', { stage, tier: landing.tier, needTier: need.tier, error: `Your clan’s Landing must be raised to a ${coastLandingTier(need.tier).name}.` });
    }
    return null;
}

/**
 * How many units of an item the player's other quests need at the step each is
 * on right now: to pass a gather, to hand in, or to put into a recipe. Later
 * steps are not counted; they can be gathered for when they come.
 */
function reservedByOtherQuests(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    questId: string,
    itemId: string,
): { units: number; title: string } {
    let units = 0, title = '';
    for (const [otherId, other] of Object.entries(record.active)) {
        if (otherId === questId || !Object.hasOwn(deps.catalogue.lines, otherId)) continue;
        const line = deps.catalogue.lines[otherId];
        const stage = currentStage(line, other);
        if (!stage) continue;
        const need = (stage.kind === 'gather' || stage.kind === 'deliver') && stage.itemId === itemId ? stage.count
            : stage.kind === 'make' ? deps.catalogue.recipes[stage.recipeId]?.inputs.find(input => input.itemId === itemId)?.count ?? 0
                : 0;
        if (need > 0) { units += need; title ||= line.title; }
    }
    return { units, title };
}

/** Shared projection for the authoritative hand-in guard and its early player warning. */
export function questDeliveryReservation(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    questId: string,
    itemId: string,
    count: number,
    held: number,
): { target: number; message: string } | undefined {
    const reserved = reservedByOtherQuests(deps, record, questId, itemId);
    const target = count + reserved.units;
    if (!reserved.units || held >= target) return undefined;
    return { target, message: `${reserved.title} still needs ${reserved.units} of these. Gather ${target - held} more before you hand any in.` };
}

// ── Accept ───────────────────────────────────────────────────────────────────

export function acceptQuestLine(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
    ctx: { inClan: boolean; now: number; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    if (!line) return refuse('unknown');
    const gate = questLineGate(line, record, { level: whole(character.level), inClan: ctx.inClan });
    if (gate !== 'ok') return refuse(gate, { marks: questLineMarks(record), needMarks: line.gate.marks ?? 0, needLevel: line.gate.level });
    // A clan quest is taken with a clan the server can name: its generation is
    // kept, so the quest belongs to that clan and no later one of the same name.
    if (line.gate.clan && !ctx.clan) return refuse('clan');
    return {
        ok: true,
        record: withActive(record, line.id, { stage: 0, at: ctx.now, ...(line.gate.clan && ctx.clan ? { clanGeneration: ctx.clan.generation } : {}) }),
        body: { id: line.id, stage: 0 },
    };
}

// ── Advance ──────────────────────────────────────────────────────────────────

/**
 * Check the stage the player is on and move past it if its condition holds.
 * `make`, `choice` and the two fight stages have their own entry points: this
 * answers with the reason so the client knows which one to call.
 */
export function advanceQuestLine(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
    ctx: { presence: QuestPresence; now: number; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    const active = record.active[questId];
    if (!line || !active) return refuse('none');
    const stage = currentStage(line, active);
    if (!stage) return { ok: true, body: { id: line.id, stage: active.stage, readyToClaim: true } };
    const paused = questClanPause(line, active, ctx.clan);
    if (paused) return paused;

    switch (stage.kind) {
        case 'speak':
        case 'reach': {
            const why = questPresenceReason(stage.place, ctx.presence, ctx.now, deps.tileDistance);
            return why ? refuse(why, { stage: active.stage }) : advanced(record, line, nextStage(active, ctx.now));
        }
        case 'enter': {
            const place = deps.buildingPlace(stage.buildingId);
            if (!place) return refuse('no-building', { stage: active.stage });
            const why = questPresenceReason(place, ctx.presence, ctx.now, deps.tileDistance);
            if (why) return refuse(why, { stage: active.stage });
            const unmet = stage.landing ? landingRefusal(stage.landing, ctx.clan, active.stage) : null;
            if (unmet) return unmet;
            // A step with clues passes only once every one is found inside. The door is not enough.
            const missing = (stage.clues ?? []).filter(clue => !active.found?.includes(clue.key));
            if (missing.length) {
                return refuse('clues', { stage: active.stage, progress: (stage.clues?.length ?? 0) - missing.length, target: stage.clues?.length ?? 0 });
            }
            return advanced(record, line, nextStage(active, ctx.now));
        }
        case 'gather': {
            const held = countOwned(character, stage.itemId);
            return held >= stage.count
                ? advanced(record, line, nextStage(active, ctx.now))
                : refuse('incomplete', { stage: active.stage, progress: held, target: stage.count });
        }
        case 'deliver': {
            const place = deps.buildingPlace(stage.buildingId);
            if (!place) return refuse('no-building', { stage: active.stage });
            const why = questPresenceReason(place, ctx.presence, ctx.now, deps.tileDistance);
            if (why) return refuse(why, { stage: active.stage });
            // countOwned reads the backpack only, so worn gear is never handed in.
            const held = countOwned(character, stage.itemId);
            if (held < stage.count) return refuse('incomplete', { stage: active.stage, progress: held, target: stage.count });
            // Handing these in must not strand another quest the player has
            // under way. Quests share one backpack, and a side line asks for the
            // same materials a main quest does.
            const reservation = questDeliveryReservation(deps, record, questId, stage.itemId, stage.count, held);
            if (reservation) return refuse('reserved', {
                stage: active.stage, progress: held, target: reservation.target, error: reservation.message,
            });
            const delivered = { ...(active.delivered ?? {}), [stage.key]: stage.count };
            return advanced(record, line, nextStage(active, ctx.now, { delivered, took: true }), removeOwned(character, stage.itemId, stage.count));
        }
        case 'make':
            return refuse('make', { stage: active.stage });
        case 'choice':
            return refuse('choose', { stage: active.stage });
        case 'drop':
        case 'boss':
            return refuse('fight', { stage: active.stage, fightId: questStageFightId(stage, active.choices) });
    }
}

// ── Examine ──────────────────────────────────────────────────────────────────

/**
 * Examine one clue inside the building the current step names (EnterStage.clues).
 *
 * The clues are found in their order: one examined before the clue ahead of it
 * is refused with `clue-order`, and the room says what is missing. A clue found
 * before is read again and nothing is written, so examining twice is harmless.
 * What is found is kept on the quest record, so the player can leave between
 * clues and pick up where they were. The last clue passes the step.
 *
 * The server sees where the player stands outside, not where they walk inside a
 * building, so the check is the one an `enter` step makes: at the building's
 * door, in the step's sector. What stops a player skipping is the order, and
 * that every clue is its own act.
 */
export function examineQuestLineClue(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    questId: string,
    clueKey: string,
    ctx: { presence: QuestPresence; now: number; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    const active = record.active[questId];
    if (!line || !active) return refuse('none');
    const paused = questClanPause(line, active, ctx.clan);
    if (paused) return paused;
    const stage = currentStage(line, active);
    const clues = stage?.kind === 'enter' ? stage.clues ?? [] : [];
    const at = clues.findIndex(clue => clue.key === clueKey);
    if (!stage || stage.kind !== 'enter' || at < 0) return refuse('no-clue', { stage: active.stage });
    const place = deps.buildingPlace(stage.buildingId);
    if (!place) return refuse('no-building', { stage: active.stage });
    const why = questPresenceReason(place, ctx.presence, ctx.now, deps.tileDistance);
    if (why) return refuse(why, { stage: active.stage });
    const clue = clues[at];
    const found = active.found ?? [];
    const said = { clue: clue.key, say: clue.say ?? [], found: clues.filter(entry => found.includes(entry.key) || entry.key === clue.key).length, of: clues.length };
    if (found.includes(clue.key)) return { ok: true, body: { id: line.id, stage: active.stage, advanced: false, again: true, ...said } };
    const ahead = clues.slice(0, at).find(earlier => !found.includes(earlier.key));
    if (ahead) return refuse('clue-order', { stage: active.stage, missing: ahead.key });
    const next = [...found, clue.key];
    const complete = clues.every(entry => next.includes(entry.key));
    const decision = complete
        ? advanced(record, line, nextStage(active, ctx.now, { found: next }))
        : { ok: true, record: withActive(record, line.id, { ...active, found: next }), body: { id: line.id, stage: active.stage, advanced: false } };
    return { ...decision, body: { ...decision.body, ...said } };
}

// ── Make ─────────────────────────────────────────────────────────────────────

/**
 * Craft the stage's quest recipe at its named building. The materials leave
 * and the tool arrives in one decision, and the stage is passed.
 *
 * A recipe stays open for the rest of its quest. A tool spent in a fight that
 * was then lost can be made again at the same counter: that pays the materials
 * again and passes no stage. `stageKey` picks which earlier recipe when a quest
 * has more than one; without it, the most recent one is made.
 */
export function makeQuestLineItem(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
    ctx: { presence: QuestPresence; now: number; stageKey?: string; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    const active = record.active[questId];
    if (!line || !active) return refuse('none');
    const paused = questClanPause(line, active, ctx.clan);
    if (paused) return paused;
    const current = currentStage(line, active);
    const again = current?.kind === 'make' ? undefined : line.stages
        .slice(0, Math.min(active.stage, line.stages.length))
        .filter((earlier): earlier is MakeStage => earlier.kind === 'make' && (!ctx.stageKey || earlier.key === ctx.stageKey))
        .at(-1);
    const stage = current?.kind === 'make' ? current : again;
    if (!stage) return refuse('not-make', { stage: active.stage });
    const recipe = deps.catalogue.recipes[stage.recipeId];
    const place = deps.buildingPlace(stage.buildingId);
    if (!recipe || !place) return refuse('no-building', { stage: active.stage });
    const why = questPresenceReason(place, ctx.presence, ctx.now, deps.tileDistance);
    if (why) return refuse(why, { stage: active.stage });

    const missing = recipe.inputs
        .map(input => ({ itemId: input.itemId, need: input.count, have: countOwned(character, input.itemId) }))
        .filter(row => row.have < row.need);
    if (missing.length) return refuse('materials', { stage: active.stage, missing });

    let next = character;
    for (const input of recipe.inputs) next = removeOwned(next, input.itemId, input.count);
    next = addOwned(next, recipe.output.itemId, recipe.output.count, true);
    if (inventoryGrowthBlock(character, next)) return refuse('inventory-full', { stage: active.stage });
    if (again) return { ok: true, character: next, body: { id: line.id, stage: active.stage, advanced: false, madeAgain: recipe.output } };
    return advanced(record, line, nextStage(active, ctx.now, { took: true }), next);
}

// ── Choose ───────────────────────────────────────────────────────────────────

export function chooseQuestLineOption(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    questId: string,
    optionKey: string,
    ctx: { now: number; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    const active = record.active[questId];
    if (!line || !active) return refuse('none');
    const paused = questClanPause(line, active, ctx.clan);
    if (paused) return paused;
    const stage = currentStage(line, active);
    if (!stage || stage.kind !== 'choice' || !stageIsChoice(stage)) return refuse('no-choice', { stage: active.stage });
    if (!choiceOption(stage, optionKey)) return refuse('bad-option', { stage: active.stage });
    // A question, not a decision: only the right answer passes. A wrong one is
    // refused in the world's own words and, where the quest says so, sends the
    // player back to read the clue again. Nothing about it is remembered.
    if (stage.choice.answer !== undefined) {
        if (optionKey === stage.choice.answer) return advanced(record, line, nextStage(active, ctx.now));
        const error = stage.choice.wrong ?? 'That is not it. Look again.';
        const back = stage.choice.backTo ? line.stages.findIndex(candidate => candidate.key === stage.choice.backTo) : -1;
        if (back >= 0 && back < active.stage) {
            // The clues it names have to be looked at again; every other clue stays found. Always written as a
            // list, even an empty one: the save writer keeps a key a write leaves out.
            const forget = stage.choice.forget ?? [];
            const found = forget.length ? { found: (active.found ?? []).filter(key => !forget.includes(key)) } : {};
            return { ok: false, reason: 'wrong-answer', record: withActive(record, line.id, { ...active, ...found, stage: back, at: ctx.now }), body: { stage: back, error } };
        }
        return refuse('wrong-answer', { stage: active.stage, error });
    }
    const choices = { ...(active.choices ?? {}), [stage.key]: optionKey };
    const decision = advanced(record, line, nextStage(active, ctx.now, { choices }));
    return { ...decision, body: { ...decision.body, chose: optionKey } };
}

// ── A fight the server settled ───────────────────────────────────────────────

/**
 * Pass a `drop` or `boss` stage after the server's own fight settlement proved
 * the win. Called from inside that settlement's save write, never from a
 * client request. `sealedAt` is the stage seal the fight was started under, so
 * a win from an earlier attempt at the quest cannot pass a later stage.
 */
export function settleQuestLineFight(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    character: Character,
    win: { questId: string; stage: number; sealedAt: number; fightId: string; now: number },
): QuestDecision {
    const line = deps.catalogue.lines[win.questId];
    const active = record.active[win.questId];
    if (!line || !active) return refuse('none');
    if (active.stage !== win.stage || active.at !== win.sealedAt) return refuse('stale');
    const stage = currentStage(line, active);
    if (!stage || (stage.kind !== 'drop' && stage.kind !== 'boss') || questStageFightId(stage, active.choices) !== win.fightId) return refuse('stale');
    if (stage.kind === 'boss') return advanced(record, line, nextStage(active, win.now));

    // A drop tops the player up to the count the stage asks for. Winning again
    // while already holding enough grants nothing more.
    const held = countOwned(character, stage.itemId);
    const granted = Math.max(0, stage.count - held);
    const next = granted > 0 ? addOwned(character, stage.itemId, granted, true) : character;
    if (granted > 0 && inventoryGrowthBlock(character, next)) return refuse('inventory-full');
    return { ...advanced(record, line, nextStage(active, win.now), next), body: { id: line.id, stage: active.stage + 1, advanced: true, dropped: { itemId: stage.itemId, count: granted } } };
}

/**
 * The earlier fight that supplies a tool's missing ingredient, if there is one.
 *
 * A boss with a Hold cannot be fought without its tool. When the tool was spent
 * in a lost fight and the recipe needs an item only an earlier `drop` fight
 * gives, that fight has to be open again or the quest could never be finished.
 * Answers with that drop stage's index when the player holds less of its item
 * than the recipe needs, and null when nothing dropped is missing.
 */
export function questResupplyDrop(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    line: QuestLine,
    active: ActiveQuestLine,
    character: Character,
    toolItemId: string,
): { index: number; stage: DropStage } | null {
    // This quest's own recipe for the tool. Several quests make the same tool
    // from different materials, so the catalogue's first match would be wrong.
    const recipe = line.stages
        .filter((stage): stage is MakeStage => stage.kind === 'make')
        .map(stage => deps.catalogue.recipes[stage.recipeId])
        .find(candidate => candidate?.output.itemId === toolItemId);
    if (!recipe) return null;
    for (const input of recipe.inputs) {
        if (countOwned(character, input.itemId) >= input.count) continue;
        const index = line.stages.findIndex((stage, at) => at < active.stage && stage.kind === 'drop' && stage.itemId === input.itemId);
        if (index >= 0) return { index, stage: line.stages[index] as DropStage };
    }
    return null;
}

/**
 * Pay a resupply fight the server settled as a win: top the player back up to
 * what the earlier drop stage gave. It passes no stage and writes no quest
 * record, and a settlement that is retried finds the item already held.
 */
export function resupplyQuestLineDrop(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    character: Character,
    win: { questId: string; dropStage: number; fightId: string },
): QuestDecision {
    const line = deps.catalogue.lines[win.questId];
    const active = record.active[win.questId];
    if (!line || !active) return refuse('none');
    const stage = line.stages[win.dropStage];
    if (!stage || stage.kind !== 'drop' || stage.fightId !== win.fightId || win.dropStage >= active.stage) return refuse('stale');
    const granted = Math.max(0, stage.count - countOwned(character, stage.itemId));
    if (!granted) return { ok: true, body: { id: line.id, stage: active.stage, advanced: false } };
    const next = addOwned(character, stage.itemId, granted, true);
    if (inventoryGrowthBlock(character, next)) return refuse('inventory-full');
    return { ok: true, character: next, body: { id: line.id, stage: active.stage, advanced: false, dropped: { itemId: stage.itemId, count: granted } } };
}

// ── Claim ────────────────────────────────────────────────────────────────────

function withTitle(character: Character, title: string): Character {
    const list = (field: string) => (Array.isArray(character[field]) ? (character[field] as unknown[]).filter((t): t is string => typeof t === 'string') : []);
    const serverTitles = list('serverTitles');
    const earnedTitles = list('earnedTitles');
    return {
        ...character,
        serverTitles: serverTitles.includes(title) ? serverTitles : [...serverTitles, title],
        earnedTitles: earnedTitles.includes(title) ? earnedTitles : [...earnedTitles, title],
    };
}

/**
 * The quest-only items one quest gathers, wins and makes, and no other quest
 * needs. Ordinary materials are never in this list: they are the player's own.
 * Neither is what a kept site yields (catalogue.isKeptItem): that is a reward.
 *
 * `others` names the quests that still need their items: the player's other
 * quests under way. Several quests can share a tool or a material, so an item
 * is handed back when the last quest that needs it ends. Left out, every other
 * quest in the catalogue counts.
 */
export function questLineLentItems(deps: Pick<QuestEngineDeps, 'catalogue'>, line: QuestLine, others?: readonly string[]): string[] {
    const usedBy = (candidate: QuestLine): Set<string> => {
        const ids = new Set<string>();
        for (const stage of candidate.stages) {
            if (stage.kind === 'gather' || stage.kind === 'drop' || stage.kind === 'deliver') ids.add(stage.itemId);
            if (stage.kind === 'make') {
                const recipe = deps.catalogue.recipes[stage.recipeId];
                if (recipe) { ids.add(recipe.output.itemId); for (const input of recipe.inputs) ids.add(input.itemId); }
            }
        }
        return ids;
    };
    // Taking items away is the one place the unsafe guess is "quest-only": a
    // catalogue that cannot say which items are quest-only hands nothing back.
    const questOnly = deps.catalogue.isQuestOnlyItem;
    if (!questOnly) return [];
    const kept = deps.catalogue.isKeptItem ?? (() => false);
    const stillNeeded = Object.values(deps.catalogue.lines).filter(other => other.id !== line.id && (!others || others.includes(other.id)));
    const elsewhere = new Set(stillNeeded.flatMap(other => [...usedBy(other)]));
    return [...usedBy(line)].filter(itemId => questOnly(itemId) && !kept(itemId) && !elsewhere.has(itemId));
}

/**
 * The spoken lines a player hears, out of all a scene could say: each line
 * whose `when` holds for this player. `standings` is what earlier choices left
 * on their record, `choices` what they have sealed in this quest so far, and
 * `done` the quest lines they have finished.
 */
export function questSaysHeard(
    says: readonly QuestSay[] | undefined,
    heard: { standings: ReadonlySet<string>; choices?: Readonly<Record<string, string>>; done: Readonly<Record<string, unknown>> },
): QuestSay[] {
    return (says ?? []).filter(({ when }) => !when || (
        (when.standing === undefined || heard.standings.has(when.standing))
        && (when.without === undefined || !heard.standings.has(when.without))
        && (when.chose === undefined || heard.choices?.[when.chose[0]] === when.chose[1])
        && (when.finished === undefined || Object.hasOwn(heard.done, when.finished))
        && (when.unfinished === undefined || !Object.hasOwn(heard.done, when.unfinished))
    ));
}

/** The items the options a player sealed add to a quest's reward, in stage order. */
export function questChoiceItems(line: QuestLine, choices: Readonly<Record<string, string>> | undefined): string[] {
    return line.stages.flatMap(stage => (stage.kind === 'choice'
        ? stage.choice.options.find(option => option.key === choices?.[stage.key])?.items ?? []
        : []));
}

/**
 * The journal pictures for what a quest gives: the quest's own, then one for
 * each choice. A choice not made yet shows every option's picture, so the
 * player sees what is on the table; once sealed, only the one they took.
 */
export function questRewardArtKeys(line: QuestLine, choices: Readonly<Record<string, string>> | undefined): string[] {
    const keys = [...(line.rewards.artKeys ?? line.rewards.badges ?? [])];
    for (const stage of line.stages) {
        if (stage.kind !== 'choice') continue;
        const picked = choices?.[stage.key];
        const options = picked === undefined ? stage.choice.options : stage.choice.options.filter(option => option.key === picked);
        for (const option of options) if (option.artKey) keys.push(option.artKey);
    }
    return [...new Set(keys)];
}

/**
 * Pay a finished quest and record it as done, in one decision. A second claim
 * finds the quest already done and pays nothing.
 */
export function claimQuestLine(
    deps: QuestEngineDeps,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
    ctx: { now: number; clan?: QuestClanFacts | null },
): QuestDecision {
    const line = deps.catalogue.lines[questId];
    if (record.done[questId]) return { ok: true, body: { id: questId, replayed: true, marks: questLineMarks(record) } };
    const active = record.active[questId];
    if (!line || !active) return refuse('none');
    const paused = questClanPause(line, active, ctx.clan);
    if (paused) return paused;
    if (active.stage < line.stages.length) return refuse('not-final', { stage: active.stage });

    const rewards = line.rewards;
    const items = [...(rewards.items ?? []), ...questChoiceItems(line, active.choices)];
    if (!hasInventoryRoom(character, items.length)) return refuse('inventory-full');

    const fx = aggregateStageChoiceEffects(line.stages, active.choices);
    const ryo = Math.round(deps.ryo(whole(character.level) || 1, rewards.weight) * fx.ryoMult);
    const fateShards = (rewards.fateShards ?? 0) + fx.bonusFateShards;
    const boneCharms = rewards.boneCharms ?? 0;
    const auraStones = rewards.auraStones ?? 0;
    const title = fx.titleOverride ?? rewards.title ?? null;

    let next: Character = {
        ...character,
        ryo: whole(character.ryo) + ryo,
        fateShards: whole(character.fateShards) + fateShards,
        boneCharms: whole(character.boneCharms) + boneCharms,
        auraStones: whole(character.auraStones) + auraStones,
    };
    // What the quest lent goes back: spare tools, and materials only it had a
    // use for. They cannot be sold, worn or traded, so left behind they would
    // only fill the backpack.
    const returned: { itemId: string; count: number }[] = [];
    for (const itemId of questLineLentItems(deps, line, Object.keys(record.active))) {
        const count = countOwned(next, itemId);
        if (!count) continue;
        next = removeOwned(next, itemId, count);
        returned.push({ itemId, count });
    }
    for (const itemId of items) next = addOwned(next, itemId, 1, false);
    // The gear chance. Like every gear drop it is already earned, so a full
    // backpack never refuses it (api/_gear-drops.ts); only the promised items
    // above are checked for room.
    const gear = rewards.gearChanceBp && deps.rollGear ? deps.rollGear(character, rewards.gearChanceBp, questId) : null;
    if (gear) next = addOwned(next, gear, 1, false);
    if (title) next = withTitle(next, title);
    if (fx.standings.length) {
        const prior = Array.isArray(character.questStandings) ? (character.questStandings as unknown[]).filter((s): s is string => typeof s === 'string') : [];
        next = { ...next, questStandings: [...prior, ...fx.standings.filter(s => !prior.includes(s))] };
    }
    // Achievements the quest earns are proven by this list and nothing else.
    const completedTales = completesCoastTales(questId, record);
    const badges = [...(rewards.badges ?? [])];
    if (completedTales) badges.push(TALES_BADGE);
    if (badges.length) {
        const held = Array.isArray(character.coastBadges) ? (character.coastBadges as unknown[]).filter((b): b is string => typeof b === 'string') : [];
        next = { ...next, coastBadges: [...held, ...badges.filter(badge => !held.includes(badge))] };
    }
    // Stat points last: the grant recomputes the derived level from the result.
    if (rewards.statPoints) next = deps.grantStatPoints(next, rewards.statPoints);

    const remaining = { ...record.active };
    delete remaining[questId];
    const done = {
        at: ctx.now,
        marks: line.marks,
        ...(active.choices ? { choices: active.choices } : {}),
        ...(rewards.opensRegion ? { opensRegion: rewards.opensRegion } : {}),
        ...(rewards.unlocks?.length ? { unlocks: [...rewards.unlocks] } : {}),
        ...(gear ? { gear } : {}),
        ...(completedTales ? { completedTales: true } : {}),
    };
    const nextRecord: QuestLinesRecord = { ...record, active: remaining, done: { ...record.done, [questId]: done } };
    return {
        ok: true,
        record: nextRecord,
        character: next,
        body: {
            id: questId, ryo, fateShards, boneCharms, auraStones, statPoints: rewards.statPoints ?? 0,
            title, items: [...items], gear, marks: questLineMarks(nextRecord),
            opensRegion: rewards.opensRegion ?? null, unlocks: rewards.unlocks ?? [],
            ...(returned.length ? { returned } : {}),
        },
    };
}

// ── Abandon ──────────────────────────────────────────────────────────────────

/**
 * Give a quest up. `orphaned` is for a clan quest: pass the catalogue, the
 * character and what the server knows of the player's clan, and a quest taken
 * with a clan the player is no longer in may be dropped even after it has
 * taken items.
 */
export function abandonQuestLine(
    record: QuestLinesRecord,
    questId: string,
    orphaned?: { deps: Pick<QuestEngineDeps, 'catalogue'>; character: Character; clan: QuestClanFacts | null | undefined },
): QuestDecision {
    const active = record.active[questId];
    if (!active) return { ok: true, body: { id: questId } };
    // Items already handed in or spent on a tool are gone. Letting the quest
    // go now would lose them for nothing, so it has to be finished.
    if (active.took) {
        // Unless it can never be finished. A clan quest moves only with the clan
        // it was taken with. If that clan has dissolved, or the player has left
        // it, the quest would hold one of the three quest slots for ever. It is
        // ended the way an admin reset ends one: what it lent is taken back.
        const line = orphaned?.deps.catalogue.lines[questId];
        if (orphaned && line && questClanPause(line, active, orphaned.clan)?.reason === 'clan-left') {
            return resetQuestLine(orphaned.deps, record, orphaned.character, questId);
        }
        return refuse('committed', { stage: active.stage });
    }
    const remaining = { ...record.active };
    delete remaining[questId];
    return { ok: true, record: { ...record, active: remaining }, body: { id: questId } };
}

// ── Admin reset ──────────────────────────────────────────────────────────────

/**
 * An admin's way to unstick a player: end one quest's run, wherever it stands,
 * and take back what the quest lent, so it can be accepted afresh. With
 * `forget` it also forgets that the quest was ever finished.
 *
 * Nothing already paid is taken back. A forgotten quest can be finished and
 * paid a second time, so `forget` is for test accounts and mistakes, and the
 * route writes every use to the audit log.
 */
export function resetQuestLine(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
    opts: { forget?: boolean } = {},
): QuestDecision {
    const wasActive = !!record.active[questId];
    const forgot = !!opts.forget && !!record.done[questId];
    if (!wasActive && !forgot) return { ok: true, body: { id: questId, cleared: false, forgot: false } };

    let next = character;
    const returned: { itemId: string; count: number }[] = [];
    const line = deps.catalogue.lines[questId];
    for (const itemId of line ? questLineLentItems(deps, line, Object.keys(record.active)) : []) {
        const count = countOwned(next, itemId);
        if (!count) continue;
        next = removeOwned(next, itemId, count);
        returned.push({ itemId, count });
    }
    const active = { ...record.active };
    delete active[questId];
    const done = { ...record.done };
    if (forgot) delete done[questId];
    return {
        ok: true,
        record: { ...record, active, done },
        ...(returned.length ? { character: next } : {}),
        body: { id: questId, cleared: wasActive, forgot, ...(returned.length ? { returned } : {}) },
    };
}

// ── What the client is shown ─────────────────────────────────────────────────

export interface QuestLineView {
    id: string;
    series: string;
    title: string;
    world: QuestLine['world'];
    marks: number;
    stages: number;
    state: 'done' | 'ready' | 'active' | 'open' | 'locked';
    /** Why a locked quest cannot be accepted yet. */
    reason?: string;
    needLevel: number;
    needMarks: number;
    /** Set when the reward has a chance at a gear piece: the chance as a whole percent. */
    gearChance?: number;
    /** Journal pictures for a badge or a named gear piece the quest gives. */
    rewardArtKeys?: string[];
    /** The stage under way: its index, kind and what to do. */
    stage?: { index: number; kind: QuestLineStage['kind']; text: string };
}

/** Everything the World Quests tab needs, with no text for stages not yet reached. */
export function questLineViews(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    ctx: { level: number; inClan: boolean },
): { marks: number; lines: QuestLineView[] } {
    const lines = Object.values(deps.catalogue.lines).map((line): QuestLineView => {
        const art = questRewardArtKeys(line, record.done[line.id]?.choices ?? record.active[line.id]?.choices);
        const claimed = record.done[line.id];
        if (claimed ? claimed.completedTales : completesCoastTales(line.id, record)) art.push(TALES_BADGE);
        const base = {
            id: line.id, series: line.series, title: line.title, world: line.world, marks: line.marks,
            stages: line.stages.length, needLevel: line.gate.level, needMarks: line.gate.marks ?? 0,
            ...(line.rewards.gearChanceBp ? { gearChance: Math.round(line.rewards.gearChanceBp / 100) } : {}),
            ...(art.length ? { rewardArtKeys: art } : {}),
        };
        if (record.done[line.id]) return { ...base, state: 'done' };
        const active = record.active[line.id];
        if (active) {
            const stage = currentStage(line, active);
            return stage
                ? { ...base, state: 'active', stage: { index: active.stage, kind: stage.kind, text: stage.text } }
                : { ...base, state: 'ready' };
        }
        const gate = questLineGate(line, record, ctx);
        return gate === 'ok' ? { ...base, state: 'open' } : { ...base, state: 'locked', reason: gate };
    });
    return { marks: questLineMarks(record), lines };
}
