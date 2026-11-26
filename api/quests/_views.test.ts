import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COAST_CAST_PORTRAITS, coastCastPortrait } from '../../shared/coast-cast.js';
import { QUEST_LINE_CATALOGUE } from './_catalog.js';
import { parseQuestLines } from './_record.js';
import { QUEST_PAINTINGS, REGION_SCORES, castFaceOf, questClaimSentence, questLineClientViews, questRecall, questStateNote, regionScore, type QuestLineClientView } from './_views.js';

/*
 * What the client is told about a quest, against the SHIPPED catalogue. The
 * client has no catalogue of its own, so these names and places are all a
 * player ever sees of a stage.
 */

const deps = { catalogue: QUEST_LINE_CATALOGUE };
const hero = (stacks: Array<{ itemId: string; count: number }> = []) => ({ level: 75, inventory: [], itemStacks: stacks });
const views = (questLines: unknown, character = hero()) => questLineClientViews(deps, parseQuestLines(questLines), character, { level: 75, inClan: false });
const line = (list: { lines: QuestLineClientView[] }, id: string) => list.lines.find(entry => entry.id === id)!;

test('a level 75 player with nothing done sees the Sage\'s quest, and no boat', () => {
    const list = views({});
    assert.deepEqual(list.coast, { level: 75, boat: false, region: 0, docks: [], sealed: [150] });
    const boat = line(list, 'shuttered-boat');
    assert.deepEqual([boat.state, boat.giver, boat.giverName, boat.offerAt], ['open', 'wandering-sage', 'The Wandering Sage', undefined]);
    assert.deepEqual([line(list, 'first-footing').state, line(list, 'first-footing').reason], ['locked', 'quests']);
    assert.equal(JSON.stringify(list).includes('Bring the charts back'), false, 'no stage text is sent before the quest is taken');
});

test('a stage names its place, what must be held, and how much is', () => {
    const fiber = line(views({ active: { 'shuttered-boat': { stage: 1, at: 1 } } }, hero([{ itemId: 'gather-binding-fiber', count: 3 }])), 'shuttered-boat');
    assert.equal(fiber.stage?.kind, 'deliver');
    assert.equal(fiber.stage?.place?.sector, 7);
    assert.ok(fiber.stage?.place?.name, 'the duty house is named');
    assert.deepEqual(fiber.stage?.need, { itemId: 'gather-binding-fiber', name: 'Binding Fiber', count: 8, have: 3 });
    assert.equal(JSON.stringify(fiber).includes('Smoke Hold'), false, 'a later stage is not described ahead of time');
});

test('a hand-in shows cord reserved for another active quest before a player clicks', () => {
    const stages = { 'saltstair-rounds-2': { stage: 3, at: 1 }, 'first-footing': { stage: 4, at: 1 } };
    const active = (count: number) => line(views({ active: stages }, hero([{ itemId: 'quest-wrack-cord', count }])), 'saltstair-rounds-2').stage;
    assert.deepEqual(active(6)?.deliveryReservation, {
        target: 10, message: 'First Footing still needs 4 of these. Gather 4 more before you hand any in.',
    });
    assert.equal(active(6)?.need?.count, 6, 'the actual hand-in is still six');
    assert.equal(active(10)?.deliveryReservation, undefined);
    const other = line(views({ active: { ...stages, 'first-footing': { stage: 2, at: 1 } } }, hero([{ itemId: 'quest-wrack-cord', count: 6 }])), 'saltstair-rounds-2');
    assert.equal(other.stage?.deliveryReservation, undefined, "future stages do not reserve the current backpack");
});

