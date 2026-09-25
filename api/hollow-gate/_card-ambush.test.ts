import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHollowGateStepState } from './step.js';
import { cardClashAiTokenKey } from '../card-clash/_ai-reward.js';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let start: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
let settle: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
let descend: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
let endRun: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    start = (await import('./card-start.js')).default as unknown as typeof start;
    settle = (await import('./card-settle.js')).default as unknown as typeof settle;
    descend = (await import('./descend.js')).default as unknown as typeof descend;
    endRun = (await import('./settle.js')).default as unknown as typeof endRun;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: typeof settle, body: Record<string, unknown>) {
    const result: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (data: Record<string, unknown>) => { result.body = data; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { ...body, playerName: 'riftplayer' }, query: {},
        headers: { 'x-player-name': 'riftplayer', 'x-player-token': issuePlayerToken('riftplayer') },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

test('only the first threat ambush in a rift is a card duel; the boss remains combat', () => {
    const base = { torch: 5, threat: 96, wardSteps: 0, stepVersion: 8, currentFloor: 1, floorDepth: 1, variantId: 'rift-legacy-echo' };
    const first = deriveHollowGateStepState(base, false);
    assert.deepEqual(first.pendingAmbush, { nodeId: 'floor:1:ambush:threat-v9', kind: 'card' });
    const later = deriveHollowGateStepState({ ...base, resolvedEncounterIds: ['1:card:floor:1:ambush:threat-v9'] }, false);
    assert.equal(later.pendingAmbush?.kind, 'boss');
    assert.equal(deriveHollowGateStepState({ ...base, variantId: undefined }, false).pendingAmbush?.kind, 'boss');
    // Card ambushes open at level 20; below that the threat raises a normal fight.
    assert.equal(deriveHollowGateStepState(base, false, 20).pendingAmbush?.kind, 'card');
    assert.equal(deriveHollowGateStepState(base, false, 19).pendingAmbush?.kind, 'boss');
});

test('starting a card ambush binds one resumable Chronicle match to the run', async () => {
    const token = 'card-start-token';
    const nodeId = 'floor:1:ambush:threat-v9';
    await kv.set(hollowGateRunKey('riftplayer', token), {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 1, currentFloor: 1,
        seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-legacy-echo',
        pendingAmbush: { nodeId, kind: 'card' },
    } satisfies HollowGateRunToken);
    await kv.set('save:riftplayer', { character: { name: 'riftplayer', hollowGateRun: { runToken: token, floor: 1 } }, _saveVersion: 1 });
    const wrongNode = await call(start, { token, nodeId: 'floor:1:ambush:threat-v10' });
    assert.equal(wrongNode.status, 409);
    const first = await call(start, { token, nodeId });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const matchId = String(first.body?.matchId ?? '');
    assert.match(matchId, /^[0-9a-f-]{36}$/);
    const second = await call(start, { token, nodeId });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body?.matchId, matchId);
    const stored = await kv.get<{ playerName: string; settlementMode: string; hollowGateCard: { nodeId: string } }>(cardClashAiTokenKey(matchId));
    assert.equal(stored?.playerName, 'riftplayer');
    assert.equal(stored?.settlementMode, 'external');
    assert.equal(stored?.hollowGateCard.nodeId, nodeId);
});

test('a card ambush fights with the player\'s own legal deck and lends one only when there is none', async () => {
    const nodeId = 'floor:1:ambush:threat-v9';
    const deck = [...CHRONICLE_FIXED_FALLBACK_DECK];
    const cases = [
        // Card Hall opened: the deck resolves exactly as every Chronicle start.
        { label: 'opened', character: { starterCardsClaimed: true, tileCards: deck, cardClashDeck: deck }, loaner: false },
        // Still sealed but already owns a legal deck: read it, write nothing.
        { label: 'sealed-owned', character: { tileCards: deck, cardClashDeck: deck }, loaner: false },
        // Still sealed and the saved list is not backed by owned cards: lend.
        { label: 'sealed-unowned', character: { tileCards: [], cardClashDeck: deck }, loaner: true },
        { label: 'sealed-empty', character: {}, loaner: true },
    ];
    for (const entry of cases) {
        const token = `card-deck-${entry.label}`;
        await kv.set(hollowGateRunKey('riftplayer', token), {
            playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 1, currentFloor: 1,
            seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
            chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-legacy-echo',
            pendingAmbush: { nodeId, kind: 'card' },
        } satisfies HollowGateRunToken);
        // Card ambushes open at level 20, and the Chronicle opens separately,
        // with the Scribe's starter-card claim, so a level-20 player can still
        // have it sealed.
        await kv.set('save:riftplayer', { _saveVersion: 1, character: {
            name: 'riftplayer', level: 20, hollowGateRun: { runToken: token, floor: 1 }, ...entry.character,
        } });
        const before = await kv.get('save:riftplayer');
        const started = await call(start, { token, nodeId });
        assert.equal(started.status, 200, `${entry.label}: ${JSON.stringify(started.body)}`);
        assert.equal(started.body?.loanerDeck === true, entry.loaner, entry.label);
        const session = await kv.get<{ hollowGateCard: { loanerDeck?: boolean } }>(cardClashAiTokenKey(String(started.body?.matchId)));
        assert.equal(session?.hollowGateCard.loanerDeck === true, entry.loaner, entry.label);
        if (entry.label !== 'opened') {
            assert.deepEqual(await kv.get('save:riftplayer'), before, `${entry.label}: a sealed Chronicle is never written to`);
        }
    }

    // Below level 20 a card ambush is refused and nothing is bound.
    const token = 'card-deck-underleveled';
    await kv.set(hollowGateRunKey('riftplayer', token), {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 1, currentFloor: 1,
        seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-legacy-echo',
        pendingAmbush: { nodeId, kind: 'card' },
    } satisfies HollowGateRunToken);
    await kv.set('save:riftplayer', { _saveVersion: 1, character: {
        name: 'riftplayer', level: 19, hollowGateRun: { runToken: token, floor: 1 },
    } });
    const refused = await call(start, { token, nodeId });
    assert.equal(refused.status, 409);
    assert.match(String(refused.body?.error), /unlock at level 20/);
    assert.equal((await kv.get<HollowGateRunToken>(hollowGateRunKey('riftplayer', token)))?.cardAmbushMatchId, undefined);
});

test('pending card ambush blocks staircase descent and normal extraction', async () => {
    const token = 'card-route-token';
    const pendingAmbush = { nodeId: 'floor:1:ambush:threat-v9', kind: 'card' as const };
    await kv.set(hollowGateRunKey('riftplayer', token), {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 2, currentFloor: 1,
        seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-hollow-stalker', pendingAmbush,
    } satisfies HollowGateRunToken);
    const stairs = await call(descend, { token, fromFloor: 1 });
    assert.equal(stairs.status, 409);
    assert.deepEqual(stairs.body?.pendingAmbush, pendingAmbush);
    const extraction = await call(endRun, { token, action: 'extract' });
    assert.equal(extraction.status, 409);
    assert.deepEqual(extraction.body?.pendingAmbush, pendingAmbush);
});

test('card settlement rejects an unrelated match and applies a loss once', async () => {
    const token = 'card-test-token';
    const nodeId = 'floor:1:ambush:threat-v9';
    const matchId = randomUUID();
    const run: HollowGateRunToken = {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 1, currentFloor: 1,
        seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-legacy-echo',
        pendingAmbush: { nodeId, kind: 'card' }, cardAmbushMatchId: matchId,
    };
    await kv.set(hollowGateRunKey('riftplayer', token), run);
    await kv.set('save:riftplayer', { character: { name: 'riftplayer', hp: 80, maxHp: 100,
        hollowGateRun: { runToken: token, floor: 1, threat: 100 } }, _saveVersion: 1 });
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: 'riftplayer',
        status: 'active', settlementMode: 'external',
        hollowGateCard: { tokenDigest: createHash('sha256').update(token).digest('hex'), nodeId } });
    const wrong = await call(settle, { token, matchId: randomUUID() });
    assert.equal(wrong.status, 409);
    const unfinished = await call(settle, { token, matchId });
    assert.equal(unfinished.status, 409);
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: 'riftplayer',
        status: 'done', winner: 'opponent', settledAt: Date.now(), settlementMode: 'external',
        hollowGateCard: { tokenDigest: createHash('sha256').update(token).digest('hex'), nodeId } });
    const first = await call(settle, { token, matchId });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body?.won, false);
    const saved = await kv.get<{ character: { hp: number; hollowGateRun: { threat: number }; settledHollowGateEventIds: string[] } }>('save:riftplayer');
    assert.equal(saved?.character.hp, 60);
    assert.equal(saved?.character.hollowGateRun.threat, 0);
    assert.deepEqual(saved?.character.settledHollowGateEventIds, [`card:1:card:${nodeId}`, `card:${matchId}`],
        'the receipt names the ambush encounter as well as the match');
    const cleared = await kv.get<HollowGateRunToken>(hollowGateRunKey('riftplayer', token));
    assert.equal(cleared?.pendingAmbush, null);
    assert.deepEqual(cleared?.resolvedEncounterIds, [`1:card:${nodeId}`]);
    const replay = await call(settle, { token, matchId });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const savedAgain = await kv.get<{ character: { hp: number } }>('save:riftplayer');
    assert.equal(savedAgain?.character.hp, 60);
});

