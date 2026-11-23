import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    abandonQuestLine,
    acceptQuestLine,
    advanceQuestLine,
    chooseQuestLineOption,
    claimQuestLine,
    makeQuestLineItem,
    questLineLentItems,
    questLineViews,
    questPresenceReason,
    questResupplyDrop,
    resetQuestLine,
    resupplyQuestLineDrop,
    settleQuestLineFight,
    type QuestEngineDeps,
    type QuestPresence,
} from './_engine.js';
import { questLineCatalogueProblems, type QuestLineCatalogue } from './_catalog-rules.js';
import { emptyQuestLines, parseQuestLines, questLineMarks, type QuestLinesRecord } from './_record.js';
import { countOwned } from '../craft/_forge.js';
import { INVENTORY_CAP } from '../_inventory-capacity.js';
import type { QuestLine } from './_types.js';

// A 12-wide sector board, as the game uses.
const tileDistance = (a: number, b: number) => Math.max(Math.abs((a % 12) - (b % 12)), Math.abs(Math.floor(a / 12) - Math.floor(b / 12)));

const trial: QuestLine = {
    id: 'trial', series: 'test', kind: 'quest', world: 'coast', tier: 2, title: 'The Trial', marks: 2, giver: 'keeper',
    gate: { level: 50 },
    stages: [
        { key: 'learn', kind: 'speak', text: 'Hear the keeper out.', castId: 'keeper', place: { sector: 101, tile: 40 } },
        { key: 'gather', kind: 'gather', text: 'Harvest six saltreed.', itemId: 'saltreed', count: 6, siteIds: ['site-a'] },
        { key: 'give', kind: 'deliver', text: 'Hand two saltreed to the keeper.', buildingId: 'counter-101', itemId: 'saltreed', count: 2 },
        { key: 'make', kind: 'make', text: 'Make the vial at the counter.', buildingId: 'counter-101', recipeId: 'vial' },
        { key: 'path', kind: 'choice', text: 'Decide whose papers to forge.', choice: { prompt: 'Whose papers?', options: [
            { key: 'clerk', label: 'The clerk', blurb: 'Quiet and slow.', bonusRyoPct: 50, standing: 'forged-clerk' },
            { key: 'captain', label: 'The captain', blurb: 'Loud and fast.', title: 'Gatebreaker' },
        ] } },
        { key: 'tally', kind: 'drop', text: 'Take the tally from his lookouts.', fightId: 'lookouts', itemId: 'runner-tally', count: 1 },
        { key: 'break', kind: 'boss', text: 'Break his hold.', fightId: 'captain' },
    ],
    rewards: { weight: 6, statPoints: 10, fateShards: 1, boneCharms: 2, auraStones: 1, title: 'Tide Runner', items: ['coast-cloak'], opensRegion: 2, unlocks: ['contest-land'] },
};

const catalogue: QuestLineCatalogue = {
    lines: { trial, later: { ...trial, id: 'later', world: 'home', title: 'Later', gate: { level: 50, quests: ['trial'], marks: 2 }, stages: [trial.stages[0]], rewards: { weight: 1 } } },
    recipes: { vial: { id: 'vial', inputs: [{ itemId: 'saltreed', count: 4 }], output: { itemId: 'woundroot-vial', count: 2 } } },
    fights: {
        lookouts: { id: 'lookouts', castId: 'lookout', sector: 101, levelOffset: 0, statBonus: 0, loadoutId: 'bruiser' },
        captain: { id: 'captain', castId: 'captain', sector: 107, levelOffset: 2, statBonus: 0.25, loadoutId: 'bruiser', hold: { breakerItemId: 'woundroot-vial', name: 'Bitter Tide' } },
    },
};

const deps: QuestEngineDeps = {
    catalogue,
    buildingPlace: id => (id === 'counter-101' ? { sector: 101, tile: 66, radius: 1 } : null),
    ryo: (level, weight) => weight * (40 + level * 5),
    grantStatPoints: (character, points) => ({ ...character, unspentStats: Number(character.unspentStats || 0) + points }),
    tileDistance,
};

const at = (sector: number, tile?: number): QuestPresence => ({ sector, tile });
const hero = (patch: Record<string, unknown> = {}) => ({ level: 50, ryo: 100, fateShards: 0, boneCharms: 0, auraStones: 0, inventory: [], itemStacks: [], ...patch });

