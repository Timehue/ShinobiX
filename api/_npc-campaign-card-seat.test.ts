import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { ChronicleMatch } from '../shared/chronicle-duel.js';

// The seat that plays a Cinderhold raider's village-war card battle
// (api/_npc-campaign-card-seat.ts) paces itself like a player and costs the
// disk-capped store nothing while it waits:
//   - against the defending village's AI copy the copy's whole turn is played
//     inside the raider's own request, so the raider's next turn starts in the
//     middle of a drive; it must still read that board for its seeded think
//     (2-10 s) before acting, never play straight on after a 0.45-1.2 s beat;
//   - a sweep that finds the raider still thinking, or the opponent to move,
//     reads the run and writes nothing (no lease, no lock).

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_NPC_VILLAGE;

let kv: typeof import('./_storage.js').kv;
let seat: typeof import('./_npc-campaign-card-seat.js');
let ai: typeof import('./card-clash/_ai-engine.js');
let chronicle: typeof import('../shared/chronicle-duel.js');
let raider: (typeof import('../shared/npc-village-roster.js'))['NPC_VILLAGE_ROSTER'][number];

const T0 = Date.UTC(2026, 10, 11, 15, 0, 0);
const WAR = 'cinderholdvillage-vs-moonshadowvillage';
type Run = { id: string; warId: string; attacker: string; status: 'active' | 'done'; npc: boolean; card?: ChronicleMatch; aiCard?: import('./card-clash/_ai-engine.js').AiMatchSession };

before(async () => {
    ({ kv } = await import('./_storage.js'));
    seat = await import('./_npc-campaign-card-seat.js');
    ai = await import('./card-clash/_ai-engine.js');
    chronicle = await import('../shared/chronicle-duel.js');
    raider = (await import('../shared/npc-village-roster.js')).NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    // Real think and answer times against a clock the test moves; no beats, so it runs fast.
    seat.setNpcCampaignCardPaceForTest(1, 0);
});
after(() => {
    seat.setNpcCampaignCardPaceForTest(1);
    seat.setNpcCampaignCardSendForTest(null);
});

/** A seeded random source, so the match is the same on every run. */
function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

type Played = { at: number; before: ChronicleMatch };
/**
 * Stands in for /api/village/war-campaign's card branch on an AI-copy run:
 * the raider's action is applied and the copy answers in the same request
 * (applyPlayerAction runs advanceAi), exactly as the route does.
 */
function fakeCampaignRoute(key: string, played: Played[]) {
    return async (_npcId: string, _npcName: string, body: Record<string, unknown>) => {
        const run = (await kv.get<Run>(key))!;
        if (body.action !== 'state') {
            played.push({ at: Date.now(), before: run.aiCard!.state });
            const applied = ai.applyPlayerAction(run.aiCard!, body as never, Date.now());
            if (!applied.ok) return { status: 409, body: { error: applied.error } };
        }
        if (run.aiCard!.state.status === 'complete') run.status = 'done';
        await kv.set(key, run);
        return { status: 200, body: {} };
    };
}

test('against the AI copy the raider reads every new turn and response window before it acts', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    t.after(() => mock.timers.reset());
    const runId = 'vwc' + 'a1'.repeat(16);
    const key = `village-campaign-run:${runId}`;
    const deck = raider.deck.cards;
    const aiCard = ai.createAiMatch(runId, raider.id, deck, 'hard', T0, seeded(7), 'external', undefined, { name: 'Seat Copy Keeper', deck });
    await kv.set(key, { id: runId, warId: WAR, attacker: raider.id, status: 'active', npc: true, aiCard } satisfies Run);
    const played: Played[] = [];
    seat.setNpcCampaignCardSendForTest(fakeCampaignRoute(key, played));
    t.after(() => seat.setNpcCampaignCardSendForTest(null));

    const entry = { npc: raider.id, warId: WAR, at: T0 };
    const turnsBegun = () => played.filter((p) => !p.before.responseWindow && p.before.activePlayer === 'p1' && p.before.actedThisTurn === false);
    for (let guard = 0; guard < 600 && turnsBegun().length < 4; guard++) {
        if ((await kv.get<Run>(key))!.status === 'done') break;
        await seat.driveNpcCampaignCardRun(runId, entry);
        mock.timers.tick(500); // the sweep's clock, half a second at a time
    }

    const begun = turnsBegun();
    assert.ok(begun.length >= 2, `the raider began several turns of its own (${begun.length})`);
    for (const p of begun) {
        const waited = p.at - Number(p.before.turnStartedAt);
        assert.ok(waited >= seat.npcCardThinkMs(runId, p.before.turnNumber),
            `turn ${p.before.turnNumber}: first action ${waited} ms after the turn began, before its think was over`);
        assert.ok(waited >= 2_000, `turn ${p.before.turnNumber}: ${waited} ms is no human read of the board`);
    }
    for (const p of played.filter((x) => x.before.responseWindow?.responder === 'p1')) {
        const waited = p.at - Number(p.before.responseWindow!.openedAt);
        assert.ok(waited >= 1_000, `answered a response window ${waited} ms after it opened`);
    }
});

