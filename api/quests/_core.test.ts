import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    aggregateStageChoiceEffects,
    choiceOption,
    stageComplete,
    stageIsChoice,
    stageTimerMs,
    timerResetStage,
    type StageLike,
} from './_stage-core.js';
import {
    QUEST_BOOK,
    aggregateChoiceEffects,
    questStageComplete,
    stageTimerMs as questbookStageTimerMs,
    timerResetStage as questbookTimerResetStage,
} from '../sector/_questbook.js';
import {
    emptyQuestLines,
    hasQuestLineUnlock,
    openedCoastRegion,
    parseQuestLines,
    questLineGate,
    questLineMarks,
} from './_record.js';
import { questLineCatalogueProblems, reachableQuestLines, type QuestLineCatalogue } from './_catalog-rules.js';
import { MAX_ACTIVE_QUEST_LINES, type QuestLine, type QuestLineStage } from './_types.js';

// ── Stage core ───────────────────────────────────────────────────────────────

test('a counter stage completes when the delta from its baseline reaches the count', () => {
    assert.equal(stageComplete(10, 12, 3), false);
    assert.equal(stageComplete(10, 13, 3), true);
    assert.equal(stageComplete(Number.NaN, 2, 2), true);
});

test('the Quest Book wrappers answer exactly as the shared core does, for every epic', () => {
    for (const entry of Object.values(QUEST_BOOK)) {
        entry.stages.forEach((stage, index) => {
            assert.equal(questbookStageTimerMs(stage), stageTimerMs(stage));
            assert.equal(questbookTimerResetStage(entry, index), timerResetStage(entry.stages, index));
            assert.equal(questStageComplete(0, stage.count, stage.count), stageComplete(0, stage.count, stage.count));
        });
        // Take the first option of every branch, then the last, and compare.
        for (const pick of ['first', 'last'] as const) {
            const choices: Record<string, string> = {};
            for (const stage of entry.stages) {
                if (!stageIsChoice(stage)) continue;
                const options = stage.choice!.options;
                choices[stage.key] = (pick === 'first' ? options[0] : options[options.length - 1]).key;
            }
            assert.deepEqual(aggregateChoiceEffects(entry, choices), aggregateStageChoiceEffects(entry.stages, choices));
        }
    }
});

test('choice effects multiply ryo, add shards, and the last title wins', () => {
    const stages: StageLike[] = [
        { key: 'a', choice: { options: [{ key: 'x', bonusRyoPct: 50, standing: 'kept-faith' }, { key: 'y' }] } },
        { key: 'b' },
        { key: 'c', choice: { options: [{ key: 'z', bonusRyoPct: 10, bonusFateShards: 1, title: 'Tide Runner' }] } },
    ];
    assert.deepEqual(aggregateStageChoiceEffects(stages, { a: 'x', c: 'z' }), {
        ryoMult: 1.5 * 1.1, bonusFateShards: 1, titleOverride: 'Tide Runner', standings: ['kept-faith'],
    });
    assert.equal(choiceOption(stages[0], 'nope'), null);
    assert.equal(choiceOption(stages[1], 'x'), null);
    assert.deepEqual(aggregateStageChoiceEffects(stages, null), { ryoMult: 1, bonusFateShards: 0, titleOverride: null, standings: [] });
});

test('a failed timer resets to its named stage, or to itself', () => {
    const stages: StageLike[] = [{ key: 'a' }, { key: 'b', timer: { durationMs: 60_000, failResetToStage: 0 } }, { key: 'c', timer: { durationMs: 1_000, failResetToStage: 9 } }];
    assert.equal(stageTimerMs(stages[0]), 0);
    assert.equal(stageTimerMs(stages[1]), 60_000);
    assert.equal(timerResetStage(stages, 1), 0);
    assert.equal(timerResetStage(stages, 2), 2);
});

// ── The save record ──────────────────────────────────────────────────────────

test('a missing or malformed record reads as empty', () => {
    for (const raw of [undefined, null, 'x', 7, [], { active: 4, done: 'no' }]) {
        assert.deepEqual(parseQuestLines(raw), emptyQuestLines());
    }
});

