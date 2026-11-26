/*
 * What the client is shown of a quest line, with names filled in.
 *
 * questLineViews (_engine.ts) says which quests exist and what state each is
 * in. This adds what a screen needs to draw the stage the player is on: where
 * it happens, what they must hold, what a recipe takes, who they fight. Only
 * the stage under way is described; later stages are never sent ahead.
 *
 * The client has no copy of the catalogue, the cast or the coast, so there is
 * nothing here to drift from. Pure apart from reading the active catalogue.
 */
import { COAST_BOAT_UNLOCK, COAST_LAST_GARRISON, COAST_SECOND_DOCK, coastBoatLandings, coastSealedSectors, type CoastBoatLanding } from '../_coast-admission.js';
import { countOwned } from '../craft/_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { coastCastMember, coastCastPortrait } from '../../shared/coast-cast.js';
import { coastSectorName, coastSite } from '../../shared/coast-world.js';
import { sectorBuilding } from '../../shared/sector-buildings.js';
import { sectorName } from '../../shared/sector-geo.js';
import { questDeliveryReservation, questLineViews, questSaysHeard, type QuestEngineDeps, type QuestLineView } from './_engine.js';
import { coastQuestPresence, type CoastFigure, type CoastQuestMark } from './_coast-presence.js';
import { coastResidents, type CoastResident } from './_coast-residents.js';
import { hasQuestLineUnlock, openedCoastRegion, type ActiveQuestLine, type QuestLinesRecord } from './_record.js';
import { aggregateStageChoiceEffects } from './_stage-core.js';
import { questFightHolds, questStageFightId, type MakeStage, type QuestLine, type QuestLineRecipe, type QuestLineStage, type QuestSay } from './_types.js';

type Character = Record<string, unknown>;

export interface QuestPlaceView { sector: number; sectorName: string; name?: string }
export interface QuestItemCount { itemId: string; name: string; count: number; have: number }
export interface QuestRecipeView { stageKey: string; place?: QuestPlaceView; inputs: QuestItemCount[]; output: { itemId: string; name: string; count: number } }
export interface QuestFightView {
    name: string;
    /** An existing world model the client already has a portrait for. */
    model: string;
    /** That model's painted face, by name (castFaceOf). */
    face: string;
    sector: number;
    level: number;
    /** Set when the foe has a Hold: its name, the tool that breaks it and how many the player holds. */
    hold?: { name: string; tool: string; toolItemId: string; have: number };
    /** Set for a chain of Holds: the ones that rise after the first, in order. */
    thenHolds?: Array<{ name: string; tool: string; toolItemId: string; have: number }>;
}

export interface QuestStageView {
    index: number;
    kind: QuestLineStage['kind'];
    text: string;
    place?: QuestPlaceView;
    /** gather, deliver and drop: what must be held, and how much is. */
    need?: QuestItemCount;
    deliveryReservation?: { target: number; message: string };
    recipe?: QuestRecipeView;
    fight?: QuestFightView;
    choice?: { prompt: string; place?: string; options: { key: string; label: string; blurb: string }[] };
    /** enter, with clues: each thing to find inside, where it is, and whether it has been found. */
    clues?: { key: string; floor: number; station: string; found: boolean }[];
}

/** One spoken line as the journal shows it. `speaker` is a name, or empty for plain description. */
/**
 * `face` says how a scene shows the speaker: the path of their painted cut-out
 * (coastCastPortrait, starts with `/`) or, until they have one, the name of a
 * wanderer face (castFaceOf). Absent for the player and for narration.
 */
export interface QuestTalkLine { speaker: string; text: string; face?: string }

export interface QuestLineClientView extends Omit<QuestLineView, 'stage'> {
    giver: string;
    giverName: string;
    /**
     * What is being said right now, already chosen for this player: the offer
     * while the quest is open, the step's own lines while it is under way, and
     * the closing scene once every step is passed. Absent when nothing is said.
     */
    talk?: QuestTalkLine[];
    /** Where the quest is offered. Absent when its giver finds the player, as the Wandering Sage does. */
    offerAt?: QuestPlaceView;
    stage?: QuestStageView;
    /** An earlier recipe that can be made again, when the tool it makes has run out. */
    remake?: QuestRecipeView;
    /** True once the quest has taken items, after which it cannot be abandoned. */
    committed?: boolean;
    /** The quest's own painting, shown in the journal: shinobij.client/public/scenes/story/coast-<art>-v1.webp. */
    art?: string;
    /** The painting behind what is being said right now: the quest's own, or its region's when it has none. Sent with `talk`. */
    backdrop?: string;
    /** The story theme what is being said plays under, by the region it is said in (REGION_SCORES). Sent with `talk`. */
    score?: string;
    /** Where the quest stands when it is not under way, as one sentence (questStateNote). */
    note?: string;
}