test('a card win banks the normal ambush currency once in save and run ledger', async () => {
    const token = 'card-win-token';
    const nodeId = 'floor:1:ambush:threat-v30';
    const matchId = randomUUID();
    const run: HollowGateRunToken = {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 2, currentFloor: 1,
        seed: 'seed', entryCurrencies: { ryo: 100, auraDust: 2 }, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-hollow-stalker',
        pendingAmbush: { nodeId, kind: 'card' }, cardAmbushMatchId: matchId,
    };
    await kv.set(hollowGateRunKey('riftplayer', token), run);
    await kv.set('save:riftplayer', { character: { name: 'riftplayer', hp: 80, maxHp: 100,
        ryo: 100, auraDust: 2, hollowGateRun: { runToken: token, floor: 1, threat: 100 } }, _saveVersion: 1 });
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: 'riftplayer',
        status: 'done', winner: 'player', settledAt: Date.now(), settlementMode: 'external',
        hollowGateCard: { tokenDigest: createHash('sha256').update(token).digest('hex'), nodeId } });
    const reward = hollowGateCombatReward(1, 'ambush');
    const multiplier = rewardMultiplierForToken(run);
    const expectedRyo = Math.floor(reward.ryo * multiplier);
    const expectedDust = Math.floor(reward.auraDust * multiplier);
    const first = await call(settle, { token, matchId });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body?.won, true);
    await call(settle, { token, matchId });
    const saved = await kv.get<{ character: { ryo: number; auraDust: number; hp: number } }>('save:riftplayer');
    const updatedRun = await kv.get<HollowGateRunToken>(hollowGateRunKey('riftplayer', token));
    assert.equal(saved?.character.ryo, 100 + expectedRyo);
    assert.equal(saved?.character.auraDust, 2 + expectedDust);
    assert.equal(saved?.character.hp, 80);
    assert.equal(updatedRun?.rewardLedger?.currencies.ryo, expectedRyo);
    assert.equal(updatedRun?.rewardLedger?.currencies.auraDust, expectedDust);
    assert.deepEqual(updatedRun?.rewardLedger?.sourceIds, [`card:1:card:${nodeId}`]);
});

