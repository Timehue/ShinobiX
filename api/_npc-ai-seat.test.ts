import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-ai-seat-test-session-secret-32-chars';

let seat: typeof import('./_npc-ai-seat.js');
let driver: typeof import('./_npc-duel-driver.js');
let roster: typeof import('../shared/npc-village-roster.js');
let kv: typeof import('./_storage.js').kv;

before(async () => {
    seat = await import('./_npc-ai-seat.js');
    driver = await import('./_npc-duel-driver.js');
    roster = await import('../shared/npc-village-roster.js');
    ({ kv } = await import('./_storage.js'));
});

test('an NPC plays at its rank: genin and chunin tactical, jonin advanced, elite and commander master', () => {
    const byRank = (rank: string) => roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === rank)!;
    assert.equal(seat.npcTurnPolicy(byRank('genin')).tier, 'tactical');
    assert.equal(seat.npcTurnPolicy(byRank('chunin')).tier, 'tactical');
    assert.equal(seat.npcTurnPolicy(byRank('jonin')).tier, 'advanced');
    assert.equal(seat.npcTurnPolicy(byRank('elite')).tier, 'master');
    assert.equal(seat.npcTurnPolicy(byRank('commander')).tier, 'master');
});

test('the seat only ever sends moves a player could send, and never flees, summons or abandons', () => {
    assert.deepEqual(seat.pvpMoveFor({ type: 'jutsu', jutsuId: 'x', tile: 7 }), { action: 'jutsu', jutsuId: 'x', tile: 7 });
    assert.deepEqual(seat.pvpMoveFor({ type: 'move', tile: 3 }), { action: 'move', tile: 3 });
    assert.deepEqual(seat.pvpMoveFor({ type: 'basicAttack' }), { action: 'basicAttack' });
    for (const type of ['flee', 'summon', 'abandon', 'wait'] as const) assert.deepEqual(seat.pvpMoveFor({ type } as never), { action: 'wait' });
    assert.deepEqual(seat.pvpMoveFor(null), { action: 'wait' });
});

test('seats are recognised from the roster only', () => {
    const npc = roster.NPC_VILLAGE_ROSTER[3]!;
    assert.equal(seat.npcSeatOf({ p1: { name: 'Alice' }, p2: { name: npc.name } }), 'p2');
    assert.equal(seat.npcSeatOf({ p1: { name: 'Alice' }, p2: { name: 'Bob' } }), null);
});

test('while an admin controls the NPC, the seat stands down and does not even join', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[4]!;
    const { npcPossessKey } = await import('./_npc-possession.js');
    await kv.set(npcPossessKey(npc.id), { by: 'admin', at: Date.now(), expiresAt: Date.now() + 60_000 });
    await kv.set('pvp:possessed-duel', { battleId: 'possessed-duel', status: 'active', p1: { name: 'Alice' }, p2: { name: npc.name },
        joined: { p1: true, p2: false }, activePlayer: 'p2' });
    assert.equal(await driver.driveNpcDuel('possessed-duel', 'p2'), 'idle');
    assert.equal((await kv.get<{ joined: { p2: boolean } }>('pvp:possessed-duel'))!.joined.p2, false);
});