/** Apply a decision the way the handler does: keep what it changed. */
function apply<T extends { record?: QuestLinesRecord; character?: Record<string, unknown> }>(decision: T, state: { record: QuestLinesRecord; character: Record<string, unknown> }) {
    if (decision.record) state.record = decision.record;
    if (decision.character) state.character = decision.character;
    return decision;
}

test('the test catalogue itself passes the catalogue rules', () => {
    assert.deepEqual(questLineCatalogueProblems(catalogue), []);
});

test('presence is refused for an offline, travelling, fighting or misplaced player', () => {
    const place = { sector: 101, tile: 40 };
    assert.equal(questPresenceReason(place, null, 10, tileDistance), 'presence');
    assert.equal(questPresenceReason(place, { sector: 101, tile: 40, travelingUntil: 11 }, 10, tileDistance), 'traveling');
    assert.equal(questPresenceReason(place, { sector: 101, tile: 40, inBattle: true }, 10, tileDistance), 'in-battle');
    assert.equal(questPresenceReason(place, at(102, 40), 10, tileDistance), 'wrong-place');
    assert.equal(questPresenceReason(place, at(101, 43), 10, tileDistance), 'wrong-place');
    assert.equal(questPresenceReason(place, at(101), 10, tileDistance), 'wrong-place', 'a required tile is never guessed');
    assert.equal(questPresenceReason(place, at(101, 42), 10, tileDistance), null);
    assert.equal(questPresenceReason({ sector: 101 }, at(101), 10, tileDistance), null, 'no tile means anywhere in the sector');
});

test('accept checks the gate on the server and seals stage 0', () => {
    assert.equal(acceptQuestLine(deps, emptyQuestLines(), hero({ level: 49 }), 'trial', { inClan: false, now: 5 }).reason, 'level');
    assert.equal(acceptQuestLine(deps, emptyQuestLines(), hero(), 'nope', { inClan: false, now: 5 }).reason, 'unknown');
    assert.equal(acceptQuestLine(deps, emptyQuestLines(), hero(), 'later', { inClan: false, now: 5 }).reason, 'quests');
    const accepted = acceptQuestLine(deps, emptyQuestLines(), hero(), 'trial', { inClan: false, now: 5 });
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.record?.active.trial, { stage: 0, at: 5 });
    assert.equal(acceptQuestLine(deps, accepted.record!, hero(), 'trial', { inClan: false, now: 6 }).reason, 'active');
});

