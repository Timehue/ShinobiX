"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _ranked_season_js_1 = require("./_ranked-season.js");
(0, node_test_1.test)('softResetRating pulls halfway to 1000', () => {
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(1000), 1000);
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(1400), 1200);
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(600), 800);
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(2000), 1500);
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(0), 500);
    // missing / non-numeric → treated as the default, so no change
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)(undefined), 1000);
    strict_1.default.equal((0, _ranked_season_js_1.softResetRating)('abc'), 1000);
    // never goes negative
    strict_1.default.ok((0, _ranked_season_js_1.softResetRating)(-5000) >= 0);
});
const E = (slug, rating) => ({ slug, name: slug, rating });
(0, node_test_1.test)('leaderboard sorts by rating desc, ranks, caps at n', () => {
    const lb = (0, _ranked_season_js_1.leaderboard)([E('a', 1100), E('b', 1500), E('c', 900), E('d', 1300)], 3);
    strict_1.default.deepEqual(lb.map((e) => e.slug), ['b', 'd', 'a']);
    strict_1.default.deepEqual(lb.map((e) => e.rank), [1, 2, 3]);
});
(0, node_test_1.test)('rewardPodium only includes players above the default', () => {
    const pod = (0, _ranked_season_js_1.rewardPodium)([E('won', 1400), E('even', 1000), E('lost', 800), E('mid', 1100)]);
    strict_1.default.deepEqual(pod.map((e) => e.slug), ['won', 'mid']); // 1000 and 800 excluded
    strict_1.default.deepEqual(pod.map((e) => e.rank), [1, 2]);
});
(0, node_test_1.test)('rewardPodium caps at 3', () => {
    const pod = (0, _ranked_season_js_1.rewardPodium)([E('a', 1500), E('b', 1400), E('c', 1300), E('d', 1200)]);
    strict_1.default.equal(pod.length, 3);
});
(0, node_test_1.test)('nextSeason increments id and chains the window', () => {
    const now = 1_000_000_000_000;
    const cur = { id: 3, startedAt: now - _ranked_season_js_1.SEASON_LENGTH_MS, endsAt: now - 1000 };
    const next = (0, _ranked_season_js_1.nextSeason)(cur, now);
    strict_1.default.equal(next.id, 4);
    strict_1.default.equal(next.startedAt, cur.endsAt); // chains from the old end
    strict_1.default.equal(next.endsAt, cur.endsAt + _ranked_season_js_1.SEASON_LENGTH_MS);
});
(0, node_test_1.test)('nextSeason from null starts season 1', () => {
    const next = (0, _ranked_season_js_1.nextSeason)(null, 5000);
    strict_1.default.equal(next.id, 1);
    strict_1.default.equal(next.startedAt, 5000);
});
(0, node_test_1.test)('computeRewards: champion gets relic + top aura; runners-up get aura only', () => {
    const playerPod = [
        { slug: 'champ', name: 'champ', rating: 1500, rank: 1 },
        { slug: 'second', name: 'second', rating: 1300, rank: 2 },
        { slug: 'third', name: 'third', rating: 1100, rank: 3 },
    ];
    const rewards = (0, _ranked_season_js_1.computeRewards)(playerPod, []);
    strict_1.default.deepEqual(rewards.get('champ'), { auraStones: _ranked_season_js_1.PODIUM_AURA_STONES[0], relics: 1, championOf: ['player'] });
    strict_1.default.deepEqual(rewards.get('second'), { auraStones: _ranked_season_js_1.PODIUM_AURA_STONES[1], relics: 0, championOf: [] });
    strict_1.default.deepEqual(rewards.get('third'), { auraStones: _ranked_season_js_1.PODIUM_AURA_STONES[2], relics: 0, championOf: [] });
});
(0, node_test_1.test)('computeRewards: winning both ladders aggregates relics + aura', () => {
    const top = (slug) => [{ slug, name: slug, rating: 1500, rank: 1 }];
    const rewards = (0, _ranked_season_js_1.computeRewards)(top('ace'), top('ace'));
    const r = rewards.get('ace');
    strict_1.default.equal(r?.relics, 2);
    strict_1.default.equal(r?.auraStones, _ranked_season_js_1.PODIUM_AURA_STONES[0] * 2);
    strict_1.default.deepEqual(r?.championOf, ['player', 'pet']);
});
