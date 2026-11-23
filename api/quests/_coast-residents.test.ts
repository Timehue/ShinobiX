import assert from 'node:assert/strict';
import test from 'node:test';
import { coastPatrolsIn } from '../coast/_patrols.js';
import { coastExits, coastLayout, coastSite } from '../../shared/coast-world.js';
import { QUEST_LINE_CATALOGUE } from './_catalog.js';
import { QUEST_SAY_MAX_WORDS } from './_catalog-rules.js';
import { coastQuestPresence } from './_coast-presence.js';
import { COAST_RESIDENT_GROUPS, coastResidents, residentTiles } from './_coast-residents.js';
import { parseQuestLines } from './_record.js';
import { castFaceOf, questLineClientViews } from './_views.js';

/*
 * The people of the coast: who stands where for a player, and what each says.
 * Against the SHIPPED catalogue and map, so a moved site or a renamed step
 * shows up here.
 */

const deps = { catalogue: QUEST_LINE_CATALOGUE };
const seen = (questLines: unknown) => coastResidents(deps, parseQuestLines(questLines));
const done = (...ids: string[]) => Object.fromEntries(ids.map((id, index) => [id, { at: index + 1, marks: 1 }]));
const stepOf = (questId: string, key: string) => QUEST_LINE_CATALOGUE.lines[questId].stages.findIndex(stage => stage.key === key);
const saidBy = (questLines: unknown, label: string) => seen(questLines).find(person => person.label === label)?.say;
const BOAT = { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } };

test('the settlement, the fishers and the remakers are always there; the cairn and the saddle fill only on their steps', () => {
    const quiet = seen({});
    assert.deepEqual([...new Set(quiet.map(person => person.sector))].sort(), [104, 105, 144]);
    assert.equal(quiet.filter(person => person.sector === 105).length, 6, 'six people live at the houses beside the Record House');
    assert.deepEqual(quiet.filter(person => person.sector === 104).map(person => person.label), ['A fisher on the rocks', 'A net mender', 'A basket carrier']);
    assert.equal(quiet.filter(person => person.sector === 144).length, 2);

    // The uncounted wait at the cairn while the player is leading them over, and at no other time.
    const waiting = (key: string) => seen({ active: { 'uncounted-3': { stage: stepOf('uncounted-3', key), at: 1 } } }).filter(person => person.sector === 140).length;
    assert.deepEqual([waiting('forge'), waiting('cairn'), waiting('captain')], [0, 4, 4]);
    assert.equal(seen({ done: done('uncounted-3') }).some(person => person.sector === 140), false, 'they have crossed');

    // The boy is on the saddle from the moment he is found until the gate is settled.
    const boy = (key: string, choices?: Record<string, string>) =>
        seen({ active: { 'crossing-war-4': { stage: stepOf('crossing-war-4', key), at: 1, ...(choices ? { choices } : {}) } } }).find(person => person.sector === 137)?.say;
    assert.equal(boy('saddle'), undefined, 'not before the player reaches him');
    assert.match(boy('sentry')!, /stopped shivering/);
    assert.match(boy('chain', { sentry: 'warm' })!, /fire going beside him/);
    assert.match(boy('warden', { sentry: 'pass' })!, /has not moved/);
    assert.equal(seen({ done: done('crossing-war-4') }).some(person => person.sector === 137), false);
});

test('what a person says follows what this player did', () => {
    const fisher = 'A fisher on the rocks', carrier = 'A basket carrier', mender = 'A net mender';
    assert.match(saidBy({}, fisher)!, /garrison’s share/);
    assert.match(saidBy({ done: done('crossing-war-1') }, fisher)!, /commander’s gone quiet/);
    assert.match(saidBy({ done: done('crossing-war-1', 'tale-shoal-toll') }, fisher)!, /ate my whole catch/);

    // The cut families: written back in if the tallies were carried out, still off the roll if they were left.
    const bitterTide = (tallies: string) => ({ done: { 'crossing-war-1': { at: 1, marks: 2, choices: { tallies } } } });
    assert.match(saidBy({}, carrier)!, /Ask the commander/);
    assert.match(saidBy(bitterTide('carry'), carrier)!, /Orito wrote us in again/);
    assert.match(saidBy(bitterTide('leave'), carrier)!, /keep our heads down/);
    assert.doesNotMatch(saidBy(bitterTide('leave'), carrier)!, /wrote us in/);

    // The finale is heard on the rocks and at the bench, whichever way it went.
    const finale = (ask: string) => ({ done: { 'the-unmoored': { at: 1, marks: 5, choices: { ask } } } });
    assert.match(saidBy(finale('open'), mender)!, /mend them for strangers/);
    assert.match(saidBy(finale('closed'), mender)!, /stays shut/);
    assert.match(saidBy(finale('open'), 'A remaker at the bench')!, /second mould/);

    // At the houses the first choice of the war is answered by the people it was about.
    const door = 'A woman at her door';
    assert.match(saidBy({}, door)!, /decides who’s a family/);
    assert.match(saidBy(bitterTide('carry'), door)!, /mark is back on the roll/);
    assert.match(saidBy(bitterTide('leave'), door)!, /still scraped off the post/);
    assert.match(saidBy({ done: done('uncounted-1') }, 'A woman sitting apart')!, /woman at the quay/);
    assert.match(saidBy({ done: done('uncounted-1', 'uncounted-3') }, 'A woman sitting apart')!, /I stayed/);
    assert.match(saidBy(finale('closed'), 'An old man on the stair')!, /stays shut/);
    assert.notEqual(saidBy(finale('closed'), 'A remaker at the bench'), saidBy(finale('open'), 'A remaker at the bench'));
});