test('a whole quest: every stage is proven, and the reward is paid exactly once', () => {
    const state = { record: emptyQuestLines(), character: hero() as Record<string, unknown> };
    apply(acceptQuestLine(deps, state.record, state.character, 'trial', { inClan: false, now: 1 }), state);

    // speak: must stand by the keeper.
    assert.equal(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 100), now: 2 }).reason, 'wrong-place');
    assert.equal(apply(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 41), now: 2 }), state).ok, true);
    assert.equal(state.record.active.trial.stage, 1);

    // gather: holding the materials is the proof.
    const short = advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 41), now: 3 });
    assert.deepEqual([short.reason, short.body?.progress, short.body?.target], ['incomplete', 0, 6]);
    state.character = { ...state.character, itemStacks: [{ itemId: 'saltreed', count: 6 }] };
    assert.equal(apply(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: null, now: 3 }), state).ok, true);

    // deliver: at the counter, and the items leave the backpack.
    assert.equal(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 40), now: 4 }).reason, 'wrong-place');
    assert.equal(apply(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 66), now: 4 }), state).ok, true);
    assert.equal(countOwned(state.character, 'saltreed'), 4);
    assert.equal(state.record.active.trial.took, true);
    assert.equal(abandonQuestLine(state.record, 'trial').reason, 'committed', 'items are gone, so the quest must be finished');

    // make: advance refuses and names the action; make spends inputs and grants the tool.
    assert.equal(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: at(101, 66), now: 5 }).reason, 'make');
    assert.equal(makeQuestLineItem(deps, state.record, state.character, 'trial', { presence: at(101, 20), now: 5 }).reason, 'wrong-place');
    assert.equal(apply(makeQuestLineItem(deps, state.record, state.character, 'trial', { presence: at(101, 66), now: 5 }), state).ok, true);
    assert.equal(countOwned(state.character, 'saltreed'), 0);
    assert.equal(countOwned(state.character, 'woundroot-vial'), 2);

    // choice.
    assert.equal(advanceQuestLine(deps, state.record, state.character, 'trial', { presence: null, now: 6 }).reason, 'choose');
    assert.equal(chooseQuestLineOption(deps, state.record, 'trial', 'nobody', { now: 6 }).reason, 'bad-option');
    assert.equal(apply(chooseQuestLineOption(deps, state.record, 'trial', 'clerk', { now: 6 }), state).ok, true);

    // drop: a client call can never pass a fight stage.
    const fight = advanceQuestLine(deps, state.record, state.character, 'trial', { presence: null, now: 7 });
    assert.deepEqual([fight.reason, fight.body?.fightId], ['fight', 'lookouts']);
    const sealedAt = state.record.active.trial.at;
    assert.equal(settleQuestLineFight(deps, state.record, state.character, { questId: 'trial', stage: 5, sealedAt: sealedAt - 1, fightId: 'lookouts', now: 8 }).reason, 'stale');
    assert.equal(settleQuestLineFight(deps, state.record, state.character, { questId: 'trial', stage: 5, sealedAt, fightId: 'captain', now: 8 }).reason, 'stale');
    apply(settleQuestLineFight(deps, state.record, state.character, { questId: 'trial', stage: 5, sealedAt, fightId: 'lookouts', now: 8 }), state);
    assert.equal(countOwned(state.character, 'runner-tally'), 1);

    // boss, then claim.
    assert.equal(claimQuestLine(deps, state.record, state.character, 'trial', { now: 9 }).reason, 'not-final');
    apply(settleQuestLineFight(deps, state.record, state.character, { questId: 'trial', stage: 6, sealedAt: state.record.active.trial.at, fightId: 'captain', now: 9 }), state);
    assert.equal(state.record.active.trial.stage, 7);

    const paid = apply(claimQuestLine(deps, state.record, state.character, 'trial', { now: 10 }), state);
    assert.equal(paid.ok, true);
    // ryo: weight 6 at level 50 is 1,740, times the clerk's +50%.
    assert.equal(state.character.ryo, 100 + 2610);
    assert.equal(state.character.fateShards, 1);
    assert.equal(state.character.boneCharms, 2);
    assert.equal(state.character.auraStones, 1);
    assert.equal(state.character.unspentStats, 10);
    assert.deepEqual(state.character.serverTitles, ['Tide Runner']);
    assert.deepEqual(state.character.questStandings, ['forged-clerk']);
    assert.deepEqual(state.character.inventory, ['coast-cloak']);
    assert.deepEqual(state.record.active, {});
    assert.deepEqual(state.record.done.trial, { at: 10, marks: 2, choices: { path: 'clerk' }, opensRegion: 2, unlocks: ['contest-land'] });
    assert.equal(questLineMarks(state.record), 2);

    // A second claim pays nothing and changes nothing.
    const again = claimQuestLine(deps, state.record, state.character, 'trial', { now: 11 });
    assert.deepEqual([again.ok, again.body?.replayed, again.record, again.character], [true, true, undefined, undefined]);

    // The record survives a round trip through storage.
    assert.deepEqual(parseQuestLines(JSON.parse(JSON.stringify(state.record))), state.record);
    // And the finished quest now opens the one behind it.
    assert.equal(acceptQuestLine(deps, state.record, state.character, 'later', { inClan: false, now: 12 }).ok, true);
});

test('a choice can override the title', () => {
    const record = parseQuestLines({ active: { trial: { stage: 7, at: 1, choices: { path: 'captain' } } } });
    const paid = claimQuestLine(deps, record, hero(), 'trial', { now: 2 });
    assert.deepEqual(paid.character?.serverTitles, ['Gatebreaker']);
    assert.equal(paid.character?.ryo, 100 + 1740);
});

