import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';
import {
    CLASH_DECK_SIZE,
    CLASH_MAX_LEGENDARY,
    clashCopyLimit,
    type ClashCard,
} from '../clan/war/_card-clash-engine.js';
import {
    createAiMatch,
    endTurn,
    forfeit,
    generateAiServerDeck,
    playOne,
    projectAiMatch,
} from './_ai-engine.js';

// A legal 12-card deck of distinct commons (canonical stats from the catalog).
const TWELVE_COMMONS = Object.keys(BUILTIN_CLASH).filter((id) => BUILTIN_CLASH[id].rarity === 'common').slice(0, 12);
function deckFrom(ids: string[]): ClashCard[] {
    return ids.map((id) => ({ id, ...BUILTIN_CLASH[id] }));
}

test('generateAiServerDeck builds a legal 12-card built-in deck', () => {
    for (let level = 1; level <= 60; level += 12) {
        const deck = generateAiServerDeck(level);
        assert.equal(deck.length, CLASH_DECK_SIZE, `level ${level} deck size`);
        const counts: Record<string, number> = {};
        let legendary = 0;
        for (const c of deck) {
            assert.ok(BUILTIN_CLASH[c.id], `AI fielded a non-builtin card ${c.id}`);
            counts[c.id] = (counts[c.id] ?? 0) + 1;
            assert.ok(counts[c.id] <= clashCopyLimit(c.rarity), `too many copies of ${c.id}`);
            if (c.rarity === 'legendary') legendary++;
        }
        assert.ok(legendary <= CLASH_MAX_LEGENDARY, `level ${level} legendary cap`);
    }
});

test('a passive player LOSES — the engine never hands a win to a player who plays nothing', () => {
    // The core reward-integrity property: the winner is computed from the board.
    // A player who places no cards has zero power everywhere; the greedy AI accrues
    // board power, so the server-computed winner is the opponent.
    const session = createAiMatch('m-passive', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    let guard = 0;
    while (session.status === 'active' && guard++ < 20) endTurn(session);
    assert.equal(session.status, 'done');
    assert.equal(session.winner, 'opponent');
});

test('a player who controls the board WINS — determineWinner drives the result', () => {
    // Hand-build the mirror case: the AI has no cards to play, so only the player
    // ever places → the player controls a location and the server winner is player.
    const session = createAiMatch('m-win', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    session.ai.hand = [];
    session.ai.deck = [];
    session.match.turn = 6;       // one End-Turn finishes the match
    session.player.chakra = 6;
    assert.equal(playOne(session, 'p1', 0, 0).ok, true);
    endTurn(session);
    assert.equal(session.status, 'done');
    assert.equal(session.winner, 'player');
});

test('forfeit is an immediate opponent win', () => {
    const session = createAiMatch('m-forfeit', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    forfeit(session);
    assert.equal(session.status, 'done');
    assert.equal(session.winner, 'opponent');
});

test('playOne rejects illegal plays (bad index, full location, unaffordable)', () => {
    const session = createAiMatch('m-illegal', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    assert.equal(playOne(session, 'p1', 99, 0).ok, false);      // no such hand card
    assert.equal(playOne(session, 'p1', 0, 99).ok, false);      // no such location
    // Turn 1 has 1 chakra; a cost>1 card is unaffordable. (Commons are cost 1-2.)
    const dear = session.player.hand.findIndex((c) => c.cost > 1);
    if (dear >= 0) assert.equal(playOne(session, 'p1', dear, 0).ok, false);
});

test('the AI hand and deck contents are never projected to the client', () => {
    const session = createAiMatch('m-proj', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    const proj = projectAiMatch(session) as unknown as Record<string, unknown>;
    assert.equal(typeof proj.opponentHandCount, 'number');
    assert.equal(typeof proj.opponentDeckCount, 'number');
    assert.equal('ai' in proj, false);
    assert.equal('opponentHand' in proj, false);
    assert.equal('opponentDeck' in proj, false);
});
