import assert from 'node:assert/strict';
import test from 'node:test';
import { coastSectorName, coastSitesInSector } from '../../shared/coast-world.js';
import { QUEST_LINE_CATALOGUE } from './_catalog.js';
import { COAST_ROUND_LINES } from './_coast-rounds.js';

test('every leg of every Rounds tier is told in its keeper’s own voice, and no two legs are told alike', () => {
    const told = new Set<string>();
    let legs = 0;
    for (const line of Object.values(COAST_ROUND_LINES)) {
        assert.equal(line.stages.length, 5, line.id);
        line.stages.forEach((stage, at) => {
            const lines = QUEST_LINE_CATALOGUE.lines[line.id].stages[at].say ?? [];
            // Taking the rounds is the offer, and bringing them back is the closing; the three legs between are these.
            if (at === 0) return assert.equal(lines.length, 0, `${line.id}: taking the rounds is said by the offer`);
            if (at === 4 && stage.kind === 'enter') return assert.equal(lines.length, 0, `${line.id}: the closing says the return`);
            if (at === 4) return;
            assert.equal(lines.length, 1, `${line.id} step ${at + 1} has its line`);
            assert.equal(lines[0].speaker, line.giver, `${line.id}: its keeper says it`);
            assert.equal(told.has(lines[0].text), false, `${line.id} step ${at + 1} repeats another leg`);
            told.add(lines[0].text);
            legs++;
        });
    }
    assert.equal(legs, 60);
});

test('a keeper sending the player somewhere names that place or what is found there', () => {
    // A leg that walks to, or fights in, a sector must speak of that sector by its name or by its site's name,
    // so the line belongs to the place and could not be moved to another step unnoticed.
    const adrift: string[] = [];
    for (const line of Object.values(COAST_ROUND_LINES)) {
        line.stages.forEach((stage, at) => {
            const sector = stage.kind === 'reach' ? stage.place.sector : stage.kind === 'boss' ? QUEST_LINE_CATALOGUE.fights[stage.fightId]?.sector : undefined;
            const said = QUEST_LINE_CATALOGUE.lines[line.id].stages[at].say?.[0]?.text;
            if (sector === undefined || !said) return;
            const names = [coastSectorName(sector) ?? '', ...coastSitesInSector(sector).map(site => site.name)]
                .map(name => name.replace(/^The /, '').replace(/’/g, "'").toLowerCase()).filter(Boolean);
            const plain = said.replace(/’/g, "'").toLowerCase();
            if (!names.some(name => plain.includes(name) || name.split(' ').some(word => word.length > 4 && plain.includes(word)))) {
                adrift.push(`${line.id} step ${at + 1} (${names.join(' / ')}): "${said.slice(0, 70)}"`);
            }
        });
    }
    assert.deepEqual(adrift, []);
});