test('a recipe lists every input with what the player holds, and what it makes', () => {
    const make = line(views({ active: { 'shuttered-boat': { stage: 5, at: 1, took: true } } }, hero([{ itemId: 'gather-stormglass-shard', count: 1 }])), 'shuttered-boat');
    assert.equal(make.committed, true);
    assert.deepEqual(make.stage?.recipe?.inputs.map(input => [input.itemId, input.count, input.have]), [['gather-stormglass-shard', 2, 1], ['gather-binding-fiber', 2, 0]]);
    assert.deepEqual(make.stage?.recipe?.output, { itemId: 'quest-signal-shard', name: 'Stormglass Signal Shard', count: 3 });
    assert.equal(make.remake, undefined, 'the recipe under way is not also offered as a remake');
});

test('a Hold fight says what breaks it, and offers the recipe again only when the tool has run out', () => {
    const empty = line(views({ active: { 'shuttered-boat': { stage: 8, at: 1, took: true } } }), 'shuttered-boat');
    assert.deepEqual(empty.stage?.fight, {
        // His cut-out when he has one, so the fight shows the person the scene before it did; else his model's wanderer face.
        name: 'Shiokaze', model: 'nightblade', face: coastCastPortrait('chart-runner') ?? 'nightblade', sector: 3, level: 76,
        hold: { name: 'Smoke Hold', tool: 'Stormglass Signal Shard', toolItemId: 'quest-signal-shard', have: 0 },
    });
    assert.equal(empty.remake?.stageKey, 'shards');
    assert.equal(empty.remake?.place?.sector, 7);

    const armed = line(views({ active: { 'shuttered-boat': { stage: 8, at: 1, took: true } } }, hero([{ itemId: 'quest-signal-shard', count: 2 }])), 'shuttered-boat');
    assert.equal(armed.stage?.fight?.hold?.have, 2);
    assert.equal(armed.remake, undefined);
});

test('a lure recipe stays available until the backpack covers its next delivery', () => {
    for (const id of ['untamed-coast-1', 'untamed-coast-2', 'untamed-coast-3']) {
        const stage = deps.catalogue.lines[id].stages.findIndex(step => step.key === 'set');
        for (const count of [0, 1, 2, 3]) {
            const backpack = hero([{ itemId: 'quest-scent-lure', count }]);
            const quest = line(views({ active: { [id]: { stage, at: 1, took: true } } }, backpack), id);
            assert.equal(quest.stage?.need?.count, 2);
            assert.equal(quest.remake?.stageKey, count < 2 ? 'lure' : undefined, id + ' holding ' + count);
        }
    }
});

test('once the first quest is done the boat sails, and the coast\'s first quest is offered at the slip', () => {
    const list = views({ done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } } });
    assert.deepEqual([list.coast.level, list.coast.boat, list.coast.region], [75, true, 1]);
    assert.deepEqual(list.coast.docks.map(dock => dock.sector), [101], 'one landing: the boat simply crosses');
    assert.ok(list.coast.docks[0].name);
    const footing = line(list, 'first-footing');
    assert.equal(footing.state, 'open');
    assert.deepEqual([footing.offerAt?.sector, footing.offerAt?.sectorName, footing.giverName], [101, 'Saltstair Slip', 'Urabe']);
    assert.ok(footing.offerAt?.name);
});

test('the quay is offered as a second landing only once it is open and its region is', () => {
    const boat = { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] };
    const quay = { at: 3, marks: 2, unlocks: ['second-dock'] };
    // The unlock alone is not enough: the crossing refuses a region the player has not opened.
    const early = views({ done: { 'shuttered-boat': boat, 'uncounted-1': quay } });
    assert.deepEqual(early.coast.docks.map(dock => dock.sector), [101]);
    const open = views({ done: { 'shuttered-boat': boat, 'crossing-war-1': { at: 2, marks: 2, opensRegion: 2 }, 'uncounted-1': quay } });
    assert.deepEqual(open.coast.docks.map(dock => dock.sector), [101, 116]);
    assert.notEqual(open.coast.docks[1].name, open.coast.docks[0].name);
    // Below level 75 the boat does not sail anywhere.
    const low = questLineClientViews(deps, parseQuestLines({ done: { 'shuttered-boat': boat } }), hero(), { level: 74, inClan: false });
    assert.deepEqual(low.coast.docks, []);
});

