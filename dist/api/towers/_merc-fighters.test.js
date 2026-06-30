"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _merc_fighters_js_1 = require("./_merc-fighters.js");
const NOW = 1_700_000_000_000;
const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'taijutsuOffense', 'taijutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
function statsAt(v) {
    const s = {};
    for (const k of STAT_KEYS)
        s[k] = v;
    return s;
}
// A clearly out-classed defender: low stats, low HP, no jutsu (basic attacks only).
function weakPlayer() {
    return {
        level: 35, specialty: 'Taijutsu', stats: statsAt(350),
        jutsu: [], jutsuMastery: [], equipment: {}, pvpItems: [],
        bloodlineMult: 1, itemDamagePct: 0, armorRawDR: 0.1,
        maxHp: 1600, maxChakra: 300, maxStamina: 300,
    };
}
// A maxed, well-built defender: capped stats, a higher-EP kit, bloodline + item
// damage, big HP — should out-gun the no-bloodline merc.
function strongPlayer() {
    const jutsu = ['Fire', 'Water', 'Wind', 'Lightning'].map((el, i) => ({
        id: `p-strike-${i}`, name: `Player Strike ${el}`, type: 'Taijutsu', element: el,
        ap: 60, range: 5, effectPower: 60, cooldown: 4, chakraCost: 200, staminaCost: 200,
        target: 'OPPONENT', method: 'SINGLE', tags: [],
    }));
    return {
        level: 100, specialty: 'Taijutsu', stats: statsAt(2500),
        jutsu, jutsuMastery: jutsu.map((j) => ({ jutsuId: j.id, level: 50 })),
        equipment: { hand: 'p-weapon' },
        pvpItems: [{ id: 'p-weapon', name: 'Player Blade', slot: 'hand', weaponEp: 40, weaponElement: 'None', weaponRange: 1, apCost: 40, weaponTags: [] }],
        bloodlineMult: 1.5, itemDamagePct: 30, armorRawDR: 0.55,
        maxHp: 6800, maxChakra: 2200, maxStamina: 1600,
    };
}
(0, node_test_1.test)('buildMercCharacter is peak: capped stats + max-mastery kit, by tier', () => {
    const c = (0, _merc_fighters_js_1.buildMercCharacter)(100);
    strict_1.default.equal(c.level, 100);
    strict_1.default.equal(c.stats.strength, 2500);
    strict_1.default.equal(c.stats.taijutsuOffense, 2500);
    strict_1.default.equal(c.jutsu.length, 6);
    strict_1.default.ok(c.jutsuMastery.every((m) => m.level === 50), 'all jutsu at max mastery');
    strict_1.default.equal(c.bloodlineMult, 1, 'no bloodline bonus — kept fair');
    // A lower tier (level 75) caps at the Jonin ceiling.
    strict_1.default.equal((0, _merc_fighters_js_1.buildMercCharacter)(75).stats.strength, 2100);
});
(0, node_test_1.test)('resolveMercBattle is deterministic (same seed → same winner)', () => {
    const a = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: 'p', playerSlug: 'p', playerSealedChar: weakPlayer(), mercLevel: 100, seed: 7, now: NOW });
    const b = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: 'p', playerSlug: 'p', playerSealedChar: weakPlayer(), mercLevel: 100, seed: 7, now: NOW });
    strict_1.default.equal(a.winner, b.winner);
    strict_1.default.equal(a.rounds, b.rounds);
    strict_1.default.ok(a.rounds > 0);
    strict_1.default.ok(['merc', 'player', 'stall'].includes(a.winner));
});
(0, node_test_1.test)('a warlord merc beats a clearly out-classed defender', () => {
    // Try a few seeds — the merc should win the vast majority vs a weak player.
    let mercWins = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
        const r = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: 'weak', playerSlug: 'weak', playerSealedChar: weakPlayer(), mercLevel: 100, seed, now: NOW });
        if (r.mercWon)
            mercWins++;
    }
    strict_1.default.ok(mercWins >= 4, `merc should beat a weak player on most seeds (won ${mercWins}/5)`);
});
(0, node_test_1.test)('a maxed, well-built defender can beat the merc', () => {
    // Across seeds, a strong player should take at least some wins off the merc
    // (the merc is beatable, not an auto-flip).
    let playerWins = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const r = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: 'strong', playerSlug: 'strong', playerSealedChar: strongPlayer(), mercLevel: 100, seed, now: NOW });
        if (r.playerWon)
            playerWins++;
    }
    strict_1.default.ok(playerWins >= 1, `a strong player should be able to beat the merc (won ${playerWins}/8)`);
});