test('everyone stands on open ground beside their place: never a road, a doorway, a trail’s end, a patrol or each other', () => {
    // Every group at once, so the tiles of all of them are checked.
    const everyone = [
        ...seen({}),
        ...seen({ active: { 'uncounted-3': { stage: stepOf('uncounted-3', 'cairn'), at: 1 } } }).filter(person => person.sector === 140),
        ...seen({ active: { 'crossing-war-4': { stage: stepOf('crossing-war-4', 'sentry'), at: 1 } } }).filter(person => person.sector === 137),
    ];
    assert.equal(everyone.length, COAST_RESIDENT_GROUPS.reduce((sum, group) => sum + group.people.length, 0), 'every sector has room for its whole group');
    const keepers = coastQuestPresence(deps as never, parseQuestLines({}), []).figures;
    for (const person of everyone) {
        const layout = coastLayout(person.sector)!;
        assert.equal(layout.mask[Math.floor(person.tile / 12)][person.tile % 12], '.', `${person.label} stands on open ground, off the road`);
        assert.equal(Object.values(layout.sites).some(site => site.approach === person.tile), false, `${person.label} is not in a doorway`);
        assert.equal(coastExits(person.sector).some(exit => exit.tile === person.tile), false, `${person.label} is not on a trail’s end`);
        assert.equal(keepers.some(figure => figure.sector === person.sector && figure.tile === person.tile), false);
        // A patrol may stand anywhere on a road, on any day: no day puts one on a resident.
        for (let day = 0; day < 40; day++) assert.equal(coastPatrolsIn(person.sector, day * 86_400_000).some(patrol => patrol.tile === person.tile), false, person.label);
        const others = everyone.filter(other => other !== person && other.sector === person.sector);
        for (const other of others) {
            const apart = Math.abs((other.tile % 12) - (person.tile % 12)) + Math.abs(Math.floor(other.tile / 12) - Math.floor(person.tile / 12));
            assert.ok(apart > 1, `${person.label} and ${other.label} do not stand side by side`);
        }
        // Near enough to their place to belong to it.
        const group = COAST_RESIDENT_GROUPS.find(entry => entry.sector === person.sector)!;
        const site = coastSite(group.site(person.sector)!)!;
        assert.ok(Math.max(Math.abs((site.approach % 12) - (person.tile % 12)), Math.abs(Math.floor(site.approach / 12) - Math.floor(person.tile / 12))) <= 5, `${person.label} is near ${site.name}`);
    }
    assert.deepEqual(residentTiles(104, 'no-such-site', 3), []);
    assert.deepEqual(residentTiles(105, coastSite('hushcrown-counter-144')!.id, 3), [], 'a site in another sector places nobody');
});

test('every figure wears a model the game has, with the painted face that goes with it', () => {
    for (const group of COAST_RESIDENT_GROUPS) {
        assert.equal(new Set(group.people.map(person => person.label)).size, group.people.length, `sector ${group.sector}: each person has their own label`);
        for (const person of group.people) {
            assert.equal(person.face, castFaceOf(person.model), `${person.label}: the face is the one that model wears`);
            assert.notEqual(person.face, 'boss');
        }
    }
});

test('every line keeps the script’s rules: plain, short, said the way a person says it', () => {
    // Every record that changes what somebody says.
    const war = (tallies: string) => ({ done: { 'crossing-war-1': { at: 1, marks: 2, choices: { tallies } } } });
    const records: unknown[] = [
        {}, { done: done('first-footing') }, war('carry'), war('leave'), { done: done('crossing-war-1', 'tale-shoal-toll') }, { done: done('crossing-war-5') },
        { done: done('uncounted-1') }, { done: done('uncounted-1', 'uncounted-3') },
        { done: { 'the-unmoored': { at: 1, marks: 5, choices: { ask: 'open' } } } }, { done: { 'the-unmoored': { at: 1, marks: 5, choices: { ask: 'closed' } } } },
        { active: { 'uncounted-3': { stage: stepOf('uncounted-3', 'cairn'), at: 1 } } },
        ...[undefined, 'warm', 'pass'].map(sentry => ({ active: { 'crossing-war-4': { stage: stepOf('crossing-war-4', 'chain'), at: 1, ...(sentry ? { choices: { sentry } } : {}) } } })),
    ];
    const lines = new Set(records.flatMap(record => seen(record).map(person => person.say)));
    assert.ok(lines.size >= 34, `expected the whole set, found ${lines.size}`);
    for (const say of lines) {
        const spoken = say.startsWith('“');
        assert.equal(spoken, say.endsWith('”'), `speech is quoted whole: ${say}`);
        assert.ok(say.trim().split(/\s+/).length <= QUEST_SAY_MAX_WORDS, say);
        assert.doesNotMatch(say, /[–—]|--| - /, say);
        assert.doesNotMatch(say, /[A-Za-z]-[A-Za-z]/, `no invented compound: ${say}`);
        // People contract, as they do in the village stories. What the shinobi sees is prose and does not.
        if (spoken) assert.doesNotMatch(say, /\b(do not|does not|did not|cannot|will not|is not|are not|I am|I have never|it is)\b/i, say);
        else assert.doesNotMatch(say, /’(t|m|ve|ll|re)\b/, `narration does not contract: ${say}`);
    }
});

test('the quest list carries the people once the boat has sailed, and never before', () => {
    const view = (questLines: unknown) => questLineClientViews(deps, parseQuestLines(questLines), { level: 60, inventory: [], itemStacks: [] }, { level: 60, inClan: false }).coast;
    assert.equal(view({}).people, undefined);
    const people = view({ done: BOAT }).people!;
    assert.equal(people.length, 11);
    assert.deepEqual(Object.keys(people[0]).sort(), ['face', 'label', 'model', 'say', 'sector', 'tile']);
});