test('make names the materials that are missing', () => {
    const record = parseQuestLines({ active: { trial: { stage: 3, at: 1 } } });
    const refused = makeQuestLineItem(deps, record, hero({ itemStacks: [{ itemId: 'saltreed', count: 1 }] }), 'trial', { presence: at(101, 66), now: 2 });
    assert.equal(refused.reason, 'materials');
    assert.deepEqual(refused.body?.missing, [{ itemId: 'saltreed', need: 4, have: 1 }]);
    assert.equal(refused.record, undefined);
    assert.equal(refused.character, undefined);
});

test('a tool lost in a fight can be made again at its counter, and that passes no stage', () => {
    // On the boss stage, with the vials spent and four saltreed gathered again.
    const record = parseQuestLines({ active: { trial: { stage: 6, at: 9, took: true } } });
    const restocked = hero({ itemStacks: [{ itemId: 'saltreed', count: 4 }] });
    assert.equal(makeQuestLineItem(deps, record, restocked, 'trial', { presence: at(107, 5), now: 10 }).reason, 'wrong-place', 'still made at its own counter');
    const again = makeQuestLineItem(deps, record, restocked, 'trial', { presence: at(101, 66), now: 10 });
    assert.equal(again.ok, true);
    assert.equal(again.record, undefined, 'the quest record does not move');
    assert.deepEqual([again.body?.advanced, again.body?.stage], [false, 6]);
    assert.deepEqual([countOwned(again.character!, 'woundroot-vial'), countOwned(again.character!, 'saltreed')], [2, 0]);

    // The materials are paid again, a recipe not yet reached stays shut, and a named stage must be a real one.
    assert.equal(makeQuestLineItem(deps, record, hero(), 'trial', { presence: at(101, 66), now: 10 }).reason, 'materials');
    const early = parseQuestLines({ active: { trial: { stage: 2, at: 1 } } });
    assert.equal(makeQuestLineItem(deps, early, restocked, 'trial', { presence: at(101, 66), now: 2 }).reason, 'not-make');
    assert.equal(makeQuestLineItem(deps, record, restocked, 'trial', { presence: at(101, 66), now: 10, stageKey: 'make' }).ok, true);
    assert.equal(makeQuestLineItem(deps, record, restocked, 'trial', { presence: at(101, 66), now: 10, stageKey: 'break' }).reason, 'not-make');
});

test('the fight that dropped a lost ingredient opens again, pays it back and passes nothing', () => {
    // A quest whose tool is made from something only a fight drops.
    const sealed: QuestLine = {
        ...trial, id: 'sealed',
        stages: [
            { key: 'seal', kind: 'drop', text: 'Lift a seal from the patrol.', fightId: 'lookouts', itemId: 'patrol-seal', count: 1 },
            { key: 'reeds', kind: 'gather', text: 'Harvest two saltreed.', itemId: 'saltreed', count: 2, siteIds: ['site-a'] },
            { key: 'order', kind: 'make', text: 'Forge the order.', buildingId: 'counter-101', recipeId: 'order' },
            { key: 'captain', kind: 'boss', text: 'Break his hold.', fightId: 'captain' },
        ],
    };
    const supply = {
        catalogue: {
            lines: { sealed },
            recipes: { order: { id: 'order', inputs: [{ itemId: 'patrol-seal', count: 1 }, { itemId: 'saltreed', count: 2 }], output: { itemId: 'woundroot-vial', count: 1 } } },
            fights: catalogue.fights,
        } satisfies QuestLineCatalogue,
    };
    const onBoss = { stage: 3, at: 9, took: true };
    const record = parseQuestLines({ active: { sealed: onBoss } });

    assert.deepEqual(questResupplyDrop(supply, sealed, onBoss, hero(), 'woundroot-vial'), { index: 0, stage: sealed.stages[0] });
    assert.equal(questResupplyDrop(supply, sealed, onBoss, hero({ itemStacks: [{ itemId: 'patrol-seal', count: 1 }] }), 'woundroot-vial'), null, 'only the reeds are missing, and those are gathered');
    assert.equal(questResupplyDrop(supply, sealed, { stage: 0, at: 1 }, hero(), 'woundroot-vial'), null, 'a drop not yet passed is the stage itself');

    const won = resupplyQuestLineDrop(supply, record, hero(), { questId: 'sealed', dropStage: 0, fightId: 'lookouts' });
    assert.deepEqual([won.ok, won.record, countOwned(won.character!, 'patrol-seal')], [true, undefined, 1]);
    const retried = resupplyQuestLineDrop(supply, record, won.character!, { questId: 'sealed', dropStage: 0, fightId: 'lookouts' });
    assert.deepEqual([retried.ok, retried.character], [true, undefined], 'a retried settlement grants nothing more');
    assert.equal(resupplyQuestLineDrop(supply, record, hero(), { questId: 'sealed', dropStage: 3, fightId: 'captain' }).reason, 'stale');
    assert.equal(resupplyQuestLineDrop(supply, record, hero(), { questId: 'sealed', dropStage: 0, fightId: 'captain' }).reason, 'stale');
});

