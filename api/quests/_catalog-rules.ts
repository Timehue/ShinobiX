/*
 * The rules every quest-line catalogue must pass. Pure, so the catalogue test
 * can run them and so a future content pass gets one list of plain-language
 * problems instead of a stack trace.
 *
 * The rules come from the owner's brief: quests are long, the player makes
 * things, and the last fight can only be won with what they made.
 */
import {
    questFightHolds,
    QUEST_LINE_MIN_STAGES,
    type QuestLine,
    type QuestLineFight,
    type QuestLineRecipe,
    type QuestLineStage,
    type QuestSay,
} from './_types.js';

export interface QuestLineCatalogue {
    lines: Readonly<Record<string, QuestLine>>;
    recipes: Readonly<Record<string, QuestLineRecipe>>;
    fights: Readonly<Record<string, QuestLineFight>>;
    /**
     * True for an item that exists only inside a quest. Such an input must be
     * produced by the quest that needs it, or it could never be had. An
     * ordinary material (Binding Fiber, Iron Sand) comes from the normal game.
     * When absent, every recipe input is treated as quest-only.
     */
    isQuestOnlyItem?: (itemId: string) => boolean;
    /**
     * True for a quest material the player keeps when a quest ends: what a kept
     * site yields (shared/quest-sites.ts). When absent, nothing is kept.
     */
    isKeptItem?: (itemId: string) => boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Em dash, en dash, double hyphen, or a hyphen used as a pause. */
const DASH_PAUSE = /[–—]|--| - /;
const positiveWhole = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;

/** Every item id a quest's own stages can put in the player's backpack. */
function producedItems(line: QuestLine, recipes: Readonly<Record<string, QuestLineRecipe>>): Set<string> {
    const made = new Set<string>();
    for (const stage of line.stages) {
        if (stage.kind === 'drop' || stage.kind === 'gather') made.add(stage.itemId);
        if (stage.kind === 'make') {
            const recipe = recipes[stage.recipeId];
            if (recipe) made.add(recipe.output.itemId);
        }
    }
    return made;
}

/** The most words one spoken line may run to: what an actor can say in a breath or two. */
export const QUEST_SAY_MAX_WORDS = 55;

/**
 * Problems with a run of spoken lines. `before` is how many of the quest's
 * stages come before the place these are said, so a `chose` condition can only
 * look back at a choice the player has already made.
 */
function sayProblems(at: string, says: readonly QuestSay[] | undefined, line: QuestLine, before: number): string[] {
    const problems: string[] = [];
    for (const [index, say] of (says ?? []).entries()) {
        const where = `${at}: line ${index + 1}`;
        const words = say.text.trim().split(/\s+/).filter(Boolean).length;
        if (!words) problems.push(`${where} is empty`);
        if (words > QUEST_SAY_MAX_WORDS) problems.push(`${where} runs to ${words} words; ${QUEST_SAY_MAX_WORDS} is the most`);
        if (DASH_PAUSE.test(say.text)) problems.push(`${where} uses a dash as a pause`);
        if (!say.speaker) problems.push(`${where} has no speaker`);
        const chose = say.when?.chose;
        if (chose) {
            const at_ = line.stages.findIndex(candidate => candidate.key === chose[0]);
            const choice = at_ >= 0 ? line.stages[at_] : undefined;
            if (!choice || choice.kind !== 'choice' || at_ >= before) problems.push(`${where} answers the choice ${chose[0]}, which the player has not made by then`);
            else if (choice.choice.answer !== undefined) problems.push(`${where} answers ${chose[0]}, which is a question with one right answer and is not remembered`);
            else if (!choice.choice.options.some(option => option.key === chose[1])) problems.push(`${where} answers an option ${chose[1]} that ${chose[0]} does not offer`);
        }
    }
    return problems;
}

function stageProblems(line: QuestLine, stage: QuestLineStage, catalogue: QuestLineCatalogue): string[] {
    const at = `${line.id}/${stage.key}`;
    const problems: string[] = [];
    if (!ID.test(stage.key)) problems.push(`${at}: stage key must be lowercase letters, digits and hyphens`);
    if (!stage.text.trim()) problems.push(`${at}: stage has no text`);
    if (DASH_PAUSE.test(stage.text)) problems.push(`${at}: stage text uses a dash as a pause`);
    // A step's lines are heard on arriving at it, so they may answer its own choice only once it is passed.
    problems.push(...sayProblems(at, stage.say, line, line.stages.indexOf(stage)));
    switch (stage.kind) {
        case 'gather':
            if (!positiveWhole(stage.count)) problems.push(`${at}: gather count must be a positive whole number`);
            if (!stage.siteIds.length) problems.push(`${at}: gather stage names no quest site`);
            break;
        case 'deliver':
            if (!positiveWhole(stage.count)) problems.push(`${at}: deliver count must be a positive whole number`);
            break;
        case 'drop':
            if (!positiveWhole(stage.count)) problems.push(`${at}: drop count must be a positive whole number`);
            if (!catalogue.fights[stage.fightId]) problems.push(`${at}: unknown fight ${stage.fightId}`);
            else if (catalogue.fights[stage.fightId].hold) problems.push(`${at}: a fight that drops an item must not carry a Hold`);
            break;
        case 'boss': {
            const base = catalogue.fights[stage.fightId];
            if (!base) problems.push(`${at}: unknown fight ${stage.fightId}`);
            const variants = stage.fightByChoice;
            if (!variants) break;
            // A fight that changes with a choice: the choice must come first, and
            // every variant must be the same fight in everything but strength, so
            // the place, the tool and the journal's Hold list never depend on it.
            const at_ = line.stages.findIndex(candidate => candidate.key === variants.stage);
            const choice = at_ >= 0 ? line.stages[at_] : undefined;
            if (!choice || choice.kind !== 'choice' || at_ >= line.stages.indexOf(stage)) {
                problems.push(`${at}: fightByChoice names ${variants.stage}, which is not an earlier choice stage`);
                break;
            }
            const holdsOf = (fight: QuestLineFight | undefined) => JSON.stringify(questFightHolds(fight));
            for (const [option, fightId] of Object.entries(variants.fights)) {
                const variant = catalogue.fights[fightId];
                if (!choice.choice.options.some(candidate => candidate.key === option)) problems.push(`${at}: fightByChoice names option ${option}, which ${variants.stage} does not offer`);
                if (!variant) { problems.push(`${at}: unknown fight ${fightId}`); continue; }
                if (base && variant.sector !== base.sector) problems.push(`${at}: fight ${fightId} is in another sector than ${stage.fightId}`);
                if (base && holdsOf(variant) !== holdsOf(base)) problems.push(`${at}: fight ${fightId} does not carry the same Holds as ${stage.fightId}`);
            }
            break;
        }
        case 'enter':
            if (stage.landing) {
                // Only a clan has a Landing, and its tiers run 0 (the staked plot) to 3.
                if (!line.gate.clan) problems.push(`${at}: a Landing condition needs a clan quest`);
                if (!Number.isInteger(stage.landing.tier) || stage.landing.tier < 0 || stage.landing.tier > 3) problems.push(`${at}: Landing tier must be 0 to 3`);
            }
            for (const clue of stage.clues ?? []) {
                // A clue is found by key and kept on the record, so its key is never reused in the quest.
                if (!ID.test(clue.key)) problems.push(`${at}: clue key ${clue.key} must be lowercase letters, digits and hyphens`);
                const elsewhere = line.stages.flatMap(other => (other.kind === 'enter' ? other.clues ?? [] : [])).filter(other => other.key === clue.key);
                if (elsewhere.length > 1) problems.push(`${at}: clue key ${clue.key} is used more than once in ${line.id}`);
                if (!Number.isInteger(clue.floor) || clue.floor < 0) problems.push(`${at}: clue ${clue.key} needs a floor`);
                if (!clue.station.trim()) problems.push(`${at}: clue ${clue.key} names no station`);
                if (!clue.say?.length) problems.push(`${at}: clue ${clue.key} teaches nothing`);
                problems.push(...sayProblems(`${at}/${clue.key}`, clue.say, line, line.stages.indexOf(stage)));
            }
            break;
        case 'make': {
            const recipe = catalogue.recipes[stage.recipeId];
            if (!recipe) { problems.push(`${at}: unknown recipe ${stage.recipeId}`); break; }
            // The player must be able to get every input before this stage,
            // from this quest's own earlier stages.
            const earlier = new Set<string>();
            for (const prior of line.stages) {
                if (prior === stage) break;
                if (prior.kind === 'gather' || prior.kind === 'drop') earlier.add(prior.itemId);
                if (prior.kind === 'make') {
                    const priorRecipe = catalogue.recipes[prior.recipeId];
                    if (priorRecipe) earlier.add(priorRecipe.output.itemId);
                }
            }
            const questOnly = catalogue.isQuestOnlyItem ?? (() => true);
            for (const input of recipe.inputs) {
                if (questOnly(input.itemId) && !earlier.has(input.itemId)) problems.push(`${at}: recipe input ${input.itemId} is not gathered, dropped or made earlier in this quest`);
                // A lost tool is made again from one more win at the drop fight
                // (questResupplyDrop), which tops the player up to the drop's
                // count. A recipe that needs more than that could not be remade.
                for (const prior of line.stages) {
                    if (prior === stage) break;
                    if (prior.kind === 'drop' && prior.itemId === input.itemId && prior.count < input.count) {
                        problems.push(`${at}: recipe needs ${input.count} ${input.itemId} but ${prior.key} drops ${prior.count}`);
                    }
                }
            }
            break;
        }
        case 'choice':
            if (stage.choice.options.length < 2) problems.push(`${at}: a choice needs at least two options`);
            if (new Set(stage.choice.options.map(o => o.key)).size !== stage.choice.options.length) problems.push(`${at}: choice option keys repeat`);
            for (const option of stage.choice.options) {
                if (!option.label.trim()) problems.push(`${at}: choice option ${option.key} has no label`);
                if (option.label.trim().split(/\s+/).length > 12) problems.push(`${at}: choice option ${option.key} label is over 12 words`);
            }
            // A question: one option is right, a wrong pick is answered in the world's
            // words, and nothing about it is kept, so it can carry no reward or standing.
            if (stage.choice.answer !== undefined) {
                if (!stage.choice.options.some(option => option.key === stage.choice.answer)) problems.push(`${at}: the answer ${stage.choice.answer} is not one of the options`);
                if (!stage.choice.wrong?.trim()) problems.push(`${at}: a question needs the sentence a wrong answer gets`);
                if (stage.choice.options.some(option => option.standing || option.bonusRyoPct || option.bonusFateShards || option.title || option.items?.length)) problems.push(`${at}: a question's options carry no reward or standing`);
                if (!stage.say?.length && !stage.choice.backTo) problems.push(`${at}: a question needs its clue said at the step, or a step to go back to`);
            } else if (stage.choice.wrong || stage.choice.backTo) problems.push(`${at}: only a question has a wrong answer`);
            if (stage.choice.backTo !== undefined) {
                const back = line.stages.findIndex(candidate => candidate.key === stage.choice.backTo);
                if (back < 0 || back >= line.stages.indexOf(stage)) problems.push(`${at}: backTo names ${stage.choice.backTo}, which is not an earlier stage`);
                // Going back must not ask for anything to be paid twice.
                else if (line.stages.slice(back, line.stages.indexOf(stage)).some(between => between.kind === 'make' || between.kind === 'deliver' || between.kind === 'drop' || between.kind === 'boss' || between.kind === 'choice')) problems.push(`${at}: going back to ${stage.choice.backTo} would repeat a step that takes or decides something`);
                // What a wrong answer makes the player look at again must be found at the step it sends them to.
                const target = line.stages[back];
                for (const key of stage.choice.forget ?? []) {
                    if (target?.kind !== 'enter' || !target.clues?.some(clue => clue.key === key)) problems.push(`${at}: forget names ${key}, which is not a clue at ${stage.choice.backTo}`);
                }
            } else if (stage.choice.forget?.length) problems.push(`${at}: only a wrong answer that sends the player back can make them forget a clue`);
            break;
        default:
            break;
    }
    return problems;
}

function lineProblems(line: QuestLine, key: string, catalogue: QuestLineCatalogue): string[] {
    const problems: string[] = [];
    if (line.id !== key) problems.push(`${key}: id ${line.id} does not match its catalogue key`);
    if (!ID.test(line.id)) problems.push(`${key}: id must be lowercase letters, digits and hyphens`);
    if (!line.title.trim()) problems.push(`${key}: no title`);
    if (!Number.isSafeInteger(line.marks) || line.marks < 0) problems.push(`${key}: marks must be a whole number of zero or more`);
    if (line.kind === 'tale' && line.marks !== 0) problems.push(`${key}: a side tale is worth no marks`);
    if (line.kind === 'quest' && line.marks < 1) problems.push(`${key}: a quest is worth at least one mark`);
    if (line.gate.level < 1 || line.gate.level > 100) problems.push(`${key}: gate level must be between 1 and 100`);
    for (const required of line.gate.quests ?? []) {
        if (!catalogue.lines[required]) problems.push(`${key}: requires unknown quest ${required}`);
        if (required === key) problems.push(`${key}: requires itself`);
    }
    const fate = line.rewards.fateShards ?? 0;
    if (fate !== 0 && fate !== 1) problems.push(`${key}: Fate Shards must be 0 or 1`);
    const gearChance = line.rewards.gearChanceBp;
    if (gearChance !== undefined && (!Number.isInteger(gearChance) || gearChance < 1 || gearChance > 10_000)) {
        problems.push(`${key}: a gear chance is 1 to 10,000 basis points`);
    }
    if (new Set(line.stages.map(s => s.key)).size !== line.stages.length) problems.push(`${key}: stage keys repeat`);
    for (const stage of line.stages) problems.push(...stageProblems(line, stage, catalogue));
    // The offer is heard before anything is chosen; the closing scene after everything is.
    problems.push(...sayProblems(`${key}/offer`, line.scenes?.offer, line, 0));
    problems.push(...sayProblems(`${key}/done`, line.scenes?.done, line, line.stages.length));
    if (line.scenes && (!line.scenes.offer.length || !line.scenes.done.length)) problems.push(`${key}: a quest with scenes needs both an offer and a closing scene`);

    // Every Hold, on either map: the tool that breaks it must come from this
    // quest, or the fight could never be won.
    const produced = producedItems(line, catalogue.recipes);
    for (const stage of line.stages) {
        if (stage.kind !== 'boss') continue;
        const holds = questFightHolds(catalogue.fights[stage.fightId]);
        for (const hold of holds) {
            if (!produced.has(hold.breakerItemId)) problems.push(`${key}/${stage.key}: the ${hold.name} is broken by ${hold.breakerItemId}, which this quest never produces`);
            if (!hold.name.trim()) problems.push(`${key}/${stage.key}: a Hold in the chain has no name`);
        }
        // Each Hold of a chain answers to its own tool, or the second could never be told from the first.
        if (new Set(holds.map(hold => hold.breakerItemId)).size !== holds.length) problems.push(`${key}/${stage.key}: two Holds in the chain share a tool`);
    }

    if (line.world === 'coast' && line.kind === 'quest') {
        const minimum = QUEST_LINE_MIN_STAGES[line.tier];
        if (line.stages.length < minimum) problems.push(`${key}: tier ${line.tier} needs at least ${minimum} stages, has ${line.stages.length}`);
        if (!line.stages.some(s => s.kind === 'gather')) problems.push(`${key}: a coast quest needs a gather stage`);
        if (!line.stages.some(s => s.kind === 'make' || s.kind === 'drop')) problems.push(`${key}: a coast quest needs a make or drop stage`);
        const last = line.stages[line.stages.length - 1];
        if (!last || last.kind !== 'boss') problems.push(`${key}: a coast quest must end in a boss stage`);
        else if (!catalogue.fights[last.fightId]?.hold) problems.push(`${key}: the final boss of a coast quest must carry a Hold`);
    }
    return problems;
}

/**
 * Which quests a player can finish, starting from nothing. `withClan: false`
 * leaves out every quest that needs a clan, and everything that depends on one.
 */
export function reachableQuestLines(lines: Readonly<Record<string, QuestLine>>, options: { withClan: boolean }): { ids: Set<string>; marks: number } {
    const ids = new Set<string>();
    let marks = 0;
    let grew = true;
    while (grew) {
        grew = false;
        for (const line of Object.values(lines)) {
            if (ids.has(line.id)) continue;
            if (line.gate.clan && !options.withClan) continue;
            if ((line.gate.quests ?? []).some(required => !ids.has(required))) continue;
            if ((line.gate.marks ?? 0) > marks) continue;
            ids.add(line.id);
            marks += line.marks;
            grew = true;
        }
    }
    return { ids, marks };
}

/** Every problem in the catalogue, as plain sentences. An empty list means it passes. */
export function questLineCatalogueProblems(catalogue: QuestLineCatalogue): string[] {
    const problems: string[] = [];
    for (const [key, recipe] of Object.entries(catalogue.recipes)) {
        if (recipe.id !== key) problems.push(`recipe ${key}: id does not match its key`);
        if (!recipe.inputs.length) problems.push(`recipe ${key}: no inputs`);
        for (const input of recipe.inputs) if (!positiveWhole(input.count)) problems.push(`recipe ${key}: input ${input.itemId} needs a positive whole count`);
        if (!positiveWhole(recipe.output.count)) problems.push(`recipe ${key}: output needs a positive whole count`);
    }
    for (const [key, fight] of Object.entries(catalogue.fights)) {
        if (fight.id !== key) problems.push(`fight ${key}: id does not match its key`);
        if (fight.hold && !fight.hold.name.trim()) problems.push(`fight ${key}: the Hold has no name`);
    }
    for (const [key, line] of Object.entries(catalogue.lines)) problems.push(...lineProblems(line, key, catalogue));

    // No quest may be stranded behind a clan: everything that does not itself
    // need a clan must be finishable without one.
    const solo = reachableQuestLines(catalogue.lines, { withClan: false });
    for (const line of Object.values(catalogue.lines)) {
        if (!line.gate.clan && !solo.ids.has(line.id)) problems.push(`${line.id}: cannot be reached without a clan (check its required quests and marks)`);
    }
    const all = reachableQuestLines(catalogue.lines, { withClan: true });
    for (const line of Object.values(catalogue.lines)) {
        if (!all.ids.has(line.id)) problems.push(`${line.id}: can never be reached (a requirement loop or too many marks)`);
    }
    return problems;
}
