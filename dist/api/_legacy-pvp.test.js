"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _legacy_pvp_js_1 = require("./_legacy-pvp.js");
function fighter(name, opts = {}) {
    return {
        name,
        hp: opts.hp ?? 500,
        maxHp: opts.maxHp ?? 1000,
        character: { level: opts.level ?? 50, specialty: opts.specialty ?? 'Ninjutsu' },
    };
}
(0, node_test_1.test)('rank bands mirror the level thresholds', () => {
    strict_1.default.equal((0, _legacy_pvp_js_1.rankBand)(1), 0); // Academy
    strict_1.default.equal((0, _legacy_pvp_js_1.rankBand)(15), 1); // Genin
    strict_1.default.equal((0, _legacy_pvp_js_1.rankBand)(30), 2); // Chunin
    strict_1.default.equal((0, _legacy_pvp_js_1.rankBand)(50), 3); // Jonin
    strict_1.default.equal((0, _legacy_pvp_js_1.rankBand)(80), 4); // Special Jonin
});
(0, node_test_1.test)('extract parses the battle log with exact move.ts line formats', () => {
    const session = {
        p1: fighter('Rill', { specialty: 'Genjutsu', level: 52 }),
        p2: fighter('Kazan', { specialty: 'Taijutsu', level: 55 }),
        log: [
            'Rill casts Moonlit Slash.',
            '250 damage to Kazan.', // Rill dealt 250
            'Heal: Rill restores 750 HP.', // Rill healed 750
            'Shield: Kazan gains 750 shield.', // Kazan: 1 shield cast
            '120 absorbed by Kazan\'s shield.', // Kazan blocked 120
            '90 damage to Rill.', // Kazan dealt 90
            'Kazan bleeds 40 (Wound).', // Rill's DoT: +40 to Rill's damage
        ],
    };
    const { winnerDeltas, loserDeltas } = (0, _legacy_pvp_js_1.extractPvpLegacyDeltas)(session, 'Rill', 'Kazan');
    strict_1.default.equal(winnerDeltas.pvpWins, 1);
    strict_1.default.equal(winnerDeltas.pvpKills, 1);
    strict_1.default.equal(winnerDeltas.genjutsuKills, 1, 'style kill follows the winner specialty');
    strict_1.default.equal(winnerDeltas.genjutsuDamage, 290, '250 direct + 40 wound tick');
    strict_1.default.equal(winnerDeltas.healingDone, 750);
    strict_1.default.equal(winnerDeltas.higherLevelWins, undefined, 'gap of 3 is under the 5-level bar');
    strict_1.default.equal(winnerDeltas.sameRankWins, 1, 'both Jonin band');
    strict_1.default.equal(loserDeltas.pvpLosses, 1);
    strict_1.default.equal(loserDeltas.shieldsApplied, 1, 'loser banks their support play');
    strict_1.default.equal(loserDeltas.damageBlocked, 120);
    strict_1.default.equal(loserDeltas.taijutsuDamage, 90);
});
(0, node_test_1.test)('comeback, upset, and ranked flags', () => {
    const session = {
        p1: fighter('Underdog', { hp: 100, maxHp: 1000, level: 50 }), // 10% HP left
        p2: fighter('Goliath', { level: 60 }),
        log: [],
        ranked: true,
    };
    const { winnerDeltas } = (0, _legacy_pvp_js_1.extractPvpLegacyDeltas)(session, 'Underdog', 'Goliath');
    strict_1.default.equal(winnerDeltas.comebackWins, 1, 'won under 15% HP');
    strict_1.default.equal(winnerDeltas.higherLevelWins, 1, 'beat someone 10 levels up');
    strict_1.default.equal(winnerDeltas.rankedWins, 1, 'session.ranked flows through');
});