test('a drop tops the player up and never over-grants on a repeat win', () => {
    const record = parseQuestLines({ active: { trial: { stage: 5, at: 3 } } });
    const holding = hero({ itemStacks: [{ itemId: 'runner-tally', count: 1 }] });
    const won = settleQuestLineFight(deps, record, holding, { questId: 'trial', stage: 5, sealedAt: 3, fightId: 'lookouts', now: 4 });
    assert.equal(won.ok, true);
    assert.deepEqual(won.body?.dropped, { itemId: 'runner-tally', count: 0 });
    assert.equal(countOwned(won.character ?? holding, 'runner-tally'), 1);
});

test('at the claim, what the quest lent goes back and the player\'s own materials stay', () => {
    // Saltreed is an ordinary material here; the vial and the tally exist only for this quest.
    const lending = { catalogue: { ...catalogue, isQuestOnlyItem: (id: string) => id === 'woundroot-vial' || id === 'runner-tally' } };
    assert.deepEqual(questLineLentItems(lending, trial).sort(), ['runner-tally', 'woundroot-vial']);
    assert.deepEqual(questLineLentItems({ catalogue }, trial), [], 'a catalogue that cannot tell quest items apart takes nothing');

    const record = parseQuestLines({ active: { trial: { stage: 7, at: 1 } } });
    const carrying = hero({ itemStacks: [{ itemId: 'woundroot-vial', count: 1 }, { itemId: 'runner-tally', count: 1 }, { itemId: 'saltreed', count: 3 }] });
    const paid = claimQuestLine({ ...deps, ...lending }, record, carrying, 'trial', { now: 2 });
    assert.equal(paid.ok, true);
    assert.deepEqual([countOwned(paid.character!, 'woundroot-vial'), countOwned(paid.character!, 'runner-tally'), countOwned(paid.character!, 'saltreed')], [0, 0, 3]);
    assert.deepEqual(paid.body?.returned, [{ itemId: 'woundroot-vial', count: 1 }, { itemId: 'runner-tally', count: 1 }]);

    // An item another quest also uses is not this quest's to take back.
    const shared = { catalogue: { ...lending.catalogue, lines: { ...catalogue.lines, other: { ...trial, id: 'other', stages: [trial.stages[5]] } } } };
    assert.deepEqual(questLineLentItems(shared, trial), ['woundroot-vial']);
});

test('a shared item goes back when the last quest that needs it ends, and a kept material never does', () => {
    const questOnly = (id: string) => id === 'woundroot-vial' || id === 'runner-tally' || id === 'saltreed';
    const twin = { ...trial, id: 'twin' };
    const sharing = { catalogue: { ...catalogue, lines: { trial, twin }, isQuestOnlyItem: questOnly } };
    // Two quests use the same three items. Asked about the whole catalogue, neither owns them.
    assert.deepEqual(questLineLentItems(sharing, trial), []);
    // While the twin is under way it still needs them; once it is not, they go back with this quest.
    assert.deepEqual(questLineLentItems(sharing, trial, ['trial', 'twin']), []);
    assert.deepEqual(questLineLentItems(sharing, trial, ['trial']).sort(), ['runner-tally', 'saltreed', 'woundroot-vial']);

    const carrying = hero({ itemStacks: [{ itemId: 'woundroot-vial', count: 1 }, { itemId: 'saltreed', count: 3 }] });
    const both = parseQuestLines({ active: { trial: { stage: 7, at: 1 }, twin: { stage: 2, at: 1 } } });
    const first = claimQuestLine({ ...deps, ...sharing }, both, carrying, 'trial', { now: 2 });
    assert.deepEqual([first.body?.returned, countOwned(first.character!, 'woundroot-vial')], [undefined, 1], 'the twin still needs the vial');
    const alone = parseQuestLines({ active: { trial: { stage: 7, at: 1 } } });
    const last = claimQuestLine({ ...deps, ...sharing }, alone, carrying, 'trial', { now: 2 });
    assert.deepEqual([countOwned(last.character!, 'woundroot-vial'), countOwned(last.character!, 'saltreed')], [0, 0]);

    // What a kept site yields is a reward: it stays in the backpack.
    const keeping = { catalogue: { ...sharing.catalogue, isKeptItem: (id: string) => id === 'saltreed' } };
    const kept = claimQuestLine({ ...deps, ...keeping }, alone, carrying, 'trial', { now: 2 });
    assert.deepEqual([countOwned(kept.character!, 'woundroot-vial'), countOwned(kept.character!, 'saltreed')], [0, 3]);
    assert.deepEqual(resetQuestLine(keeping, alone, carrying, 'trial').body?.returned, [{ itemId: 'woundroot-vial', count: 1 }], 'an admin reset keeps it too');
});

