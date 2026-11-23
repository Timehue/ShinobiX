import assert from 'node:assert/strict';
import test from 'node:test';
import { COAST_CAST } from '../../shared/coast-cast.js';
import { coastLayout, coastSite } from '../../shared/coast-world.js';
import { QUEST_LINE_CATALOGUE, QUEST_LINES } from './_catalog.js';
import { KEEPER_POSTS, coastKeeperSites, coastQuestPresence, keeperPost } from './_coast-presence.js';
import { parseQuestLines } from './_record.js';
import { questLineClientViews } from './_views.js';

const deps = { catalogue: QUEST_LINE_CATALOGUE, buildingPlace: () => null, ryo: () => 0, grantStatPoints: (c: Record<string, unknown>) => c, tileDistance: () => 0, rollGear: () => null } as never;
const hero = () => ({ name: 'Kaede', level: 100, itemStacks: [], inventory: [] });
const views = (questLines: unknown) => questLineClientViews(deps, parseQuestLines(questLines), hero(), { level: 100, inClan: true });
const boat = { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] };
const cell = (sector: number, tile: number) => coastLayout(sector)!.mask[Math.floor(tile / 12)][tile % 12];

test('every keeper who gives a quest on the coast stands in the doorway of the counter they keep', () => {
    const keepers = coastKeeperSites(deps);
    // Everyone who offers a coast quest at a building, and nobody twice.
    const givers = new Set(Object.values(QUEST_LINE_CATALOGUE.lines).filter(line => line.stages.some(stage => 'buildingId' in stage && coastSite(stage.buildingId))).map(line => line.giver).filter(id => COAST_CAST[id]));
    assert.deepEqual(Object.keys(keepers).sort(), [...givers].sort());
    assert.ok(Object.keys(keepers).length >= 7);
    assert.equal(keepers['record-keeper'].id, 'saltstair-counter-105', 'Orito keeps the Record House');
    assert.equal(keepers['slip-boatwright'].sector, 101, 'Urabe is the first person met ashore');

    const { figures } = coastQuestPresence(deps, parseQuestLines({}), []);
    assert.equal(figures.length, Object.keys(keepers).length, 'with no quest under way, the keepers are the only figures');
    const stood = new Set<string>();
    for (const figure of figures) {
        const site = coastSite(figure.site)!;
        assert.equal(figure.sector, site.sector);
        assert.equal(cell(figure.sector, figure.tile), 'B', `${figure.label} stands on the building's own ground`);
        // One tile in front of them is where the player walks up to: the two never share a tile.
        assert.equal(site.approach, figure.tile + 12, `${figure.label} faces the tile a visitor stands on`);
        assert.equal(stood.has(`${figure.sector}:${figure.tile}`), false, 'no two figures share a tile');
        stood.add(`${figure.sector}:${figure.tile}`);
        const member = Object.values(COAST_CAST).find(entry => figure.label.startsWith(`${entry.name}, `))!;
        assert.equal(figure.model, member.model, 'drawn with the cast member’s own world model');
        assert.equal(figure.boss, undefined);
    }
});

test('a keeper whose site has a room stands inside it too, at the station they work, and only then', () => {
    const keepers = coastKeeperSites(deps);
    const { figures } = coastQuestPresence(deps, parseQuestLines({}), []);
    const posted: Record<string, string> = {};
    for (const [castId, site] of Object.entries(keepers)) {
        const figure = figures.find(entry => entry.site === site.id && !entry.boss)!;
        const floor = site.floors[0];
        if (!floor) { assert.equal(figure.room, undefined, `${castId}: no room, so nowhere inside to stand`); continue; }
        assert.deepEqual(figure.room, keeperPost(castId, site));
        const [x, y] = figure.room!;
        const station = floor.stations.find(entry => {
            const [left, top, width, height] = entry.target;
            return x >= left && x <= left + width && y >= top && y <= top + height;
        })!;
        assert.ok(station, `${castId} stands at one of the room's own stations`);
        posted[castId] = station.name;
        // On the station, never on the floor a visitor walks: the keeper cannot stand on the player or in a doorway.
        const tile = Math.floor(y) * 12 + Math.min(11, Math.floor(x));
        assert.notEqual(floor.mask[Math.floor(y)][Math.min(11, Math.floor(x))], '.', `${castId} is not standing on open floor`);
        assert.equal([floor.spawn, ...floor.doors, ...floor.stairs.map(stair => stair.tile), ...floor.stations.map(entry => entry.approach)].includes(tile), false);
    }
    assert.ok(Object.keys(posted).length >= 5, 'most keepers have a room');
    // The boatwright is at his bench, not the ferry frame; the relay keeper at the dispatch desk, not the ink basin.
    assert.deepEqual([posted['slip-boatwright'], posted['record-keeper'], posted['relay-keeper']], ['Joiner’s bench', 'Writing counter', 'Dispatch desk']);
    // A name in the table that matches no station would silently fall back to the first one.
    for (const [castId, name] of Object.entries(KEEPER_POSTS)) {
        assert.ok(keepers[castId]?.floors[0]?.stations.some(station => station.name === name), `${castId}: "${name}" is a station in their room`);
    }
    assert.equal(keeperPost('record-keeper', { ...keepers['record-keeper'], floors: [] }), undefined);
});