/**
 * Which painting each quest has, by quest id. Held here so the client carries
 * no table of quests: it is told the name and builds the path. Rounds and side
 * tales have none.
 */
export const QUEST_PAINTINGS: Readonly<Record<string, string>> = {
    'shuttered-boat': 'shuttered-boat',
    'first-footing': 'first-footing',
    'crossing-war-1': 'bitter-tide',
    'crossing-war-2': 'mirror-hold',
    'crossing-war-3': 'beast-bond',
    'crossing-war-4': 'rime-lock',
    'crossing-war-5': 'twin-ward',
    'the-unmoored': 'quiet-crown',
    'boatwright-tools-1': 'slip-bench',
    'boatwright-tools-2': 'pitchwrack',
    'boatwright-tools-3': 'split-keel',
    'uncounted-1': 'defectors-quay',
    'uncounted-2': 'sunken-record',
    'uncounted-3': 'pass-register',
    'clan-gate-1': 'found-the-landing',
    'clan-gate-2': 'raise-the-hall',
    'clan-gate-3': 'defend-the-gate',
    'untamed-coast-1': 'hound-trace',
    'untamed-coast-2': 'antlerwash',
    'untamed-coast-3': 'listening-saddle',
};
/** One painting per region of the coast, first to last, for a scene from a quest that has none of its own. */
const REGION_PAINTINGS = ['bitter-tide', 'mirror-hold', 'beast-bond', 'rime-lock', 'twin-ward'] as const;

const itemName = (itemId: string) => ITEM_CATALOG[itemId]?.name ?? itemId;

/**
 * Which painted wanderer face each recast world model wears. The client has
 * the paintings (lib/wanderer-art); this names the one to use, so it holds no
 * table of the cast. `boss` is the warlord's own portrait.
 */
const CAST_FACES: Readonly<Record<string, string>> = {
    'wandering-sage': 'wanderingSage', angler: 'angler', 'world-bandit': 'bandit', nightblade: 'nightblade',
    'underground-wayfarer': 'pilgrim', courier: 'courier', 'ambush-bandit-2': 'bandit', 'bounty-hunter': 'bountyHunter',
    merchant: 'merchant', medic: 'medic', tracker: 'tracker', patrol: 'patrol', pilgrim: 'pilgrim', gambler: 'gambler',
    'bandit-warlord': 'boss',
};
/** The face for a world model. An unmapped model still gets one. */
export const castFaceOf = (model: string): string => (Object.hasOwn(CAST_FACES, model) ? CAST_FACES[model] : 'bandit');

/**
 * One sentence on where a quest stands when it is not under way: locked and
 * why, on offer and where, ready to claim, or finished. A quest under way says
 * its step instead. Worded here so the client carries none of these sentences.
 */
export function questStateNote(view: Pick<QuestLineView, 'state' | 'reason' | 'needLevel' | 'needMarks'>, giverName: string, offerAt?: QuestPlaceView): string | undefined {
    if (view.state === 'done') return 'Finished';
    if (view.state === 'ready') return 'It is done. Take what you earned.';
    if (view.state === 'locked') {
        return view.reason === 'level' ? `For shinobi of level ${view.needLevel} or higher.`
            : view.reason === 'marks' ? `Needs ${view.needMarks} marks on your Coast Record.`
                : 'An earlier quest comes first.';
    }
    if (view.state !== 'open') return undefined;
    if (!offerAt) return `${giverName} has noticed something. Find him out in the sectors.`;
    // A site often carries its sector's own name; say it once.
    const place = offerAt.name && offerAt.name !== offerAt.sectorName ? `${offerAt.name}, ${offerAt.sectorName}` : offerAt.sectorName;
    return `${giverName} offers this at ${place}.`;
}