type SaveWithWallet = { character: { ryo: number; auraDust: number; hollowGateExternalCredits?: unknown; settledHollowGateEventIds?: string[] } };
const digestOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A won-or-lost terminal Chronicle match bound to `token`'s ambush `nodeId`. */
async function terminalMatch(token: string, nodeId: string, winner: 'player' | 'opponent', matchId = randomUUID()) {
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: 'riftplayer',
        status: 'done', winner, settledAt: Date.now(), settlementMode: 'external',
        hollowGateCard: { tokenDigest: digestOf(token), nodeId } });
    return matchId;
}

async function sealedCardAmbush(token: string, nodeId: string, matchId: string, overrides: Partial<HollowGateRunToken> = {}) {
    const run: HollowGateRunToken = {
        playerName: 'riftplayer', mintedAt: Date.now() - 600_000, floorDepth: 2, currentFloor: 1,
        seed: 'seed', entryCurrencies: { ryo: 100, auraDust: 2 }, entryItems: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-hollow-stalker',
        pendingAmbush: { nodeId, kind: 'card' }, cardAmbushMatchId: matchId, ...overrides,
    };
    await kv.set(hollowGateRunKey('riftplayer', token), run);
    await kv.set('save:riftplayer', { character: { name: 'riftplayer', hp: 80, maxHp: 100,
        ryo: 100, auraDust: 2, itemStacks: [], hollowGateRun: { runToken: token, floor: 1, threat: 100 } }, _saveVersion: 1 });
    return run;
}