test('a boss stands where its quest says it is fought, from the step that reaches it until it is beaten', () => {
    for (const line of Object.values(QUEST_LINES)) {
        const index = line.stages.findIndex(stage => stage.kind === 'boss');
        const stage = line.stages[index];
        if (stage.kind !== 'boss') continue;
        const fight = QUEST_LINE_CATALOGUE.fights[stage.fightId];
        if (!coastLayout(fight.sector)) continue; // the first quest is fought on the home map
        const at = (stageIndex: number) => coastQuestPresence(deps, parseQuestLines({ active: { [line.id]: { stage: stageIndex, at: 1 } } }), [{ id: line.id, state: 'active' }]);
        const bosses = at(index).figures.filter(figure => figure.boss);
        assert.equal(bosses.length, 1, `${line.id}: its boss is there`);
        assert.equal(bosses[0].sector, fight.sector);
        assert.ok(bosses[0].label.startsWith(COAST_CAST[fight.castId].name));
        assert.deepEqual(at(index).marks, [{ sector: fight.sector, site: bosses[0].site }], `${line.id}: and the map points at it`);
        if (index > 0) assert.equal(at(index - 1).figures.some(figure => figure.boss), false, `${line.id}: not before the step that reaches it`);
    }
    // Finished: nobody is left standing there.
    const done = views({ done: { 'shuttered-boat': boat, 'first-footing': { at: 2, marks: 1 } } });
    assert.equal(done.coast.figures!.some(figure => figure.boss), false);
});

test('the map points at every place a quest can be taken or moved on, and at nothing else', () => {
    // Nothing is sent before the boat has sailed: the coast cannot be seen yet.
    assert.deepEqual([views({}).coast.figures, views({}).coast.places], [undefined, undefined]);

    const landed = views({ done: { 'shuttered-boat': boat } });
    const open = landed.lines.filter(line => line.state === 'open' && line.offerAt && coastLayout(line.offerAt.sector));
    assert.ok(open.length >= 1);
    for (const line of open) assert.ok(landed.coast.places!.some(place => place.sector === line.offerAt!.sector && place.site), `${line.id} is on offer and marked`);
    for (const place of landed.coast.places!) {
        assert.ok(coastLayout(place.sector), 'only coast sectors are marked');
        if (place.site) assert.equal(coastSite(place.site)!.sector, place.sector);
    }
    assert.equal(new Set(landed.coast.places!.map(place => `${place.sector}:${place.site}`)).size, landed.coast.places!.length, 'a place is listed once');

    // A gathering step marks the sites it can be worked at; a locked quest marks nothing.
    const footing = QUEST_LINES['first-footing'];
    const gather = footing.stages.findIndex(stage => stage.kind === 'gather');
    if (gather >= 0) {
        const working = coastQuestPresence(deps, parseQuestLines({ active: { 'first-footing': { stage: gather, at: 1 } } }), [{ id: 'first-footing', state: 'active' }]);
        const stage = footing.stages[gather];
        if (stage.kind === 'gather') assert.deepEqual(working.marks.map(place => place.site).sort(), stage.siteIds.filter(id => coastSite(id)).sort());
    }
    assert.deepEqual(coastQuestPresence(deps, parseQuestLines({}), [{ id: 'crossing-war-5', state: 'locked' }]).marks, []);
    assert.deepEqual(coastQuestPresence(deps, parseQuestLines({}), [{ id: 'first-footing', state: 'done' }]).marks, []);
});

test('a finished quest keeps its record: how it closed and what was chosen, and never the other choice', () => {
    const papers = QUEST_LINES['uncounted-1'].stages.find(stage => stage.kind === 'choice' && stage.choice.answer === undefined);
    assert.ok(papers && papers.kind === 'choice');
    const [taken, other] = papers.choice.options;
    const list = views({ done: { 'shuttered-boat': boat, 'first-footing': { at: 2, marks: 1 }, 'crossing-war-1': { at: 3, marks: 2, opensRegion: 2 },
        'uncounted-1': { at: 4, marks: 2, choices: { [papers.key]: taken.key } } } });
    const record = list.lines.find(line => line.id === 'uncounted-1')!;
    assert.equal(record.state, 'done');
    const said = (record.talk ?? []).map(say => say.text);
    assert.ok(said.length >= 2, 'the closing is still there to read');
    assert.equal(said.at(-1), `You chose: ${taken.label}.`);
    assert.equal(said.some(text => text.includes(other.label)), false);
    assert.equal(record.talk!.at(-1)!.speaker, '', 'the choice is told as narration, in nobody’s voice');
    // A question with one right answer is not a choice to remember.
    const boatRecord = list.lines.find(line => line.id === 'shuttered-boat')!;
    assert.equal((boatRecord.talk ?? []).some(say => say.text.startsWith('You chose:')), false);
    assert.ok((boatRecord.talk ?? []).length >= 1);
    // A finished quest marks nothing on the map and offers no scene of its own.
    assert.equal(list.coast.places!.some(place => place.site === undefined && place.sector === 3), false);
});