test('a malformed entry is dropped without touching its neighbours', () => {
    const record = parseQuestLines({
        active: { 'good-one': { stage: 2, at: 100, choices: { path: 'left', bad: 3 } }, 'bad-stage': { stage: -1, at: 1 }, 'Bad Id': { stage: 0, at: 1 } },
        done: { finished: { at: 50, marks: 2, opensRegion: 2, unlocks: ['boat', 9] }, broken: { at: 'x', marks: 1 } },
    });
    assert.deepEqual(Object.keys(record.active), ['good-one']);
    assert.deepEqual(record.active['good-one'], { stage: 2, at: 100, choices: { path: 'left' } });
    assert.deepEqual(record.done, { finished: { at: 50, marks: 2, opensRegion: 2, unlocks: ['boat'] } });
});

test('a quest stored as both finished and under way counts as finished', () => {
    const record = parseQuestLines({ active: { twice: { stage: 0, at: 1 } }, done: { twice: { at: 2, marks: 1 } } });
    assert.deepEqual(record.active, {});
    assert.equal(questLineMarks(record), 1);
});

test('marks, the opened region and unlocks come from what is stored, not the catalogue', () => {
    const record = parseQuestLines({ done: {
        a: { at: 1, marks: 1, unlocks: ['boat'] },
        b: { at: 2, marks: 3, opensRegion: 2 },
        'retired-quest': { at: 3, marks: 4, opensRegion: 1 },
    } });
    assert.equal(questLineMarks(record), 8);
    assert.equal(openedCoastRegion(record), 2);
    assert.equal(hasQuestLineUnlock(record, 'boat'), true);
    assert.equal(hasQuestLineUnlock(record, 'contest-land'), false);
});

const speak = (key: string): QuestLineStage => ({ key, kind: 'speak', text: 'Hear the keeper out.', castId: 'keeper', place: { sector: 2 } });

function line(id: string, patch: Partial<QuestLine> = {}): QuestLine {
    return {
        id, series: 'test', kind: 'quest', world: 'home', tier: 1, title: `Quest ${id}`, marks: 1, giver: 'keeper',
        gate: { level: 50 }, stages: [speak('hear')], rewards: { weight: 4 }, ...patch,
    };
}

test('the accept gate names the first thing that is missing', () => {
    const gated = line('gated', { gate: { level: 60, quests: ['first'], marks: 3, region: 2, clan: true } });
    const ctx = { level: 60, inClan: true };
    const withDone = (done: Record<string, unknown>, active: Record<string, unknown> = {}) => parseQuestLines({ done, active });
    assert.equal(questLineGate(gated, withDone({}), { level: 59, inClan: true }), 'level');
    assert.equal(questLineGate(gated, withDone({}), ctx), 'quests');
    assert.equal(questLineGate(gated, withDone({ first: { at: 1, marks: 1 } }), ctx), 'marks');
    assert.equal(questLineGate(gated, withDone({ first: { at: 1, marks: 3 } }), ctx), 'region');
    const ready = withDone({ first: { at: 1, marks: 3, opensRegion: 2 } });
    assert.equal(questLineGate(gated, ready, { level: 60, inClan: false }), 'clan');
    assert.equal(questLineGate(gated, ready, ctx), 'ok');
    assert.equal(questLineGate(gated, withDone({ gated: { at: 1, marks: 1 } }), ctx), 'done');
    assert.equal(questLineGate(gated, withDone({}, { gated: { stage: 0, at: 1 } }), ctx), 'active');
    const full: Record<string, unknown> = {};
    for (let i = 0; i < MAX_ACTIVE_QUEST_LINES; i++) full[`busy-${i}`] = { stage: 0, at: 1 };
    assert.equal(questLineGate(gated, withDone({ first: { at: 1, marks: 3, opensRegion: 2 } }, full), ctx), 'busy');
});

// ── Catalogue rules ──────────────────────────────────────────────────────────

const coastStages: QuestLineStage[] = [
    speak('learn'),
    { key: 'gather', kind: 'gather', text: 'Harvest saltreed at the shore sites.', itemId: 'saltreed', count: 6, siteIds: ['site-a'] },
    { key: 'make', kind: 'make', text: 'Make the vial at the Record House.', buildingId: 'counter-101', recipeId: 'vial' },
    { key: 'prove', kind: 'reach', text: 'Plant your mark on the gate.', place: { sector: 101, tile: 40 } },
    { key: 'break', kind: 'boss', text: 'Break his hold.', fightId: 'captain' },
];

