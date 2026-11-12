import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { ChronicleMatch } from '../shared/chronicle-duel.js';

// The two war Chronicle seats a Cinderhold shinobi plays from the server, the
// sector-war card seat (api/_npc-card-duel-driver.ts) and the clan-war card
// seat (api/_npc-clan-war-campaign.ts), sweep every second. Production
// Postgres is disk-capped, so a sweep that finds the NPC stepping in, reading
// the board or waiting on the player must write nothing (no lease) and read
// no more than the duel itself; it still acts the moment its seeded pace is
// over. The pace itself (join delay, 2-10 s think, beats) is unchanged.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_NPC_VILLAGE;

let kv: typeof import('./_storage.js').kv;
let chronicle: typeof import('../shared/chronicle-duel.js');
let roster: (typeof import('../shared/npc-village-roster.js'))['NPC_VILLAGE_ROSTER'];

before(async () => {
    ({ kv } = await import('./_storage.js'));
    chronicle = await import('../shared/chronicle-duel.js');
    roster = (await import('../shared/npc-village-roster.js')).NPC_VILLAGE_ROSTER;
});

function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** A fresh match between a player (p1) and the NPC (p2) with `toMove` to move, no window open. */
function matchWith(player: string, npcId: string, deck: string[], toMove: 'p1' | 'p2', now: number): ChronicleMatch {
    for (let s = 1; ; s++) {
        const m = chronicle.createMatch(player, deck, npcId, deck, seeded(s), now);
        if (m.activePlayer === toMove && !m.responseWindow) return m;
    }
}

/** Every storage write method, spied; returns the keys written and a restore. */
function spyWrites() {
    const spies = (['set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual', 'incr', 'hset', 'hdel'] as const)
        .filter((name) => typeof (kv as unknown as Record<string, unknown>)[name] === 'function')
        .map((name) => mock.method(kv as unknown as Record<string, (...args: unknown[]) => unknown>, name));
    return { keys: () => spies.flatMap((s) => s.mock.calls.map((c) => String(c.arguments[0]))), restore: () => spies.forEach((s) => s.mock.restore()) };
}

test('the sector-war card seat writes nothing while it steps in, reads the board or waits, and acts once ready', async (t) => {
    const T = Date.UTC(2026, 10, 11, 19, 0, 0);
    mock.timers.enable({ apis: ['Date'], now: T });
    t.after(() => mock.timers.reset());
    const seat = await import('./_npc-card-duel-driver.js');
    const npc = roster.filter((n) => n.rank === 'chunin')[1]!;
    const deck = npc.deck.cards;
    const sent: Array<Record<string, unknown>> = [];
    // A refusal ends the drive after its first action, so no beat is slept.
    seat.setNpcCardDuelSendForTest(async (_slug, _name, body) => { sent.push(body); return { status: 409, body: {} }; });
    t.after(() => seat.setNpcCardDuelSendForTest(null));

    const war = 'seat-idle-sector-war';
    const thinking = 'seatidlesectorthink';
    const waiting = 'seatidlesectorwait';
    const joining = 'seatidlesectorjoin';
    const thinkState = matchWith('seatsectorfoe', npc.id, deck, 'p2', T);
    await kv.set(`sector-card-open:${thinking}`, { sectorWarId: war, status: 'active', p1Name: 'seatsectorfoe', p2Name: npc.id, state: thinkState });
    await kv.set(`sector-card-open:${waiting}`, { sectorWarId: war, status: 'active', p1Name: 'seatsectorfoe', p2Name: npc.id, state: matchWith('seatsectorfoe', npc.id, deck, 'p1', T) });
    await kv.set(`sector-card-open:${joining}`, { sectorWarId: war, status: 'awaiting-target', p1Name: 'seatsectorfoe', p2Name: npc.id, open: { engageId: joining, target: npc.id, joinBy: T + 60_000 } });
    for (const id of [thinking, waiting, joining]) await seat.registerNpcCardDuel(id, { npc: npc.id, sectorWarId: war, at: T });
    t.after(async () => { await kv.del(seat.NPC_CARD_DUEL_ACTIVE_KEY); });

    const thinkEnds = seat.npcChronicleReadyAt(thinking, thinkState, 'p2');
    const joinAt = seat.npcCardJoinAt(joining, T, T + 60_000);
    assert.ok(thinkEnds - T >= seat.NPC_CARD_THINK_MIN_MS && joinAt - T >= seat.NPC_CARD_JOIN_MIN_MS, 'the seat keeps its human pace');
    const writes = spyWrites();
    let sweeps = 0;
    let written: string[] = [];
    try {
        while (Date.now() + 500 < Math.min(thinkEnds, joinAt)) { await seat.sweepNpcCardDuels(); sweeps++; mock.timers.tick(500); }
    } finally { written = writes.keys(); writes.restore(); }
    assert.ok(sweeps >= 3, `${sweeps} sweeps`);
    assert.deepEqual(written, [], 'an idle sweep takes no lease and writes no row');
    assert.equal(sent.length, 0, 'and sends nothing');

    mock.timers.tick(Math.max(thinkEnds, joinAt) - Date.now() + 1);
    await seat.sweepNpcCardDuels();
    const sentFor = (id: string) => sent.filter((b) => b.engageId === id);
    assert.ok(sentFor(thinking).length > 0 && sentFor(thinking)[0]!.action !== 'join', 'it plays its turn once it has read the board');
    assert.equal(sentFor(joining)[0]?.action, 'join', 'it steps in once its join delay is over');
    assert.deepEqual(sentFor(waiting), [], 'and leaves the player\'s turn to the player');
});