test('a quest speaks: the offer before it is taken, then only the step the player is on', () => {
    const open = line(views({}), 'shuttered-boat');
    assert.ok(open.talk && open.talk.length >= 2, 'the Sage makes his offer');
    assert.equal(open.talk[0].speaker, 'The Wandering Sage');
    const taken = line(views({ active: { 'shuttered-boat': { stage: 0, at: 1 } } }), 'shuttered-boat');
    assert.notDeepEqual(taken.talk, open.talk, 'the offer is not repeated once the quest is under way');
    const all = JSON.stringify(views({ active: { 'shuttered-boat': { stage: 0, at: 1 } } }));
    assert.equal(all.includes('Orito writes a clean hand'), false, 'nothing is sent ahead of its step');
});

test('a quest that is not under way says where it stands in one sentence, and one under way says its step instead', () => {
    const boat = { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] };
    // On offer by someone who finds the player, and on offer at a place.
    assert.equal(line(views({}), 'shuttered-boat').note, 'The Wandering Sage has noticed something. Find him out in the sectors.');
    const footing = line(views({ done: { 'shuttered-boat': boat } }), 'first-footing');
    assert.match(footing.note ?? '', /^Urabe offers this at .+\.$/);
    assert.ok(footing.note!.includes(footing.offerAt!.sectorName));
    // Locked, with the reason a player can act on.
    assert.equal(line(views({}), 'first-footing').note, 'An earlier quest comes first.');
    const young = questLineClientViews(deps, parseQuestLines({ done: { 'shuttered-boat': boat, 'first-footing': { at: 2, marks: 1 } } }), hero(), { level: 76, inClan: false });
    const war = young.lines.find(row => row.id === 'crossing-war-1')!;
    assert.deepEqual([war.state, war.reason, war.note], ['locked', 'level', `For shinobi of level ${war.needLevel} or higher.`]);
    assert.equal(questStateNote({ state: 'locked', reason: 'marks', needLevel: 88, needMarks: 20 }, 'Orito'), 'Needs 20 marks on your Coast Record.');
    // Under way, ready and finished.
    assert.equal(line(views({ active: { 'shuttered-boat': { stage: 0, at: 1 } } }), 'shuttered-boat').note, undefined);
    assert.equal(questStateNote({ state: 'ready', needLevel: 50, needMarks: 0 }, 'Orito'), 'It is done. Take what you earned.');
    assert.equal(line(views({ done: { 'shuttered-boat': boat } }), 'shuttered-boat').note, 'Finished');
});

test('a finished quest says what it paid in one sentence', () => {
    assert.equal(questClaimSentence({ ryo: 12000, statPoints: 2, fateShards: 1, boneCharms: 0, auraStones: 3, title: 'Coastwalker' }),
        'You earned 12,000 ryo, 2 stat points, 1 Fate Shard, 3 Aura Stones, the title Coastwalker.');
    // An item is named as the backpack names it, and a piece that is both the reward and the gear roll is said once.
    const mantle = questClaimSentence({ items: ['coast-quiet-crown-mantle'], gear: 'coast-quiet-crown-mantle' });
    assert.match(mantle, /^You earned [A-Z][^,]+\.$/);
    assert.equal(mantle.includes('coast-quiet-crown-mantle'), false, 'the item’s name, not its id');
    assert.equal(questClaimSentence({ ryo: 0 }), 'The quest is finished.');
});

