"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _card_clash_engine_js_1 = require("./_card-clash-engine.js");
function card(over = {}) {
    return { id: 'c', element: 'None', rarity: 'common', cost: 1, power: 3, ability: 'none', ...over };
}
function deckOf(n, over = {}) {
    return Array.from({ length: n }, (_, i) => card({ id: `c${i}`, ...over }));
}
function side(over = {}) {
    return {
        name: 'P', clan: 'C', defaultDeck: [], deck: [], hand: [],
        chakra: 6, nextDiscount: 0, committed: false, pending: [], ready: true, ...over,
    };
}
function emptyMatch() {
    // training-ground / volcano-pass / river-shrine
    return (0, _card_clash_engine_js_1.createMatch)(['training-ground', 'volcano-pass', 'river-shrine']);
}
// ── Location bonuses (parity with the client engine) ───────────────────────
(0, node_test_1.test)('locationBonus applies the new element/cost/power/all-here effects', () => {
    const def = (effectType) => _card_clash_engine_js_1.CLASH_LOCATIONS.find((l) => l.effectType === effectType);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ element: 'Neutral' }), def('neutralBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ element: 'Fire' }), def('neutralBonus')), 0);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ element: 'None' }), def('noneBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ cost: 3 }), def('midCostBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ cost: 4 }), def('midCostBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ cost: 2 }), def('midCostBonus')), 0);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ element: 'Fire' }), def('allHereBonus')), 1);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ power: 2 }), def('lowPowerBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ power: 9 }), def('lowPowerBonus')), 0);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ power: 9 }), def('highPowerBonus')), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationBonus)(card({ power: 4 }), def('highPowerBonus')), 0);
});
// ── Deck validation ────────────────────────────────────────────────────────
(0, node_test_1.test)('validateSubmittedDeck enforces size, bounds, copy + legendary limits', () => {
    const ok = deckOf(12).map((c, i) => ({ ...c, id: `u${i}` }));
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(ok).ok, true);
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(deckOf(11)).ok, false); // wrong size
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(deckOf(12, { cost: 9 })).ok, false); // cost OOB
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(deckOf(12, { power: 99 })).ok, false); // power OOB
    // 3 copies of one common (limit 2)
    const tooMany = [card({ id: 'x' }), card({ id: 'x' }), card({ id: 'x' }), ...deckOf(9).map((c, i) => ({ ...c, id: `y${i}` }))];
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(tooMany).ok, false);
    // 3 legendaries (cap 2)
    const legs = [
        card({ id: 'l1', rarity: 'legendary' }), card({ id: 'l2', rarity: 'legendary' }), card({ id: 'l3', rarity: 'legendary' }),
        ...deckOf(9).map((c, i) => ({ ...c, id: `z${i}` })),
    ];
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(legs).ok, false);
});
(0, node_test_1.test)('validateSubmittedDeck rejects cheap-but-overpowered cards (cost→power ceiling, audit #8)', () => {
    const withFirst = (over) => deckOf(12).map((c, i) => ({ ...c, id: `u${i}`, ...(i === 0 ? over : {}) }));
    // Forged: an owned weak common submitted as a 1-cost / 2-cost monster.
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 1, power: 12 })).ok, false, 'cost 1 power 12 rejected');
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 1, power: 4 })).ok, false, 'cost 1 power 4 rejected');
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 2, power: 12 })).ok, false, 'cost 2 power 12 rejected');
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 2, power: 7 })).ok, false, 'cost 2 power 7 rejected');
    // Legit values at each ceiling pass unchanged (behavior-preserving).
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 1, power: 3 })).ok, true, 'cost 1 power 3 ok');
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 2, power: 6 })).ok, true, 'cost 2 power 6 ok');
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(withFirst({ cost: 3, power: 12, rarity: 'epic' })).ok, true, 'cost 3 power 12 still allowed (no catalog to tighten)');
});
(0, node_test_1.test)('clashCopyLimit: common/rare 2, epic/legendary 1', () => {
    strict_1.default.equal((0, _card_clash_engine_js_1.clashCopyLimit)('common'), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.clashCopyLimit)('rare'), 2);
    strict_1.default.equal((0, _card_clash_engine_js_1.clashCopyLimit)('epic'), 1);
    strict_1.default.equal((0, _card_clash_engine_js_1.clashCopyLimit)('legendary'), 1);
});
// ── Commit validation ──────────────────────────────────────────────────────
(0, node_test_1.test)('validatePlays rejects overspending chakra', () => {
    const m = emptyMatch();
    const s = side({ chakra: 2, hand: [card({ cost: 2 }), card({ cost: 2 })] });
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [{ handIndex: 0, loc: 0 }, { handIndex: 1, loc: 0 }]).ok, false);
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [{ handIndex: 0, loc: 0 }]).ok, true);
});
(0, node_test_1.test)('validatePlays rejects duplicate hand index and full locations', () => {
    const m = emptyMatch();
    const s = side({ chakra: 6, hand: [card(), card(), card(), card(), card()] });
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [{ handIndex: 0, loc: 0 }, { handIndex: 0, loc: 1 }]).ok, false);
    // 5 cards into one 4-slot location
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [0, 1, 2, 3, 4].map((handIndex) => ({ handIndex, loc: 0 }))).ok, false);
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [0, 1, 2, 3].map((handIndex) => ({ handIndex, loc: 0 }))).ok, true);
});
(0, node_test_1.test)('validatePlays honours discountNextCard in play order', () => {
    const m = emptyMatch();
    // 3 chakra: a discount card (cost 1) then a cost-3 card → discounted to 2 → total 3
    const s = side({ chakra: 3, hand: [card({ cost: 1, ability: 'discountNextCard' }), card({ cost: 3 })] });
    strict_1.default.equal((0, _card_clash_engine_js_1.validatePlays)(m, s, 'p1', [{ handIndex: 0, loc: 0 }, { handIndex: 1, loc: 0 }]).ok, true);
});
// ── Resolution + on-reveal ──────────────────────────────────────────────────
function commitAndResolve(m, p1, p2, p1Plays, p2Plays) {
    p1.pending = p1Plays;
    p2.pending = p2Plays;
    return (0, _card_clash_engine_js_1.resolveTurn)(m, p1, p2, 'p1');
}
(0, node_test_1.test)('resolveTurn places cards, spends chakra, advances + draws', () => {
    const m = emptyMatch();
    const p1 = side({ chakra: 1, hand: [card({ cost: 1, power: 4 })], deck: [card({ id: 'd1' })] });
    const p2 = side({ chakra: 1, hand: [card({ cost: 1, power: 2 })], deck: [card({ id: 'd2' })] });
    const r = commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 0 }], [{ handIndex: 0, loc: 1 }]);
    strict_1.default.equal(r.isFinal, false);
    strict_1.default.equal(m.locations[0].p1.length, 1);
    strict_1.default.equal(m.locations[1].p2.length, 1);
    strict_1.default.equal(m.turn, 2);
    strict_1.default.equal(p1.chakra, 2);
    strict_1.default.equal(p1.hand.length, 1); // played 1, drew 1
});
(0, node_test_1.test)('onRevealDebuffEnemiesHere reduces revealed enemies, respects protection', () => {
    const m = emptyMatch();
    // p2 has a protected card and a normal card already on loc 0 from a prior turn
    m.locations[0].p2.push({ ...card({ id: 'norm', power: 3 }), iid: 'a', owner: 'p2', basePower: 3, currentPower: 3, loc: 0 }, { ...card({ id: 'prot', power: 3 }), iid: 'b', owner: 'p2', basePower: 3, currentPower: 3, loc: 0, protectedFromReduction: true });
    const p1 = side({ chakra: 6, hand: [card({ ability: 'onRevealDebuffEnemiesHere', cost: 1 })] });
    const p2 = side({ chakra: 6, hand: [] });
    commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 0 }], []);
    strict_1.default.equal(m.locations[0].p2[0].currentPower, 2); // normal reduced
    strict_1.default.equal(m.locations[0].p2[1].currentPower, 3); // protected can't go below base
});
(0, node_test_1.test)('summonClone adds a 1-power token; buffSelf adds +2', () => {
    const m = emptyMatch();
    const p1 = side({ chakra: 6, hand: [card({ ability: 'summonClone', cost: 1 }), card({ ability: 'onRevealBuffSelf', cost: 1, power: 5 })] });
    const p2 = side({ chakra: 6, hand: [] });
    commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 0 }, { handIndex: 1, loc: 1 }], []);
    strict_1.default.equal(m.locations[0].p1.length, 2); // card + clone
    strict_1.default.ok(m.locations[0].p1.some((c) => c.isToken && c.currentPower === 1));
    strict_1.default.equal(m.locations[1].p1[0].currentPower, 7); // 5 + 2
});
(0, node_test_1.test)('marquee ability onRevealDoubleSelf doubles power (server)', () => {
    const m = emptyMatch();
    const p1 = side({ chakra: 6, hand: [card({ ability: 'onRevealDoubleSelf', power: 5, cost: 1 })] });
    const p2 = side({ chakra: 6, hand: [] });
    commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 0 }], []);
    strict_1.default.equal(m.locations[0].p1[0].currentPower, 10);
});
(0, node_test_1.test)('marquee buff/debuff-everywhere span all locations (server)', () => {
    const m = emptyMatch();
    m.locations[1].p1.push({ ...card({ id: 'ally', power: 3 }), iid: 'al', owner: 'p1', basePower: 3, currentPower: 3, loc: 1 });
    m.locations[2].p2.push({ ...card({ id: 'en', power: 3 }), iid: 'en', owner: 'p2', basePower: 3, currentPower: 3, loc: 2 });
    const p1 = side({ chakra: 6, hand: [
            card({ ability: 'onRevealBuffAlliesEverywhere', cost: 1 }),
            card({ ability: 'onRevealDebuffEnemiesEverywhere', cost: 1 }),
        ] });
    const p2 = side({ chakra: 6, hand: [] });
    commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 0 }, { handIndex: 1, loc: 0 }], []);
    strict_1.default.equal(m.locations[1].p1[0].currentPower, 4); // ally buffed across locations
    strict_1.default.equal(m.locations[2].p2[0].currentPower, 2); // enemy debuffed across locations
});
(0, node_test_1.test)('validateSubmittedDeck accepts marquee ability strings', () => {
    const deck = deckOf(12).map((c, i) => ({ ...c, id: `u${i}`, ability: 'onRevealDoubleSelf' }));
    strict_1.default.equal((0, _card_clash_engine_js_1.validateSubmittedDeck)(deck).ok, true);
});
(0, node_test_1.test)('location bonus applies in scoring (Fire on Volcano Pass = +2)', () => {
    const m = emptyMatch(); // loc 1 = volcano-pass (fireBonus)
    const p1 = side({ chakra: 6, hand: [card({ element: 'Fire', power: 4, cost: 1 })] });
    const p2 = side({ chakra: 6, hand: [] });
    commitAndResolve(m, p1, p2, [{ handIndex: 0, loc: 1 }], []);
    strict_1.default.equal((0, _card_clash_engine_js_1.locationSidePower)(m.locations[1], 'p1'), 6); // 4 + 2
});
(0, node_test_1.test)('determineWinner: most locations, then board power, else draw', () => {
    const m = emptyMatch();
    const put = (loc, side, power, id) => m.locations[loc][side].push({ ...card({ id, power }), iid: id, owner: side, basePower: power, currentPower: power, loc });
    put(0, 'p1', 5, 'a');
    put(0, 'p2', 2, 'b');
    put(1, 'p1', 5, 'c');
    put(1, 'p2', 2, 'd');
    put(2, 'p2', 9, 'e');
    strict_1.default.equal((0, _card_clash_engine_js_1.determineWinner)(m), 'p1'); // p1 wins 2 of 3
});
// ── Full simulated match ─────────────────────────────────────────────────────
(0, node_test_1.test)('a full 6-turn networked match resolves to a winner', () => {
    const mkDeck = (tag, power) => Array.from({ length: 12 }, (_, i) => card({ id: `${tag}${i}`, power, cost: 1, ability: 'none' }));
    const m = (0, _card_clash_engine_js_1.createMatch)(['training-ground', 'stone-gate', 'wind-bridge']);
    const d1 = (0, _card_clash_engine_js_1.dealOpening)(mkDeck('a', 5));
    const d2 = (0, _card_clash_engine_js_1.dealOpening)(mkDeck('b', 3));
    const p1 = side({ chakra: 1, hand: d1.hand, deck: d1.rest });
    const p2 = side({ chakra: 1, hand: d2.hand, deck: d2.rest });
    let final = false;
    let guard = 0;
    while (!final && guard < 10) {
        guard++;
        // each side plays its first affordable card into a location with room
        const stage = (s) => {
            if (s.hand.length === 0)
                return [];
            const loc = m.locations.findIndex((l) => (s === p1 ? l.p1 : l.p2).length < 4);
            return loc >= 0 && s.hand[0].cost <= s.chakra ? [{ handIndex: 0, loc }] : [];
        };
        p1.pending = stage(p1);
        p2.pending = stage(p2);
        final = (0, _card_clash_engine_js_1.resolveTurn)(m, p1, p2, 'p1').isFinal;
    }
    strict_1.default.equal(m.turn, 6);
    strict_1.default.ok(['p1', 'p2', 'draw'].includes((0, _card_clash_engine_js_1.determineWinner)(m)));
    // p1's stronger cards should generally win, but at minimum the game completes.
});