test('the clan-war card seat writes nothing and reads no war row while it waits, and acts once ready', async (t) => {
    const T = Date.UTC(2026, 10, 11, 20, 0, 0);
    mock.timers.enable({ apis: ['Date'], now: T });
    t.after(() => mock.timers.reset());
    const clan = await import('./_npc-clan-war-campaign.js');
    const { npcChronicleReadyAt, npcCardJoinAt } = await import('./_npc-card-duel-driver.js');
    clan.setNpcClanCardBeatForTest(450); // the seat's real pace (think and join scale 1)
    t.after(() => clan.setNpcClanCardBeatForTest(450));
    const npc = roster.filter((n) => n.rank === 'chunin')[2]!;
    const deck = npc.deck.cards;
    const sent: Array<Record<string, unknown>> = [];
    clan.setNpcClanTilecardsSendForTest(async (_npc, body) => { sent.push(body); return { status: 409, body: {} }; });
    t.after(() => clan.setNpcClanTilecardsSendForTest(null));

    const warId = 'seat-idle-clan-war';
    const thinking = 'seatidleclanthink';
    const waiting = 'seatidleclanwait';
    const joining = 'seatidleclanjoin';
    const thinkState = matchWith('seatclanfoe', npc.id, deck, 'p2', T);
    await kv.set(`cw-tilecards:${thinking}`, { status: 'active', p1Name: 'seatclanfoe', p2Name: npc.id, state: thinkState, createdAt: T });
    await kv.set(`cw-tilecards:${waiting}`, { status: 'active', p1Name: 'seatclanfoe', p2Name: npc.id, state: matchWith('seatclanfoe', npc.id, deck, 'p1', T), createdAt: T });
    await kv.set(`cw-tilecards:${joining}`, { status: 'awaiting-p2', p1Name: 'seatclanfoe', createdAt: T });
    await kv.set(`clan-war:${warId}`, { id: warId, clans: [], campaign: { matches: {} } });
    for (const id of [thinking, waiting, joining]) await clan.registerNpcClanCardDuel(id, { npc: npc.id, warId, at: T });
    t.after(async () => { await kv.del(clan.NPC_CLAN_CARD_DUEL_ACTIVE_KEY); });

    const thinkEnds = npcChronicleReadyAt(thinking, thinkState, 'p2', 1);
    const joinAt = npcCardJoinAt(joining, T, undefined, 1);
    const writes = spyWrites();
    const reads = mock.method(kv, 'get');
    let sweeps = 0;
    let written: string[] = [];
    let warReads = 0;
    try {
        while (Date.now() + 500 < Math.min(thinkEnds, joinAt)) { await clan.sweepNpcClanCardDuels(); sweeps++; mock.timers.tick(500); }
    } finally {
        written = writes.keys(); writes.restore();
        warReads = reads.mock.calls.filter((c) => String(c.arguments[0]).startsWith('clan-war:')).length;
        reads.mock.restore();
    }
    assert.ok(sweeps >= 3, `${sweeps} sweeps`);
    assert.deepEqual(written, [], 'an idle sweep writes no row');
    assert.equal(warReads, 0, 'and never reads the whole clan-war row for a duel that is in play');
    assert.equal(sent.length, 0, 'and sends nothing');

    mock.timers.tick(Math.max(thinkEnds, joinAt) - Date.now() + 1);
    await clan.sweepNpcClanCardDuels();
    const sentFor = (id: string) => sent.filter((b) => b.challengeId === id);
    assert.ok(sentFor(thinking).length > 0 && sentFor(thinking)[0]!.action !== 'join', 'it plays its turn once it has read the board');
    assert.equal(sentFor(joining)[0]?.action, 'join', 'it sits down once its join delay is over');
    assert.deepEqual(sentFor(waiting), [], 'and leaves the player\'s turn to the player');
});
