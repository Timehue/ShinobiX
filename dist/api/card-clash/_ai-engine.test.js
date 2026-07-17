"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const _card_clash_engine_js_1 = require("../clan/war/_card-clash-engine.js");
const _ai_engine_js_1 = require("./_ai-engine.js");
// A legal 12-card deck of distinct commons (canonical stats from the catalog).
const TWELVE_COMMONS = Object.keys(_card_catalog_js_1.BUILTIN_CLASH).filter((id) => _card_catalog_js_1.BUILTIN_CLASH[id].rarity === 'common').slice(0, 12);
function deckFrom(ids) {
    return ids.map((id) => ({ id, ..._card_catalog_js_1.BUILTIN_CLASH[id] }));
}
(0, node_test_1.test)('generateAiServerDeck builds a legal 12-card built-in deck', () => {
    for (let level = 1; level <= 60; level += 12) {
        const deck = (0, _ai_engine_js_1.generateAiServerDeck)(level);
        strict_1.default.equal(deck.length, _card_clash_engine_js_1.CLASH_DECK_SIZE, `level ${level} deck size`);
        const counts = {};
        let legendary = 0;
        for (const c of deck) {
            strict_1.default.ok(_card_catalog_js_1.BUILTIN_CLASH[c.id], `AI fielded a non-builtin card ${c.id}`);
            counts[c.id] = (counts[c.id] ?? 0) + 1;
            strict_1.default.ok(counts[c.id] <= (0, _card_clash_engine_js_1.clashCopyLimit)(c.rarity), `too many copies of ${c.id}`);
            if (c.rarity === 'legendary')
                legendary++;
        }
        strict_1.default.ok(legendary <= _card_clash_engine_js_1.CLASH_MAX_LEGENDARY, `level ${level} legendary cap`);
    }
});
(0, node_test_1.test)('a passive player LOSES — the engine never hands a win to a player who plays nothing', () => {
    // The core reward-integrity property: the winner is computed from the board.
    // A player who places no cards has zero power everywhere; the greedy AI accrues
    // board power, so the server-computed winner is the opponent.
    const session = (0, _ai_engine_js_1.createAiMatch)('m-passive', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    let guard = 0;
    while (session.status === 'active' && guard++ < 20)
        (0, _ai_engine_js_1.endTurn)(session);
    strict_1.default.equal(session.status, 'done');
    strict_1.default.equal(session.winner, 'opponent');
});
(0, node_test_1.test)('a player who controls the board WINS — determineWinner drives the result', () => {
    // Hand-build the mirror case: the AI has no cards to play, so only the player
    // ever places → the player controls a location and the server winner is player.
    const session = (0, _ai_engine_js_1.createAiMatch)('m-win', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    session.ai.hand = [];
    session.ai.deck = [];
    session.match.turn = 6; // one End-Turn finishes the match
    session.player.chakra = 6;
    strict_1.default.equal((0, _ai_engine_js_1.playOne)(session, 'p1', 0, 0).ok, true);
    (0, _ai_engine_js_1.endTurn)(session);
    strict_1.default.equal(session.status, 'done');
    strict_1.default.equal(session.winner, 'player');
});
(0, node_test_1.test)('forfeit is an immediate opponent win', () => {
    const session = (0, _ai_engine_js_1.createAiMatch)('m-forfeit', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    (0, _ai_engine_js_1.forfeit)(session);
    strict_1.default.equal(session.status, 'done');
    strict_1.default.equal(session.winner, 'opponent');
});
(0, node_test_1.test)('playOne rejects illegal plays (bad index, full location, unaffordable)', () => {
    const session = (0, _ai_engine_js_1.createAiMatch)('m-illegal', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    strict_1.default.equal((0, _ai_engine_js_1.playOne)(session, 'p1', 99, 0).ok, false); // no such hand card
    strict_1.default.equal((0, _ai_engine_js_1.playOne)(session, 'p1', 0, 99).ok, false); // no such location
    // Turn 1 has 1 chakra; a cost>1 card is unaffordable. (Commons are cost 1-2.)
    const dear = session.player.hand.findIndex((c) => c.cost > 1);
    if (dear >= 0)
        strict_1.default.equal((0, _ai_engine_js_1.playOne)(session, 'p1', dear, 0).ok, false);
});
(0, node_test_1.test)('the AI hand and deck contents are never projected to the client', () => {
    const session = (0, _ai_engine_js_1.createAiMatch)('m-proj', 'tester', deckFrom(TWELVE_COMMONS), 30, Date.now());
    const proj = (0, _ai_engine_js_1.projectAiMatch)(session);
    strict_1.default.equal(typeof proj.opponentHandCount, 'number');
    strict_1.default.equal(typeof proj.opponentDeckCount, 'number');
    strict_1.default.equal('ai' in proj, false);
    strict_1.default.equal('opponentHand' in proj, false);
    strict_1.default.equal('opponentDeck' in proj, false);
});