test('what is said comes with a painting to stand in front of: the quest’s own, or its region’s', () => {
    const everything = [
        views({}),
        ...Object.values(QUEST_LINE_CATALOGUE.lines).flatMap(quest => quest.stages.map((_stage, stage) => views({ active: { [quest.id]: { stage, at: 1 } } }))),
    ].flatMap(list => list.lines);
    const speaking = everything.filter(row => row.talk?.length);
    assert.ok(speaking.length > 200);
    for (const row of speaking) {
        if (row.art) assert.equal(row.backdrop, row.art, `${row.id} plays in front of its own painting`);
    }
    // The 20 quests have their own; a side tale or a Rounds tier on the coast borrows its region's and shows none in the journal.
    assert.deepEqual([...new Set(everything.filter(row => row.art).map(row => row.id))].length, 20);
    const borrowed = speaking.filter(row => !row.art && row.backdrop);
    assert.ok(borrowed.length > 20);
    assert.ok(borrowed.every(row => ['bitter-tide', 'mirror-hold', 'beast-bond', 'rime-lock', 'twin-ward'].includes(row.backdrop!)));
    assert.equal(everything.some(row => row.backdrop && !row.talk?.length), false, 'a painting is sent only with something said');
});

test('a spoken line names its speaker’s painted face, so a scene can show who is talking', () => {
    const open = line(views({}), 'shuttered-boat');
    // The Sage has a cut-out already, so his face is its path; a member with none yet is a wanderer face by name.
    assert.equal(open.talk?.[0].face, '/portraits/cinematic/side-stories/wandering-sage.webp');
    const footing = line(views({ done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } } }), 'first-footing');
    assert.equal(footing.talk?.[0].face, COAST_CAST_PORTRAITS.includes('slip-boatwright') ? '/portraits/cinematic/coast/slip-boatwright-v1.webp' : 'pilgrim');
    assert.equal(castFaceOf('bandit-warlord'), 'boss');
    assert.equal(castFaceOf('a-model-nobody-mapped'), 'bandit');
    // Every line of every quest in every state: a cast member always has a face, the player and narration never do.
    const everything = [
        views({}),
        ...Object.values(QUEST_LINE_CATALOGUE.lines).flatMap(quest => quest.stages.map((_stage, stage) => views({ active: { [quest.id]: { stage, at: 1 } } }))),
    ].flatMap(list => list.lines.flatMap(row => row.talk ?? []));
    assert.ok(everything.length > 300);
    for (const say of everything) {
        const named = say.speaker !== '' && say.speaker !== 'You';
        assert.equal(typeof say.face === 'string' && say.face.length > 0, named, `${say.speaker || 'narration'}: ${say.text.slice(0, 40)}`);
    }
});

test('the finale reads the player’s own record back: what they chose in the tales, and nothing they did not', () => {
    const unmoored = QUEST_LINE_CATALOGUE.lines['the-unmoored'];
    const at = (key: string) => unmoored.stages.findIndex(stage => stage.key === key);
    const heard = (questLines: unknown, questStandings: string[] = []) =>
        (line(views(questLines, { ...hero(), questStandings } as ReturnType<typeof hero>), 'the-unmoored').talk ?? []).map(say => say.text);

    const plain = heard({ active: { 'the-unmoored': { stage: at('record'), at: 1 } } });
    assert.equal(plain.length, 2, 'with no tales done Orito has only his opening and his closing');
    const read = heard({ active: { 'the-unmoored': { stage: at('record'), at: 1 } } }, ['tale-letter-carried', 'tale-bell-silent', 'tale-docket-returned']);
    assert.equal(read.length, 5);
    assert.ok(read.some(text => /carried a dead woman’s letter home/.test(text)));
    assert.ok(read.some(text => /buried it again/.test(text)));
    assert.ok(read.some(text => /back under its stone/.test(text)));
    assert.equal(read.some(text => /left it sealed in my keeping|answered now when it rings/.test(text)), false, 'the other side of each choice is never read');

    // Nanashi answers The Uncounted only for a player who finished it.
    const crown = { active: { 'the-unmoored': { stage: at('crown'), at: 1 } } };
    assert.equal(heard(crown).some(text => /forged paper/.test(text)), false);
    assert.equal(heard({ ...crown, done: { 'uncounted-3': { at: 1, marks: 3 } } }).some(text => /forged paper/.test(text)), true);

    // The closing scene is the one the sealed answer earned.
    const closing = (option: string) => heard({ active: { 'the-unmoored': { stage: unmoored.stages.length, at: 1, choices: { ask: option } } } });
    assert.ok(closing('open').some(text => /You asked me to open it/.test(text)));
    assert.equal(closing('open').some(text => /keep it shut/.test(text)), false);
    assert.ok(closing('closed').some(text => /You asked me to keep it shut/.test(text)));
    assert.match(closing('closed').at(-1) ?? '', /She let me write her name/, 'Orito closes either way');
});