/** What a finished quest paid, as the sentence the journal shows. Built from the claim's own reply. */
export function questClaimSentence(body: Readonly<Record<string, unknown>>): string {
    const count = (key: string) => Math.max(0, Math.floor(Number(body[key]) || 0));
    const parts: string[] = [];
    if (count('ryo')) parts.push(`${count('ryo').toLocaleString('en-US')} ryo`);
    for (const [key, name] of [['statPoints', 'stat points'], ['fateShards', 'Fate Shard'], ['boneCharms', 'Bone Charms'], ['auraStones', 'Aura Stones']]) {
        if (count(key)) parts.push(`${count(key)} ${name}`);
    }
    for (const id of new Set([...(Array.isArray(body.items) ? body.items : []), body.gear])) {
        if (typeof id === 'string') parts.push(itemName(id));
    }
    if (typeof body.title === 'string' && body.title) parts.push(`the title ${body.title}`);
    return parts.length ? `You earned ${parts.join(', ')}.` : 'The quest is finished.';
}
const sectorLabel = (sector: number) => coastSectorName(sector) ?? sectorName(sector) ?? `Sector ${sector}`;

function buildingPlace(buildingId: string): QuestPlaceView | undefined {
    const place = sectorBuilding(buildingId) ?? coastSite(buildingId);
    return place ? { sector: place.sector, sectorName: sectorLabel(place.sector), name: place.name } : undefined;
}

function stagePlace(deps: Pick<QuestEngineDeps, 'catalogue'>, stage: QuestLineStage): QuestPlaceView | undefined {
    switch (stage.kind) {
        case 'speak':
        case 'reach':
            return { sector: stage.place.sector, sectorName: sectorLabel(stage.place.sector) };
        case 'enter':
        case 'make':
        case 'deliver':
            return buildingPlace(stage.buildingId);
        case 'gather': {
            const site = stage.siteIds.map(id => coastSite(id)).find(Boolean);
            return site ? { sector: site.sector, sectorName: sectorLabel(site.sector), name: site.name } : undefined;
        }
        case 'drop':
        case 'boss': {
            const fight = deps.catalogue.fights[stage.fightId];
            return fight ? { sector: fight.sector, sectorName: sectorLabel(fight.sector) } : undefined;
        }
        default:
            return undefined;
    }
}

function recipeView(stage: MakeStage, recipe: QuestLineRecipe, character: Character): QuestRecipeView {
    const place = buildingPlace(stage.buildingId);
    return {
        stageKey: stage.key,
        ...(place ? { place } : {}),
        inputs: recipe.inputs.map(input => ({ itemId: input.itemId, name: itemName(input.itemId), count: input.count, have: countOwned(character, input.itemId) })),
        output: { itemId: recipe.output.itemId, name: itemName(recipe.output.itemId), count: recipe.output.count },
    };
}

function stageView(deps: Pick<QuestEngineDeps, 'catalogue'>, stage: QuestLineStage, index: number, character: Character, choices?: Record<string, string>, found?: readonly string[]): QuestStageView {
    const place = stagePlace(deps, stage);
    const view: QuestStageView = { index, kind: stage.kind, text: stage.text, ...(place ? { place } : {}) };
    if (stage.kind === 'enter' && stage.clues?.length) {
        view.clues = stage.clues.map(clue => ({ key: clue.key, floor: clue.floor, station: clue.station, found: !!found?.includes(clue.key) }));
    }
    if (stage.kind === 'gather' || stage.kind === 'deliver' || stage.kind === 'drop') {
        view.need = { itemId: stage.itemId, name: itemName(stage.itemId), count: stage.count, have: countOwned(character, stage.itemId) };
    }
    if (stage.kind === 'make') {
        const recipe = deps.catalogue.recipes[stage.recipeId];
        if (recipe) view.recipe = recipeView(stage, recipe, character);
    }
    if (stage.kind === 'choice') {
        view.choice = { prompt: stage.choice.prompt, options: stage.choice.options.map(option => ({ key: option.key, label: option.label, blurb: option.blurb })) };
    }
    if (stage.kind === 'drop' || stage.kind === 'boss') {
        // The fight the sealed choices call for, so the level shown is the one fought.
        const fight = deps.catalogue.fights[questStageFightId(stage, choices)];
        const cast = fight ? coastCastMember(fight.castId) : undefined;
        if (fight) {
            const level = Math.max(1, Math.min(100, Math.floor(Number(character.level) || 1) + fight.levelOffset));
            view.fight = {
                // The fight shows the same person the scene before it did: their cut-out when they have one.
                name: cast?.name ?? 'Quest foe', model: cast?.model ?? '', face: coastCastPortrait(fight.castId) ?? castFaceOf(cast?.model ?? ''), sector: fight.sector, level,
                ...(fight.hold ? { hold: { name: fight.hold.name, tool: itemName(fight.hold.breakerItemId), toolItemId: fight.hold.breakerItemId, have: countOwned(character, fight.hold.breakerItemId) } } : {}),
            };
            // A chain: the Holds that rise after the first, each with the tool that breaks it.
            const rest = questFightHolds(fight).slice(1);
            if (rest.length) view.fight.thenHolds = rest.map(hold => ({ name: hold.name, tool: itemName(hold.breakerItemId), toolItemId: hold.breakerItemId, have: countOwned(character, hold.breakerItemId) }));
        }
    }
    return view;
}

