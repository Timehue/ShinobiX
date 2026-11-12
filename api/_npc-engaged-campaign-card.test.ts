import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// A Cinderhold shinobi playing a village-war raid card battle (its seat is
// played by api/_npc-campaign-card-seat.ts) is engaged: a world attack, a rival
// hunt or an admin takeover must not book it into a second fight meanwhile.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let duel: typeof import('./_npc-duel.js');
let seat: typeof import('./_npc-campaign-card-seat.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    duel = await import('./_npc-duel.js');
    seat = await import('./_npc-campaign-card-seat.js');
});

test('an NPC in a live raid card battle is engaged until the run is done', async () => {
    const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!.id;
    const now = Date.now();
    assert.equal(await duel.npcEngaged(npc, now), false, 'free before the raid');

    await kv.set('village-campaign-run:vwcraidcard1', { id: 'vwcraidcard1', status: 'active', attacker: npc, npc: false });
    await seat.registerNpcCampaignCardRun('vwcraidcard1', { npc, warId: 'cinderholdvillage-vs-moonshadowvillage', at: now });
    assert.equal(await duel.npcEngaged(npc, now), true, 'engaged while the raid card battle runs');

    await kv.set('village-campaign-run:vwcraidcard1', { id: 'vwcraidcard1', status: 'done', attacker: npc, npc: false });
    assert.equal(await duel.npcEngaged(npc, now), false, 'free again once the run is done');

    // Registered but its row not published yet: engaged for the publish grace only.
    await kv.del('village-campaign-run:vwcraidcard1');
    assert.equal(await duel.npcEngaged(npc, now + 1_000), true);
    assert.equal(await duel.npcEngaged(npc, now + 10 * 60_000), false);
});
