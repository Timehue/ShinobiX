"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Cross-build-root value parity guards (server ⇄ client).
 *
 * api/ (cPanel tsc) and shinobij.client/ (Vite) are separate build roots with no
 * shared module, so several gameplay constants are hand-duplicated and kept in
 * sync only by "keep in sync" comments. This test fails `npm test` if any drifts
 * — closing the gap a shared module would, without the cross-build risk.
 * Companion to api/_combat-formula-parity.test.ts and api/save/_save-clamp-parity.test.ts.
 *
 * Static text analysis only — reads source, imports nothing, opens no DB. Paths
 * resolve from process.cwd() (npm test runs from the repo root), so no import.meta
 * (the cPanel CJS build rejects it).
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const ROOT = process.cwd();
const read = (...p) => (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, ...p), 'utf8');
const HEAL = read('api', 'player', 'heal.ts');
const PROGRESS = read('api', 'missions', '_progress.ts');
const EVOLUTION = read('api', 'pet', '_evolution.ts');
const EXPEDITION = read('api', 'missions', 'expedition-start.ts');
const DOCTRINES = read('shinobij.client', 'src', 'lib', 'clan-doctrines.ts');
const PROFESSION = read('shinobij.client', 'src', 'professionLogic.ts');
const PETCONFIG = read('shinobij.client', 'src', 'data', 'pet-config.ts');
const GAME = read('shinobij.client', 'src', 'constants', 'game.ts');
const STATS = read('shinobij.client', 'src', 'lib', 'stats.ts');
const XPENGINE = read('api', '_xp-engine.ts');
const VILLAGE_UP = read('shinobij.client', 'src', 'lib', 'village-upgrades.ts');
const BANK_INT = read('api', '_bank-interest.ts');
const BANK_SCREEN = read('shinobij.client', 'src', 'screens', 'Bank.tsx');
// Extract a (possibly underscore-grouped) number captured by `pattern`.
function numFrom(src, pattern, label) {
    const m = src.match(pattern);
    node_assert_1.strict.ok(m, `${label} not found`);
    return Number(String(m[1]).replace(/_/g, ''));
}
function numArray(src, name) {
    const m = src.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]'));
    node_assert_1.strict.ok(m, `array ${name} not found`);
    const nums = m[1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    node_assert_1.strict.ok(nums.length > 0, `array ${name} parsed empty`);
    return nums;
}
function singleNum(src, name) {
    // \b end so DOCTRINE_HOSPITAL_DISCOUNT doesn't match DOCTRINE_HOSPITAL_DISCOUNT_PCT.
    const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    node_assert_1.strict.ok(m, `constant ${name} not found`);
    return Number(m[1]);
}
// Like singleNum but tolerates a TS type annotation (e.g. `NAME: number = 1`).
function annotatedNum(src, name) {
    const m = src.match(new RegExp(name + '(?::\\s*\\w+)?\\s*=\\s*(\\d+)'));
    node_assert_1.strict.ok(m, `constant ${name} not found`);
    return Number(m[1]);
}
(0, node_test_1.describe)('parity: Healer rank perk arrays (_progress.ts ⇄ professionLogic.ts)', () => {
    for (const name of ['HEALER_PER_TARGET_COOLDOWN_SEC', 'HEALER_HEAL_XP_BONUS_PCT']) {
        (0, node_test_1.it)(`${name} matches (compared by name, order-independent)`, () => {
            node_assert_1.strict.deepEqual(numArray(PROGRESS, name), numArray(PROFESSION, name), `${name} drifted — sync both files`);
        });
    }
});
(0, node_test_1.describe)('parity: pet evolution stat deltas (_evolution.ts ⇄ pet-evolutions.ts)', () => {
    // Evolution no longer clamps to per-tier caps (HP/ATK/DEF/SPD are uncapped now —
    // training builds them up to the level-100 ceiling), so the mirrored data is the
    // additive tier-gap deltas. Keep the server + client copies identical.
    const PETEVO = read('shinobij.client', 'src', 'data', 'pet-evolutions.ts');
    function objNums(src, name) {
        const m = src.match(new RegExp(name + '[^{]*\\{([^}]*)\\}'));
        node_assert_1.strict.ok(m, `object ${name} not found`);
        const out = {};
        for (const f of m[1].matchAll(/(\w+):\s*(-?\d+)/g))
            out[f[1]] = Number(f[2]);
        return out;
    }
    for (const name of ['RARE_DELTA', 'LEGENDARY_DELTA']) {
        (0, node_test_1.it)(`${name} matches`, () => {
            const server = objNums(EVOLUTION, name);
            const client = objNums(PETEVO, name);
            for (const stat of ['hp', 'attack', 'defense', 'speed', 'moveRange']) {
                node_assert_1.strict.ok(server[stat] !== undefined, `server ${name}.${stat} not parsed`);
                node_assert_1.strict.equal(server[stat], client[stat], `${name}.${stat} drifted — sync both evolution files`);
            }
        });
    }
});
(0, node_test_1.describe)('parity: pet expedition durations (EXP_DURATION_MINUTES ⇄ petExpeditionOptions.durationMs)', () => {
    (0, node_test_1.it)('scout/forage/ruins durations match', () => {
        const block = EXPEDITION.match(/EXP_DURATION_MINUTES[^{]*\{([^}]*)\}/);
        node_assert_1.strict.ok(block, 'EXP_DURATION_MINUTES not found');
        const serverMin = {};
        for (const m of block[1].matchAll(/(\w+):\s*(\d+)/g))
            serverMin[m[1]] = Number(m[2]);
        node_assert_1.strict.ok(Object.keys(serverMin).length >= 3, 'expected >= 3 expedition types');
        let checked = 0;
        for (const m of PETCONFIG.matchAll(/type:\s*"(\w+)"[^}]*?durationMs:\s*([0-9*\s]+?)\s*,/g)) {
            const type = m[1];
            if (serverMin[type] === undefined)
                continue;
            const expr = m[2].trim();
            node_assert_1.strict.match(expr, /^[\d*\s]+$/, `durationMs expr for ${type} is not pure digit*digit`);
            const ms = expr.split('*').map(x => Number(x.trim())).reduce((a, b) => a * b, 1);
            node_assert_1.strict.equal(ms / 60000, serverMin[type], `${type} duration drifted (server ${serverMin[type]}m vs client ${ms / 60000}m)`);
            checked += 1;
        }
        node_assert_1.strict.equal(checked, Object.keys(serverMin).length, 'did not match every server expedition type to a client option');
    });
});
(0, node_test_1.describe)('parity: medics doctrine hospital discount (heal.ts ⇄ clan-doctrines.ts)', () => {
    (0, node_test_1.it)('server DOCTRINE_HOSPITAL_DISCOUNT_PCT matches client DOCTRINE_HOSPITAL_DISCOUNT', () => {
        node_assert_1.strict.equal(singleNum(HEAL, 'DOCTRINE_HOSPITAL_DISCOUNT_PCT'), singleNum(DOCTRINES, 'DOCTRINE_HOSPITAL_DISCOUNT'), 'medics hospital discount drifted between heal.ts and clan-doctrines.ts');
    });
});
// Guards the BALANCE-CRITICAL XP/level/stat-budget invariant across the two build
// roots. _xp-engine.test.ts already compares the server port against a hand-copied
// replica; this closes the THIRD side — the real client modules (constants/game.ts
// + lib/stats.ts) — so a client-only drift (re-adding the testing boost, changing
// the curve coefficient, or diverging the budget formula) fails npm test.
(0, node_test_1.describe)('parity: XP engine constants + formulas (game.ts + stats.ts ⇄ api/_xp-engine.ts)', () => {
    (0, node_test_1.it)('CHARACTER_XP_GAIN_MULTIPLIER matches and stays the real ×1 (testing boost off)', () => {
        const client = annotatedNum(GAME, 'CHARACTER_XP_GAIN_MULTIPLIER');
        const server = annotatedNum(XPENGINE, 'CHARACTER_XP_GAIN_MULTIPLIER');
        node_assert_1.strict.equal(client, server, 'XP multiplier drifted between game.ts and _xp-engine.ts');
        node_assert_1.strict.equal(client, 1, 'XP multiplier is not 1 — the testing boost must stay off in production');
    });
    for (const name of ['MAX_LEVEL', 'MAX_STAT', 'STARTING_STAT_POINTS']) {
        (0, node_test_1.it)(`${name} matches across build roots`, () => {
            node_assert_1.strict.equal(singleNum(GAME, name), singleNum(XPENGINE, name), `${name} drifted between game.ts and _xp-engine.ts`);
        });
    }
    (0, node_test_1.it)('xpNeeded uses the same 3·L² curve on both sides', () => {
        const curve = 'Math.round(3 * level * level)';
        node_assert_1.strict.ok(STATS.includes(curve), 'client lib/stats.ts lost the 3·L² xpNeeded curve');
        node_assert_1.strict.ok(XPENGINE.includes(curve), 'server api/_xp-engine.ts lost the 3·L² xpNeeded curve');
    });
    (0, node_test_1.it)('statBudgetAtLevel uses the same linear formula on both sides', () => {
        const formula = 'STARTING_STAT_POINTS + Math.round(((clampedLevel - 1) / (MAX_LEVEL - 1)) * STAT_POINTS_FROM_XP_TO_CAP)';
        node_assert_1.strict.ok(STATS.includes(formula), 'client lib/stats.ts statBudgetAtLevel formula drifted');
        node_assert_1.strict.ok(XPENGINE.includes(formula), 'server api/_xp-engine.ts statBudgetAtLevel formula drifted');
    });
});
(0, node_test_1.describe)('parity: bank interest rate + cap (village-upgrades.ts + Bank.tsx ⇄ api/_bank-interest.ts)', () => {
    (0, node_test_1.it)('the per-level bank interest rate matches across build roots', () => {
        const client = numFrom(VILLAGE_UP, /key:\s*"bank"[^}]*?perLevel:\s*([\d.]+)/, 'client bank perLevel');
        const server = numFrom(BANK_INT, /BANK_UPGRADE_PER_LEVEL\s*=\s*([\d.]+)/, 'server BANK_UPGRADE_PER_LEVEL');
        node_assert_1.strict.equal(client, server, 'bank interest rate drifted between village-upgrades.ts and _bank-interest.ts');
    });
    (0, node_test_1.it)('the interest-earning principal cap matches across build roots', () => {
        const client = numFrom(BANK_SCREEN, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'client BANK_INTEREST_PRINCIPAL_CAP');
        const server = numFrom(BANK_INT, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'server BANK_INTEREST_PRINCIPAL_CAP');
        node_assert_1.strict.equal(client, server, 'bank principal cap drifted between Bank.tsx and _bank-interest.ts');
    });
});