/** Offer a learned recipe when the backpack falls short of an upcoming hand-in or Hold. */
function remakeView(deps: Pick<QuestEngineDeps, 'catalogue'>, line: QuestLine, active: ActiveQuestLine, character: Character): QuestRecipeView | undefined {
    if (line.stages[active.stage]?.kind === 'make') return undefined;
    // Only a recipe whose product a stage ahead still needs: a tool for the
    // boss's Hold, or something yet to be handed in. A lure already set is done.
    const ahead = line.stages.slice(active.stage);
    const needed = (itemId: string) => {
        const held = countOwned(character, itemId);
        return ahead.some(stage =>
            (stage.kind === 'deliver' && stage.itemId === itemId && held < stage.count)
            || (stage.kind === 'boss' && held < 1 && questFightHolds(deps.catalogue.fights[questStageFightId(stage, active.choices)]).some(hold => hold.breakerItemId === itemId)));
    };
    // A chain of Holds may need an earlier tool even when the last one made is still in the backpack.
    const earlier = line.stages.slice(0, Math.min(active.stage, line.stages.length))
        .filter((stage): stage is MakeStage => {
            const output = stage.kind === 'make' ? deps.catalogue.recipes[stage.recipeId]?.output.itemId : undefined;
            return !!output && needed(output);
        })
        .at(-1);
    const recipe = earlier ? deps.catalogue.recipes[earlier.recipeId] : undefined;
    if (!earlier || !recipe) return undefined;
    return recipeView(earlier, recipe, character);
}

const speakerName = (speaker: string) => (speaker === 'you' ? 'You' : speaker === 'narrator' ? '' : coastCastMember(speaker)?.name ?? '');
export function spoken(say: QuestSay): QuestTalkLine {
    // A painted cut-out when the speaker has one (a path), else the wanderer face of their model (a name).
    const model = coastCastMember(say.speaker)?.model;
    const face = model ? coastCastPortrait(say.speaker) ?? castFaceOf(model) : undefined;
    return { speaker: speakerName(say.speaker), text: say.text, ...(face ? { face } : {}) };
}
const standingsOf = (character: Character) =>
    new Set((Array.isArray(character.questStandings) ? character.questStandings : []).filter((s): s is string => typeof s === 'string'));
/** The journal can date a standing when a saved choice identifies who awarded it. */
function journalAtClaim(deps: Pick<QuestEngineDeps, 'catalogue'>, record: QuestLinesRecord, standings: Set<string>) {
    const claims = Object.entries(record.done);
    const firstEarned = new Map<string, number>();
    for (const [id, claim] of claims) {
        if (!claim.choices || !Object.hasOwn(deps.catalogue.lines, id)) continue;
        const line = deps.catalogue.lines[id];
        for (const flag of aggregateStageChoiceEffects(line.stages, claim.choices).standings) {
            firstEarned.set(flag, Math.min(firstEarned.get(flag) ?? Infinity, claim.at));
        }
    }
    return (id: string) => {
        const claim = record.done[id];
        return {
            choices: claim.choices,
            done: Object.fromEntries(claims.filter(([, other]) => other.at <= claim.at)),
            standings: new Set([...standings].filter(flag => (firstEarned.get(flag) ?? 0) <= claim.at)),
        };
    };
}
/** The painting of the region a sector is in, for a scene from a quest that has none of its own. */
const regionPainting = (sector: number | undefined): string | undefined => REGION_PAINTINGS[Math.floor(((sector ?? 0) - 101) / 10)];