test('an admin reset ends a run wherever it stands, and forgets a finished quest only when told to', () => {
    const lending = { catalogue: { ...catalogue, isQuestOnlyItem: (id: string) => id === 'woundroot-vial' || id === 'runner-tally' } };
    const carrying = hero({ itemStacks: [{ itemId: 'woundroot-vial', count: 2 }, { itemId: 'saltreed', count: 3 }] });

    // A committed run cannot be abandoned by the player, and can be reset.
    const stuck = parseQuestLines({ active: { trial: { stage: 4, at: 1, took: true } }, done: { later: { at: 1, marks: 1 } } });
    assert.equal(abandonQuestLine(stuck, 'trial').reason, 'committed');
    const cleared = resetQuestLine(lending, stuck, carrying, 'trial');
    assert.deepEqual(cleared.body, { id: 'trial', cleared: true, forgot: false, returned: [{ itemId: 'woundroot-vial', count: 2 }] });
    assert.deepEqual([cleared.record?.active, Object.keys(cleared.record?.done ?? {})], [{}, ['later']], 'only the named quest is touched');
    assert.deepEqual([countOwned(cleared.character!, 'woundroot-vial'), countOwned(cleared.character!, 'saltreed')], [0, 3], 'the player keeps their own materials');
    assert.equal(acceptQuestLine(deps, cleared.record!, cleared.character!, 'trial', { inClan: false, now: 5 }).ok, true, 'and it can be taken again from the start');

    // A finished quest stays finished unless the admin says to forget it.
    const finished = parseQuestLines({ done: { trial: { at: 1, marks: 2, opensRegion: 2 } } });
    const untouched = resetQuestLine(lending, finished, carrying, 'trial');
    assert.deepEqual([untouched.record, untouched.character, untouched.body], [undefined, undefined, { id: 'trial', cleared: false, forgot: false }]);
    const forgotten = resetQuestLine(lending, finished, hero(), 'trial', { forget: true });
    assert.deepEqual([forgotten.body, forgotten.record?.done, forgotten.character], [{ id: 'trial', cleared: false, forgot: true }, {}, undefined]);
    assert.equal(questLineMarks(forgotten.record!), 0, 'its marks leave the Coast Record with it');

    // A quest the catalogue no longer has still clears, and takes nothing.
    const orphan = resetQuestLine(lending, parseQuestLines({ active: { retired: { stage: 1, at: 1 } } }), carrying, 'retired');
    assert.deepEqual([orphan.body, orphan.record?.active, orphan.character], [{ id: 'retired', cleared: true, forgot: false }, {}, undefined]);
});