test('card ambush winnings are run loot: death keeps only the retention share', async () => {
    // Probe from the 2026-09-24 review: entry 100 ryo, a floor-1 card win,
    // then an abandoned (death) run kept the whole win because the save write
    // recorded it as an external credit.
    const token = 'card-death-token';
    const nodeId = 'floor:1:ambush:threat-v12';
    const matchId = await terminalMatch(token, nodeId, 'player');
    const run = await sealedCardAmbush(token, nodeId, matchId);
    const won = await call(settle, { token, matchId });
    assert.equal(won.status, 200, JSON.stringify(won.body));
    const reward = hollowGateCombatReward(1, 'ambush');
    const multiplier = rewardMultiplierForToken(run);
    const ryoWin = Math.floor(reward.ryo * multiplier);
    const dustWin = Math.floor(reward.auraDust * multiplier);
    const afterWin = (await kv.get<SaveWithWallet>('save:riftplayer'))!;
    assert.equal(afterWin.character.ryo, 100 + ryoWin, 'the win is paid immediately');
    const { hollowGateExternalCredits } = await import('./_external-credits.js');
    assert.deepEqual(hollowGateExternalCredits(afterWin.character, token), {}, 'the win is not an external credit');

    const died = await call(endRun, { token, action: 'abandon' });
    assert.equal(died.status, 200, JSON.stringify(died.body));
    const afterDeath = (await kv.get<SaveWithWallet>('save:riftplayer'))!;
    assert.equal(afterDeath.character.ryo, 100 + Math.floor(ryoWin * 0.5), 'death keeps half the run loot, as for combat wins');
    assert.equal(afterDeath.character.auraDust, 2 + Math.floor(dustWin * 0.5));
});

test('a second Chronicle match for an already-settled ambush pays nothing', async () => {
    // After a Chronicle rules-version bump, card-start mints a fresh match for
    // the same ambush and leaves the old one (here already won) behind.
    const token = 'card-double-token';
    const nodeId = 'floor:1:ambush:threat-v20';
    const oldMatch = await terminalMatch(token, nodeId, 'player');
    const newMatch = await terminalMatch(token, nodeId, 'player');
    const run = await sealedCardAmbush(token, nodeId, newMatch);
    const ryoWin = Math.floor(hollowGateCombatReward(1, 'ambush').ryo * rewardMultiplierForToken(run));

    const first = await call(settle, { token, matchId: newMatch });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await kv.get<SaveWithWallet>('save:riftplayer'))!.character.ryo, 100 + ryoWin);

    const second = await call(settle, { token, matchId: oldMatch });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.match(String(second.body?.error), /already settled/);
    assert.equal((await kv.get<SaveWithWallet>('save:riftplayer'))!.character.ryo, 100 + ryoWin, 'the ambush paid once');

    // The match that did settle still replays idempotently after a lost reply.
    const replay = await call(settle, { token, matchId: newMatch });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal((await kv.get<SaveWithWallet>('save:riftplayer'))!.character.ryo, 100 + ryoWin);
});

test('a save settled before encounter receipts existed keeps its match receipt honored', async () => {
    // Pre-change settlement wrote only `card:<matchId>` and resolved the
    // encounter on the run. That exact match must still replay, and any other
    // match for the same ambush must still be refused.
    const token = 'card-legacy-token';
    const nodeId = 'floor:1:ambush:threat-v31';
    const settledMatch = await terminalMatch(token, nodeId, 'player');
    const otherMatch = await terminalMatch(token, nodeId, 'player');
    await sealedCardAmbush(token, nodeId, settledMatch, {
        pendingAmbush: null, cardAmbushMatchId: null, threat: 0,
        resolvedEncounterIds: [`1:card:${nodeId}`],
        rewardLedger: { currencies: { ryo: 1000 }, items: {}, sourceIds: [`card:1:card:${nodeId}`] },
    });
    const legacy = (await kv.get<Record<string, any>>('save:riftplayer'))!;
    legacy.character.ryo = 1100;
    legacy.character.settledHollowGateEventIds = [`card:${settledMatch}`];
    await kv.set('save:riftplayer', legacy);

    const replay = await call(settle, { token, matchId: settledMatch });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const refused = await call(settle, { token, matchId: otherMatch });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    const after = (await kv.get<SaveWithWallet>('save:riftplayer'))!;
    assert.equal(after.character.ryo, 1100);
    assert.deepEqual(after.character.settledHollowGateEventIds, [`card:${settledMatch}`]);
});