test('a sweep while the raider thinks or its opponent moves writes nothing', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: T0 + 60 * 60_000 });
    t.after(() => mock.timers.reset());
    const now = Date.now();
    const deck = raider.deck.cards;
    const sent: unknown[] = [];
    seat.setNpcCampaignCardSendForTest(async (_a, _b, body) => { sent.push(body); return { status: 200, body: {} }; });
    t.after(() => seat.setNpcCampaignCardSendForTest(null));

    // The raider's own turn against the AI copy, just begun: it is reading the board.
    const thinkingId = 'vwc' + 'b2'.repeat(16);
    let aiCard = ai.createAiMatch(thinkingId, raider.id, deck, 'hard', now, seeded(11), 'external', undefined, { name: 'Seat Copy Keeper', deck });
    for (let s = 12; aiCard.state.activePlayer !== 'p1' || aiCard.state.responseWindow; s++) {
        aiCard = ai.createAiMatch(thinkingId, raider.id, deck, 'hard', now, seeded(s), 'external', undefined, { name: 'Seat Copy Keeper', deck });
    }
    assert.equal(aiCard.state.actedThisTurn, false);
    await kv.set(`village-campaign-run:${thinkingId}`, { id: thinkingId, warId: WAR, attacker: raider.id, status: 'active', npc: true, aiCard } satisfies Run);

    // A queued player defender's turn in a real PvP Chronicle duel: the raider waits on them.
    const waitingId = 'vwc' + 'c3'.repeat(16);
    let card = chronicle.createMatch(raider.id, deck, 'seatwaitguard', deck, seeded(5), now);
    for (let s = 6; card.activePlayer !== 'p2' || card.responseWindow; s++) card = chronicle.createMatch(raider.id, deck, 'seatwaitguard', deck, seeded(s), now);
    await kv.set(`village-campaign-run:${waitingId}`, { id: waitingId, warId: WAR, attacker: raider.id, status: 'active', npc: false, card } satisfies Run);

    await seat.registerNpcCampaignCardRun(thinkingId, { npc: raider.id, warId: WAR, at: now });
    await seat.registerNpcCampaignCardRun(waitingId, { npc: raider.id, warId: WAR, at: now });
    t.after(async () => { await kv.del(seat.NPC_CAMPAIGN_CARD_RUNS_KEY); });

    const thinkEnds = Number(aiCard.state.turnStartedAt) + seat.npcCardThinkMs(thinkingId, aiCard.state.turnNumber);
    const writes = (['set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual', 'incr', 'hset', 'hdel'] as const)
        .filter((name) => typeof (kv as unknown as Record<string, unknown>)[name] === 'function')
        .map((name) => mock.method(kv as unknown as Record<string, (...args: unknown[]) => unknown>, name));
    let sweeps = 0;
    let calls: string[] = [];
    try {
        while (Date.now() + 500 < thinkEnds) {
            await seat.sweepNpcCampaignCardRuns();
            sweeps++;
            mock.timers.tick(500);
        }
    } finally {
        calls = writes.flatMap((w) => w.mock.calls.map((c) => String(c.arguments[0])));
        for (const w of writes) w.mock.restore();
    }
    assert.ok(sweeps >= 3, `${sweeps} sweeps`);
    assert.deepEqual(calls, [], 'an idle sweep takes no lease and writes no row');
    assert.deepEqual(sent, [], 'and sends nothing');

    // Once the think is over the next sweep plays (and only then takes the lease).
    mock.timers.tick(thinkEnds - Date.now() + 1);
    await seat.sweepNpcCampaignCardRuns();
    assert.ok(sent.length > 0, 'the raider acts once it has read the board');
});