/**
 * The music a scene plays under, by the region it happens in, first to last.
 * Every one is a story theme the game already ships (the client's
 * lib/vn-cinematic-score.ts); the coast adds no music of its own. The people of
 * the coast walked out of the villages, so each region carries the theme of the
 * village its ground is most like:
 *   - Saltstair Landing and Brackwater Fields: Stormveil's, rain over the harbor
 *     the boat leaves from. Home-map steps of the first quest play it too.
 *   - Briarwood Deep: Ashen Leaf's, the forest village.
 *   - Whitecrown Passes: Frostfang's, the snow village.
 *   - Hushcrown Heights and the finale: Moonshadow's "Name Under Glass", for a
 *     war that ends with a name written into the record.
 * The Hollow Gate's theme is never used: the coast is not where the Gate came from.
 */
export const REGION_SCORES = ['stormveil', 'stormveil', 'ashen', 'frostfang', 'moonshadow'] as const;
export const regionScore = (sector: number | undefined): string => REGION_SCORES[Math.floor(((sector ?? 0) - 101) / 10)] ?? REGION_SCORES[0];

/**
 * A finished quest told again from its first line to its last: the offer, what
 * was said at each step, and how it closed, with the player's own choices in
 * their places. Nothing here is new to the player, so nothing is sent ahead of
 * its step: an unfinished quest has no recall.
 *
 * Lines that depend on a choice inside the quest are picked by what the record
 * says was chosen. Cross-quest callbacks use the history through this claim.
 * Older saves can still carry a standing without a dated choice receipt.
 */
export function questRecall(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    character: Character,
    questId: string,
): { id: string; title: string; talk: QuestTalkLine[]; backdrop?: string; score: string } | undefined {
    const line = Object.hasOwn(deps.catalogue.lines, questId) ? deps.catalogue.lines[questId] : undefined;
    const finished = Object.hasOwn(record.done, questId) ? record.done[questId] : undefined;
    if (!line || !finished) return undefined;
    const heard = journalAtClaim(deps, record, standingsOf(character))(questId);
    const told: QuestSay[] = [
        ...questSaysHeard(line.scenes?.offer, heard),
        ...line.stages.flatMap((stage): QuestSay[] => {
            const says = questSaysHeard(stage.say, heard);
            // A question has one right answer and is not a choice to remember, so only a real choice is told back.
            const option = stage.kind === 'choice' && stage.choice.answer === undefined
                ? stage.choice.options.find(entry => entry.key === finished.choices?.[stage.key]) : undefined;
            return option ? [...says, { speaker: 'narrator', text: `You chose: ${option.label}.` }] : says;
        }),
        ...questSaysHeard(line.scenes?.done, heard),
    ];
    if (!told.length) return undefined;
    const art = Object.hasOwn(QUEST_PAINTINGS, questId) ? QUEST_PAINTINGS[questId] : undefined;
    const lastPlace = [...line.stages].reverse().map(stage => stagePlace(deps, stage)).find(Boolean);
    const backdrop = art ?? regionPainting(lastPlace?.sector);
    return { id: questId, title: line.title, talk: told.map(spoken), ...(backdrop ? { backdrop } : {}), score: regionScore(lastPlace?.sector) };
}