function coastCatalogue(patch: Partial<QuestLineCatalogue> = {}): QuestLineCatalogue {
    return {
        lines: { 'coast-one': line('coast-one', { world: 'coast', stages: coastStages }) },
        recipes: { vial: { id: 'vial', inputs: [{ itemId: 'saltreed', count: 4 }], output: { itemId: 'woundroot-vial', count: 2 } } },
        fights: { captain: { id: 'captain', castId: 'captain', sector: 107, levelOffset: 2, statBonus: 0.25, loadoutId: 'bruiser', hold: { breakerItemId: 'woundroot-vial', name: 'Bitter Tide' } } },
        ...patch,
    };
}

test('a well-formed coast quest passes every rule', () => {
    assert.deepEqual(questLineCatalogueProblems(coastCatalogue()), []);
});

test('a coast quest must be long enough, gather, make and end in a Hold', () => {
    const short = coastCatalogue({ lines: { 'coast-one': line('coast-one', { world: 'coast', stages: coastStages.slice(0, 2) }) } });
    const problems = questLineCatalogueProblems(short).join('\n');
    assert.match(problems, /tier 1 needs at least 5 stages, has 2/);
    assert.match(problems, /needs a make or drop stage/);
    assert.match(problems, /must end in a boss stage/);

    const noHold = coastCatalogue({ fights: { captain: { id: 'captain', castId: 'captain', sector: 107, levelOffset: 2, statBonus: 0, loadoutId: 'bruiser' } } });
    assert.match(questLineCatalogueProblems(noHold).join('\n'), /final boss of a coast quest must carry a Hold/);
});

test('a Hold whose tool the quest never produces is refused, on either map', () => {
    const wrongTool = coastCatalogue({ fights: { captain: { id: 'captain', castId: 'captain', sector: 107, levelOffset: 2, statBonus: 0, loadoutId: 'bruiser', hold: { breakerItemId: 'ember-senbon', name: 'Rime Lock' } } } });
    assert.match(questLineCatalogueProblems(wrongTool).join('\n'), /broken by ember-senbon, which this quest never produces/);
});

test('a recipe input must be gathered, dropped or made earlier in the same quest', () => {
    const outOfOrder = [coastStages[0], coastStages[2], coastStages[1], coastStages[3], coastStages[4]];
    const problems = questLineCatalogueProblems(coastCatalogue({ lines: { 'coast-one': line('coast-one', { world: 'coast', stages: outOfOrder }) } }));
    assert.match(problems.join('\n'), /recipe input saltreed is not gathered, dropped or made earlier/);
});

test('stage text may not use a dash as a pause', () => {
    const dashed: QuestLineStage[] = [{ ...coastStages[0], text: 'Hear her out — then decide.' }, ...coastStages.slice(1)];
    assert.match(questLineCatalogueProblems(coastCatalogue({ lines: { 'coast-one': line('coast-one', { world: 'coast', stages: dashed }) } })).join('\n'), /uses a dash as a pause/);
});

test('no quest may be stranded behind a clan or behind unreachable marks', () => {
    const lines = {
        solo: line('solo', { marks: 2 }),
        clan: line('clan', { marks: 5, gate: { level: 50, clan: true } }),
        finale: line('finale', { gate: { level: 50, quests: ['solo'], marks: 4 } }),
        loop: line('loop', { gate: { level: 50, quests: ['loop'] } }),
    };
    assert.deepEqual([...reachableQuestLines(lines, { withClan: false }).ids].sort(), ['solo']);
    assert.deepEqual([...reachableQuestLines(lines, { withClan: true }).ids].sort(), ['clan', 'finale', 'solo']);
    const problems = questLineCatalogueProblems({ lines, recipes: {}, fights: {} }).join('\n');
    assert.match(problems, /finale: cannot be reached without a clan/);
    assert.match(problems, /loop: requires itself/);
    assert.match(problems, /loop: can never be reached/);
});

test('a side tale is worth no marks, and Fate Shards stay at 0 or 1', () => {
    const lines = { tale: line('tale', { kind: 'tale', marks: 1 }), rich: line('rich', { rewards: { weight: 4, fateShards: 2 } }) };
    const problems = questLineCatalogueProblems({ lines, recipes: {}, fights: {} }).join('\n');
    assert.match(problems, /tale: a side tale is worth no marks/);
    assert.match(problems, /rich: Fate Shards must be 0 or 1/);
});
