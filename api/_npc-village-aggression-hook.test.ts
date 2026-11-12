import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let aggression: typeof import('./_npc-village-aggression.js');
let roster: typeof import('../shared/npc-village-roster.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    aggression = await import('./_npc-village-aggression.js');
    roster = await import('../shared/npc-village-roster.js');
});
beforeEach(async () => { await kv.del(aggression.NPC_AGGRESSION_KEY); });

test('a player beating a Cinderhold shinobi raises aggression toward the winner\'s village', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
    const out = await aggression.noteNpcDefeat('Alice', 'Frostfang Village', npc.name);
    assert.equal(out?.gained, 2);
    assert.equal((await aggression.readNpcAggression()).byVillage['Frostfang Village'], 2);
});

test('player-vs-player, NPC-vs-NPC and non-player villages change nothing', async () => {
    const [a, b] = roster.NPC_VILLAGE_ROSTER;
    assert.equal(await aggression.noteNpcDefeat('Alice', 'Frostfang Village', 'Bob'), null);
    assert.equal(await aggression.noteNpcDefeat(a!.name, 'Cinderhold Village', b!.name), null);
    assert.equal((await aggression.noteNpcDefeat('Alice', 'Cinderhold Village', a!.name))?.gained, 0);
    assert.deepEqual(Object.values((await aggression.readNpcAggression()).byVillage).filter(Boolean), []);
});

test('the PvP claim feeds the meter once per settled win, after its save locks', () => {
    const source = readFileSync('api/pvp/claim-rewards.ts', 'utf8');
    const remember = source.slice(source.indexOf('const rememberDuel='), source.indexOf('const worldAttacker = sealedWorldRaidAttacker'));
    // Only a paid win feeds the meter (spars and repeat fights pay nothing and
    // count nothing); since 2026-11-11 "paid" is the win's settled slot (npcDuelPays).
    assert.match(remember, /if\(outcome==='win'&&!already&&session\.npcDuel\?\.version===1&&npcDuelPays\(session\)\)\{[\s\S]*noteNpcDefeat\(winnerName,/);
});