test('a finished quest can be told again whole, and an unfinished one cannot be read ahead', () => {
    const tell = (questLines: unknown, id: string) => questRecall(deps, parseQuestLines(questLines), hero(), id);
    const boat = QUEST_LINE_CATALOGUE.lines['shuttered-boat'];

    assert.equal(tell({}, 'shuttered-boat'), undefined, 'a quest never taken has nothing to tell');
    assert.equal(tell({ active: { 'shuttered-boat': { stage: 3, at: 1 } } }, 'shuttered-boat'), undefined, 'a quest under way is not read ahead');
    assert.equal(tell({ done: { 'no-such-quest': { at: 1, marks: 1 } } }, 'no-such-quest'), undefined);
    assert.equal(tell({ done: { 'shuttered-boat': { at: 1, marks: 1 } } }, '__proto__'), undefined);

    const told = tell({ done: { 'shuttered-boat': { at: 1, marks: 1 } } }, 'shuttered-boat')!;
    assert.deepEqual([told.id, told.title, told.backdrop], ['shuttered-boat', boat.title, 'shuttered-boat']);
    const texts = told.talk.map(say => say.text);
    // In order: the offer opens it, every step that speaks is in it, and the closing ends it.
    assert.equal(texts[0], boat.scenes!.offer![0].text);
    assert.equal(texts.at(-1), boat.scenes!.done!.at(-1)!.text);
    const spokenSteps = boat.stages.filter(stage => stage.say?.some(say => !say.when));
    assert.ok(spokenSteps.length >= 3, 'the first quest speaks at several steps');
    let from = 0;
    for (const stage of spokenSteps) {
        const at = texts.indexOf(stage.say!.find(say => !say.when)!.text, from);
        assert.ok(at >= from, `step "${stage.key}" is told, after the steps before it`);
        from = at;
    }
    assert.ok(told.talk.some(say => say.face), 'the speakers keep their faces');
});

test('Orito keeps the mason’s account open when the player buries the clapper', () => {
    const id = 'tale-second-bell';
    for (const answer of ['hang', 'bury']) {
        const record = parseQuestLines({ done: { [id]: { at: 10, marks: 0, choices: { clapper: answer } } } });
        const list = questLineClientViews(deps, record, hero(), { level: 100, inClan: false });
        for (const talk of [line(list, id).talk!, questRecall(deps, record, hero(), id)!.talk]) {
            assert.equal(talk.some(s => s.text.includes('signed it off')), answer === 'hang');
            assert.equal(talk.some(s => s.text.includes('line for the clapper blank')), answer === 'bury');
        }
    }
});

test('finished scenes remember which other stories had happened at claim', () => {
    const finale = 'the-unmoored', letter = 'tale-unsent-letter', pattern = 'tale-first-pattern';
    const character = { ...hero(), questStandings: ['tale-letter-carried', 'coast-opened'] };
    for (const sideQuestAt of [10, 30]) {
        const record = parseQuestLines({ done: {
            [finale]: { at: 20, marks: 5, choices: { ask: 'open' } },
            [letter]: { at: sideQuestAt, marks: 0, choices: { letter: 'carry' } },
            [pattern]: { at: sideQuestAt, marks: 0 }, 'uncounted-3': { at: sideQuestAt, marks: 1 },
        } });
        const finaleTalk = questRecall(deps, record, character, finale)!.talk;
        assert.equal(finaleTalk.some(s => s.text.includes('letter home')), sideQuestAt < 20);
        assert.equal(finaleTalk.some(s => s.text.includes('forged paper')), sideQuestAt < 20);
        const list = questLineClientViews(deps, record, character, { level: 100, inClan: false });
        for (const talk of [line(list, pattern).talk!, questRecall(deps, record, character, pattern)!.talk]) {
            assert.equal(talk.some(s => s.text.startsWith('The coast is open')), sideQuestAt > 20);
        }
    }
});

