import { randomBytes } from 'node:crypto';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';
import { riftQuestRyo, riftTargetSector } from '../sector/_rift-quest.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';

// The intro rift's real audience, end to end through the real handlers: a
// level-12 shinobi with no companions and a Card Hall that stays sealed until
// the level-17 Scribe. Before this change the rift refused them at the door
// (4 carried pets + a saved 40-card deck). Every encounter they can meet on the
// way down must now resolve without leaving them stuck, and without paying
// anything the server did not decide.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, unknown> };
type Save = { _saveVersion: number; character: Record<string, unknown> } & Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
const handlers: Record<string, Handler> = {};

const PLAYER = 'riftnovice';
const RIFT = 'rift-legacy-echo';
const saveKey = `save:${PLAYER}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    const load = async (name: string, path: string) => {
        handlers[name] = (await import(path)).default as unknown as Handler;
    };
    await load('riftQuest', '../sector/rift-quest.js');
    await load('start', './start.js');
    await load('choose', './choose-augment.js');
    await load('floorSeal', './floor-seal.js');
    await load('step', './step.js');
    await load('cardStart', './card-start.js');
    await load('cardSettle', './card-settle.js');
    await load('combatStart', './combat-start.js');
    await load('combatSettle', './combat-settle.js');
    await load('settle', './settle.js');
});

async function call(name: string, body: Record<string, unknown>): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (data: Record<string, unknown>) => { reply.body = data; return res; },
        end: () => res,
    };
    await handlers[name]({
        method: 'POST', body: { ...body, playerName: PLAYER }, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return reply;
}

const WIDTH = 25;
const HEIGHT = 17;
const tileIndex = (x: number, y: number) => y * WIDTH + x;

/** A legal single-floor rift board. The walk under test runs along row 1:
 * spawn (1,1) → (2,1) → Hound at (3,1) → (4,1) → (5,1) → boss at (6,1). */
function riftBoard() {
    const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    const place = (x: number, y: number, kind: string) => { tiles[tileIndex(x, y)] = { kind, terrain: 'room_floor' }; };
    place(3, 1, 'battle');
    place(6, 1, 'boss');
    place(1, 15, 'exit');
    let x = 2;
    for (const [kind, count] of [
        ['battle', 4], ['elite', 1], ['chest', 3], ['shard_vein', 1], ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) {
        for (let placed = 0; placed < count; placed += 1) place(x++, 10, kind);
    }
    return tiles;
}

async function readSave(): Promise<Save> {
    return (await kv.get<Save>(saveKey))!;
}

async function readRun(token: string): Promise<HollowGateRunToken> {
    return (await kv.get<HollowGateRunToken>(hollowGateRunKey(PLAYER, token)))!;
}

let stepCount = 0;
async function step(token: string, from: [number, number], to: [number, number]): Promise<Reply> {
    stepCount += 1;
    return call('step', {
        token, requestId: `rift-novice-step-${stepCount}`,
        fromX: from[0], fromY: from[1], toX: to[0], toY: to[1],
    });
}

/** Finish the server-owned Solo PvE fight exactly as its engine records a
 * terminal outcome; the Gate's settlement then decides everything else. */
async function finishFight(runId: string, outcome: 'win' | 'loss' | 'fled') {
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    const session = (await readSoloPveSession(runId))!;
    assert.ok(session, 'combat-start sealed a server session');
    const winner = outcome === 'win' ? 'player' : outcome === 'loss' ? 'enemy' : null;
    session.status = 'done';
    session.outcome = outcome;
    session.winner = winner as never;
    session.settlementState = 'pending';
    session.terminalEvidence = {
        finishedAt: Date.now(), finalMoveToken: `terminal-${runId}`, finalVersion: session.version,
        finalEventSeq: 0, winner: winner as never, outcome, itemsUsed: {}, settlementState: 'pending',
    } as never;
    await writeSoloPveSession(session);
}

test('an unprepared level-12 player descends the intro rift and resolves every encounter', async () => {
    const targetSector = riftTargetSector(PLAYER, RIFT);
    await kv.set(saveKey, {
        _saveVersion: 1,
        currentSector: targetSector,
        character: {
            name: PLAYER, level: 12, hp: 300, maxHp: 300, ryo: 250,
            pets: [], tileCards: [], itemStacks: [],
        },
    });

    // The quest is offered and accepted at level 12, as before.
    const accepted = await call('riftQuest', { action: 'accept', riftId: RIFT });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.ok, true, JSON.stringify(accepted.body));

    // Descend: no pets, no deck, no key. This is what used to be refused.
    const started = await call('start', { variantId: RIFT, requestId: 'rift-novice-start-1' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const token = String(started.body.token ?? '');
    assert.ok(token, 'the rift mints a run token');
    const offered = (await readRun(token)).offeredAugmentIds;
    const chosen = await call('choose', { token, augmentId: offered[0] });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    const multiplier = rewardMultiplierForToken(await readRun(token));
    const sealed = await call('floorSeal', { token, floor: 1, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles: riftBoard() });
    assert.equal(sealed.status, 200, JSON.stringify(sealed.body));

    // ── 1. The Chronicle card ambush (the first threat ambush in a rift). ──
    // Fixture shortcut: raise the sealed threat instead of walking 25 tiles.
    await kv.set(hollowGateRunKey(PLAYER, token), { ...await readRun(token), threat: 96 });
    const ambushStep = await step(token, [1, 1], [2, 1]);
    assert.equal(ambushStep.status, 200, JSON.stringify(ambushStep.body));
    const ambush = ambushStep.body.ambush as { nodeId: string; kind: string };
    assert.equal(ambush?.kind, 'card', 'the rift raises its card ambush');

    const beforeCard = await readSave();
    const cardStart = await call('cardStart', { token, nodeId: ambush.nodeId });
    assert.equal(cardStart.status, 200, JSON.stringify(cardStart.body));
    assert.equal(cardStart.body.loanerDeck, true, 'a player without a deck borrows the starter deck');
    const matchId = String(cardStart.body.matchId);
    const afterCard = await readSave();
    assert.deepEqual(afterCard, beforeCard, 'the loan writes nothing: no cards, no deck, no Scribe latch');
    const { cardClashAiTokenKey } = await import('../card-clash/_ai-reward.js');
    const match = (await kv.get<Record<string, any>>(cardClashAiTokenKey(matchId)))!;
    assert.equal(match.hollowGateCard.loanerDeck, true);
    const playerSide = match.state.p1.name === PLAYER ? match.state.p1 : match.state.p2;
    const fallback = new Set(CHRONICLE_FIXED_FALLBACK_DECK);
    assert.ok([...playerSide.hand, ...playerSide.deck].every((id: string) => fallback.has(id)),
        'the lent deck is exactly the server starter deck');

    // A refresh resumes the same match rather than dealing a new one.
    const resumed = await call('cardStart', { token, nodeId: ambush.nodeId });
    assert.equal(resumed.body.matchId, matchId);
    assert.equal(resumed.body.loanerDeck, true);

    // The Keeper wins. The loss is withstood: 20% max HP recoil, nothing paid.
    await kv.set(cardClashAiTokenKey(matchId), { ...match, status: 'done', winner: 'opponent', settledAt: Date.now() });
    const cardSettled = await call('cardSettle', { token, matchId });
    assert.equal(cardSettled.status, 200, JSON.stringify(cardSettled.body));
    assert.equal(cardSettled.body.won, false);
    let save = await readSave();
    assert.equal(save.character.hp, 240);
    assert.equal(save.character.ryo, 250, 'a lost card ambush pays nothing');
    assert.deepEqual(save.character.tileCards, [], 'the lent deck never joins the collection');
    assert.equal(save.character.cardClashDeck, undefined);
    const run = await readRun(token);
    assert.equal(run.pendingAmbush, null);
    assert.equal(run.threat, 0);
    assert.deepEqual(run.rewardLedger?.currencies ?? {}, {});

    // ── 2. A Hollow Hound tile fight, fought as a shinobi (no pet needed). ──
    const toHound = await step(token, [2, 1], [3, 1]);
    assert.equal(toHound.status, 200, 'the card ambush no longer seals movement');
    const houndNode = `floor:1:tile:${tileIndex(3, 1)}`;
    const houndStart = await call('combatStart', { token, floor: 1, kind: 'battle', nodeId: houndNode, mode: 'pve' });
    assert.equal(houndStart.status, 200, JSON.stringify(houndStart.body));
    assert.equal(houndStart.body.combatMode, 'solo-pve');
    await finishFight(String(houndStart.body.runId), 'win');
    const houndSettled = await call('combatSettle', { token, runId: houndStart.body.runId });
    assert.equal(houndSettled.status, 200, JSON.stringify(houndSettled.body));
    assert.equal(houndSettled.body.won, true);
    const houndReward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * multiplier);
    save = await readSave();
    assert.equal(save.character.ryo, 250 + houndReward, 'the Hound pays its sealed reward once');

    // ── 3. The rift boss. ──
    assert.equal((await step(token, [3, 1], [4, 1])).status, 200, 'a won Hound tile lets the player move on');
    assert.equal((await step(token, [4, 1], [5, 1])).status, 200);
    assert.equal((await step(token, [5, 1], [6, 1])).status, 200);
    const bossNode = `floor:1:tile:${tileIndex(6, 1)}`;
    const bossStart = await call('combatStart', { token, floor: 1, kind: 'boss', nodeId: bossNode, mode: 'pve' });
    assert.equal(bossStart.status, 200, JSON.stringify(bossStart.body));
    await finishFight(String(bossStart.body.runId), 'win');
    const bossSettled = await call('combatSettle', { token, runId: bossStart.body.runId });
    assert.equal(bossSettled.status, 200, JSON.stringify(bossSettled.body));
    assert.equal(bossSettled.body.won, true);
    const bossReward = Math.floor(hollowGateCombatReward(1, 'boss').ryo * multiplier);
    save = await readSave();
    assert.equal(save.character.ryo, 250 + houndReward + bossReward);
    assert.ok(save.character.riftQuestBossReceipt, 'the boss kill is bound to the accepted rift');

    // ── 4. The quest closes and the run extracts. ──
    const completed = await call('riftQuest', { action: 'complete', riftId: RIFT });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.ok, true, JSON.stringify(completed.body));
    const questRyo = riftQuestRyo(12, 5);
    assert.equal(completed.body.ryo, questRyo);
    const extracted = await call('settle', { token, action: 'extract' });
    assert.equal(extracted.status, 200, JSON.stringify(extracted.body));
    save = await readSave();
    assert.equal(save.character.ryo, 250 + houndReward + bossReward + questRyo,
        'extraction keeps exactly the entry balance, the sealed run rewards and the quest payout');
    assert.equal(save.character.hollowGateRun, null);
    assert.equal(await kv.get(hollowGateRunKey(PLAYER, token)), null, 'the settled run token is consumed');
});