test('a gear chance is rolled once at claim, and a hit is carried in the backpack, the reply and the record', () => {
    const trial = deps.catalogue.lines.trial;
    const chancy = (rollGear: QuestEngineDeps['rollGear']): QuestEngineDeps => ({
        ...deps, rollGear,
        catalogue: { ...deps.catalogue, lines: { ...deps.catalogue.lines, trial: { ...trial, rewards: { ...trial.rewards, gearChanceBp: 2_000 } } } },
    });
    const record = parseQuestLines({ active: { trial: { stage: 7, at: 1 } } });
    const asked: unknown[][] = [];

    const hit = claimQuestLine(chancy((_character, chanceBp, questId) => { asked.push([chanceBp, questId]); return 'gear-piece'; }), record, hero(), 'trial', { now: 2 });
    assert.deepEqual(asked, [[2_000, 'trial']], 'asked once, with the quest\'s own chance');
    assert.equal(hit.body?.gear, 'gear-piece');
    assert.deepEqual((hit.character?.inventory as string[]).slice(-2), ['coast-cloak', 'gear-piece'], 'beside the promised item');
    assert.equal(hit.record?.done.trial.gear, 'gear-piece');
    assert.deepEqual(parseQuestLines(JSON.parse(JSON.stringify(hit.record))), hit.record, 'the record keeps it through storage');

    const miss = claimQuestLine(chancy(() => null), record, hero(), 'trial', { now: 2 });
    assert.deepEqual([miss.ok, miss.body?.gear, Object.hasOwn(miss.record!.done.trial, 'gear'), (miss.character?.inventory as string[]).includes('gear-piece')], [true, null, false, false]);

    // Like every gear drop it is already earned: a backpack with room for the promised item only still takes it.
    const nearlyFull = hero({ inventory: Array.from({ length: INVENTORY_CAP - 1 }, () => 'junk') });
    const squeezed = claimQuestLine(chancy(() => 'gear-piece'), record, nearlyFull, 'trial', { now: 2 });
    assert.deepEqual([squeezed.ok, (squeezed.character?.inventory as string[]).length], [true, INVENTORY_CAP + 1]);

    // A quest that names no chance never rolls, and an engine given no roller never drops.
    const never = claimQuestLine({ ...deps, rollGear: () => { throw new Error('rolled for a quest with no chance'); } }, record, hero(), 'trial', { now: 2 });
    assert.equal(never.body?.gear, null);
    assert.equal(claimQuestLine(chancy(undefined), record, hero(), 'trial', { now: 2 }).body?.gear, null);
    // A second claim pays nothing, so it cannot roll again.
    assert.equal(claimQuestLine(chancy(() => { throw new Error('rolled twice'); }), hit.record!, hit.character!, 'trial', { now: 3 }).body?.replayed, true);
});

test('a full backpack refuses the claim and pays nothing', () => {
    const record = parseQuestLines({ active: { trial: { stage: 7, at: 1 } } });
    const full = hero({ inventory: Array.from({ length: INVENTORY_CAP }, () => 'junk') });
    const refused = claimQuestLine(deps, record, full, 'trial', { now: 2 });
    assert.deepEqual([refused.reason, refused.record, refused.character], ['inventory-full', undefined, undefined]);
});

test('a quest with nothing spent can be abandoned and accepted again', () => {
    const record = parseQuestLines({ active: { trial: { stage: 1, at: 1 } } });
    const left = abandonQuestLine(record, 'trial');
    assert.equal(left.ok, true);
    assert.deepEqual(left.record?.active, {});
    assert.equal(abandonQuestLine(emptyQuestLines(), 'trial').ok, true, 'abandoning nothing is not an error');
});

test('the client is shown state and the current stage only', () => {
    const record = parseQuestLines({ active: { trial: { stage: 1, at: 1 } } });
    const view = questLineViews(deps, record, { level: 50, inClan: false });
    assert.equal(view.marks, 0);
    const byId = Object.fromEntries(view.lines.map(line => [line.id, line]));
    assert.equal(byId.trial.state, 'active');
    assert.deepEqual(byId.trial.stage, { index: 1, kind: 'gather', text: 'Harvest six saltreed.' });
    assert.deepEqual([byId.later.state, byId.later.reason], ['locked', 'quests']);
    assert.equal(JSON.stringify(view).includes('Break his hold'), false, 'later stage text is not sent ahead of time');

    const ready = questLineViews(deps, parseQuestLines({ active: { trial: { stage: 7, at: 1 } } }), { level: 50, inClan: false });
    assert.equal(ready.lines.find(line => line.id === 'trial')?.state, 'ready');
    const done = questLineViews(deps, parseQuestLines({ done: { trial: { at: 1, marks: 2 } } }), { level: 50, inClan: false });
    assert.deepEqual(done.lines.map(line => line.state), ['done', 'open']);
});