test('a quest told again keeps the choice the player made, and none of the road not taken', () => {
    const unmoored = QUEST_LINE_CATALOGUE.lines['the-unmoored'];
    const tell = (option: string) => questRecall(deps, parseQuestLines({ done: { 'the-unmoored': { at: 1, marks: 5, choices: { ask: option } } } }), hero(), 'the-unmoored')!
        .talk.map(say => say.text);
    const label = (option: string) => unmoored.stages.flatMap(stage => (stage.kind === 'choice' ? stage.choice.options : [])).find(entry => entry.key === option)!.label;
    const open = tell('open'), closed = tell('closed');
    assert.ok(open.includes(`You chose: ${label('open')}.`));
    assert.equal(open.includes(`You chose: ${label('closed')}.`), false);
    assert.ok(open.some(text => /You asked me to open it/.test(text)));
    assert.equal(open.some(text => /keep it shut/.test(text)), false);
    assert.ok(closed.some(text => /You asked me to keep it shut/.test(text)));
});

test('a quest with no painting of its own is told in front of the painting of the region it ended in', () => {
    const [id, line] = Object.entries(QUEST_LINE_CATALOGUE.lines).find(([key, entry]) => !Object.hasOwn(QUEST_PAINTINGS, key) && entry.scenes?.done?.length)!;
    const told = questRecall(deps, parseQuestLines({ done: { [id]: { at: 1, marks: line.marks } } }), hero(), id)!;
    assert.match(told.backdrop ?? '', /^(bitter-tide|mirror-hold|beast-bond|rime-lock|twin-ward)$/);
});

test('what is said comes with the music of the region it is said in, and never the Hollow Gate’s', () => {
    assert.deepEqual([101, 110, 111, 120, 121, 131, 141, 150].map(regionScore), ['stormveil', 'stormveil', 'stormveil', 'stormveil', 'ashen', 'frostfang', 'moonshadow', 'moonshadow']);
    // A step on the home map, a place with no sector and a sector past the coast all still have music.
    assert.deepEqual([2, 74, undefined, 151, 999].map(regionScore), ['stormveil', 'stormveil', 'stormveil', 'stormveil', 'stormveil']);
    assert.equal((REGION_SCORES as readonly string[]).includes('hollow'), false);

    // The first quest is offered by the Sage on the home map.
    assert.equal(line(views({}), 'shuttered-boat').score, 'stormveil');
    // A quest under way plays the music of where its step is, and one that says nothing names none.
    const crossed = { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } };
    for (const entry of views({ done: crossed }).lines) assert.equal(entry.score !== undefined, !!entry.talk?.length, entry.id);
    // The finale, told again, plays the theme of the last region.
    const told = questRecall(deps, parseQuestLines({ done: { 'the-unmoored': { at: 1, marks: 5, choices: { ask: 'open' } } } }), hero(), 'the-unmoored')!;
    assert.equal(told.score, 'moonshadow');
    assert.equal(questRecall(deps, parseQuestLines({ done: { 'shuttered-boat': { at: 1, marks: 1 } } }), hero(), 'shuttered-boat')!.score, 'stormveil');
});

test('a gather stage points at its site on the coast', () => {
    const cord = line(views({ done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } }, active: { 'first-footing': { stage: 3, at: 2 } } }), 'first-footing');
    assert.deepEqual([cord.stage?.kind, cord.stage?.place?.sector, cord.stage?.need?.count], ['gather', 102, 6]);
});