export function questLineClientViews(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    character: Character,
    ctx: { level: number; inClan: boolean },
): { marks: number; lines: QuestLineClientView[]; coast: { level: number; boat: boolean; region: number; docks: CoastBoatLanding[]; sealed: number[]; figures?: CoastFigure[]; places?: CoastQuestMark[]; people?: CoastResident[] } } {
    const base = questLineViews(deps, record, ctx);
    const standings = standingsOf(character);
    const atClaim = journalAtClaim(deps, record, standings);
    /** What is said for a quest in the state this player has it in. Nothing is sent ahead of its step. */
    const talkOf =(line: QuestLine, state: QuestLineView['state'], active: ActiveQuestLine | undefined): QuestTalkLine[] => {
        // A finished quest keeps its record in the journal: how it closed, and what the player chose in it.
        // A question has one right answer and is not a choice to remember, so it is not listed.
        if (state === 'done') {
            const choices = record.done[line.id]?.choices;
            const chose = line.stages.flatMap((stage): QuestSay[] => {
                const option = stage.kind === 'choice' && stage.choice.answer === undefined
                    ? stage.choice.options.find(entry => entry.key === choices?.[stage.key]) : undefined;
                return option ? [{ speaker: 'narrator', text: `You chose: ${option.label}.` }] : [];
            });
            return [...questSaysHeard(line.scenes?.done, atClaim(line.id)), ...chose].map(spoken);
        }
        const says = state === 'open' ? line.scenes?.offer
            : state === 'ready' ? line.scenes?.done
                : state === 'active' && active ? line.stages[active.stage]?.say
                    : undefined;
        return questSaysHeard(says, { standings, choices: active?.choices, done: record.done }).map(spoken);
    };
    const lines = base.lines.map((view): QuestLineClientView => {
        const line = deps.catalogue.lines[view.id];
        const active = record.active[view.id];
        const talk = talkOf(line, view.state, active);
        const first = line.stages[0];
        const offerAt = line.giver === 'wandering-sage' || !first ? undefined : stagePlace(deps, first);
        const { stage: _stage, ...rest } = view; void _stage;
        const current = active && active.stage < line.stages.length ? line.stages[active.stage] : undefined;
        const remake = active ? remakeView(deps, line, active, character) : undefined;
        const stage = current && active ? stageView(deps, current, active.stage, character, active.choices, active.found) : undefined;
        if (current?.kind === 'deliver' && stage?.need) {
            const reservation = questDeliveryReservation(deps, record, line.id, current.itemId, current.count, stage.need.have);
            if (reservation) stage.deliveryReservation = reservation;
        }
        const giverName = coastCastMember(line.giver)?.name ?? 'A keeper';
        const note = questStateNote(view, giverName, offerAt);
        const art =Object.hasOwn(QUEST_PAINTINGS, view.id) ? QUEST_PAINTINGS[view.id] : undefined;
        // A quest with no painting of its own plays its scenes in front of the painting of the region they happen in:
        // the step's own place, else the last place the quest took the player to (a closing is said where it
        // ended, and a choice where the step before it was), else where it was offered.
        const passed = view.state === 'ready' ? line.stages.length : active?.stage ?? 0;
        const lastPlace = line.stages.slice(0, passed).reverse().map(earlier => stagePlace(deps, earlier)).find(Boolean);
        if (stage?.choice && lastPlace) stage.choice.place = lastPlace.name ?? lastPlace.sectorName;
        const saidAt = (stage?.place ?? lastPlace ?? offerAt)?.sector;
        const backdrop = art ?? regionPainting(saidAt);
        return {
            ...rest,
            giver: line.giver,
            giverName,
            ...(talk.length ? { talk } : {}),
            ...(offerAt ? { offerAt } : {}),
            ...(stage ? { stage } : {}),
            ...(remake ? { remake } : {}),
            ...(active?.took ? { committed: true } : {}),
            ...(art ? { art } : {}),
            ...(backdrop && talk.length ? { backdrop } : {}),
            ...(talk.length ? { score: regionScore(saidAt) } : {}),
            ...(note ? { note } : {}),
        };
    });
    const admission = {
        level: ctx.level, boat: hasQuestLineUnlock(record, COAST_BOAT_UNLOCK), region: openedCoastRegion(record),
        secondDock: hasQuestLineUnlock(record, COAST_SECOND_DOCK.unlock),
        lastGarrison: hasQuestLineUnlock(record, COAST_LAST_GARRISON.unlock),
    };
    return {
        marks: base.marks,
        lines,
        // `docks` is where the boat can land this player: one entry is a plain crossing, two is a choice.
        // `sealed` lists sectors still shut inside a region the player has opened, so a map can draw them shut.
        // `figures` is who stands where for this player and `places` is where a quest has something to do
        // (_coast-presence.ts). Both are for drawing only, and are sent once the boat has sailed.
        coast: {
            level: admission.level, boat: admission.boat, region: admission.region,
            docks: coastBoatLandings(admission), sealed: coastSealedSectors(admission),
            // `people` is who else stands on the coast for this player, and the one line each says (_coast-residents.ts).
            ...(admission.boat ? (({ figures, marks }) => ({ figures, places: marks, people: coastResidents(deps, record) }))(coastQuestPresence(deps, record, base.lines)) : {}),
        },
    };
}
