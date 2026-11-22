import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEAR_DROP_CHANCE_BP } from '../_gear-drops.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { QUEST_GEAR_CHANCE_BP, questLineGearDrop } from './_gear.js';

/*
 * The gear chance on a quest reward: one roll per player and quest, fixed, and
 * paid as an ordinary gear step drop.
 */

const holder = { gearTierUnlocks: { weapon: 1, armor: 1 }, inventory: [], equipment: {} };
const players = Array.from({ length: 2_000 }, (_unused, index) => `shinobi${index}`);

test('the chance is the game\'s 20 percent, and the roll lands near it', () => {
    assert.deepEqual([QUEST_GEAR_CHANCE_BP, GEAR_DROP_CHANCE_BP.questLine, GEAR_DROP_CHANCE_BP.clanCache], [2_000, 2_000, 2_000]);
    const hits = players.filter(name => questLineGearDrop(name, holder, QUEST_GEAR_CHANCE_BP, 'crossing-war-1')).length;
    // 2,000 fixed rolls at 20 percent: 400 expected, and 330 to 470 is more than four standard deviations wide.
    assert.ok(hits > 330 && hits < 470, `${hits} of 2000`);
});

test('a hit is a real gear step item of the player\'s own tier', () => {
    const drops = players.map(name => questLineGearDrop(name, holder, QUEST_GEAR_CHANCE_BP, 'the-unmoored')).filter((id): id is string => !!id);
    assert.ok(drops.length > 0);
    for (const id of drops) assert.ok(isStepItemId(id) && ITEM_CATALOG[id], id);
    assert.ok(new Set(drops).size > 1, 'the piece varies from player to player');
});

test('the same player and quest always get the same answer, and another quest is its own roll', () => {
    for (const name of players.slice(0, 200)) {
        assert.equal(questLineGearDrop(name, holder, QUEST_GEAR_CHANCE_BP, 'uncounted-3'), questLineGearDrop(name, holder, QUEST_GEAR_CHANCE_BP, 'uncounted-3'), name);
    }
    const perQuest = (questId: string) => players.slice(0, 400).map(name => (questLineGearDrop(name, holder, QUEST_GEAR_CHANCE_BP, questId) ? '1' : '0')).join('');
    assert.notEqual(perQuest('crossing-war-1'), perQuest('crossing-war-2'), 'a miss on one quest says nothing about the next');
});

test('no chance, no drop; a certain chance always drops', () => {
    for (const name of players.slice(0, 50)) {
        assert.equal(questLineGearDrop(name, holder, 0, 'crossing-war-1'), null);
        assert.ok(questLineGearDrop(name, holder, 10_000, 'crossing-war-1'));
    }
});
