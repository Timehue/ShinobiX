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
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

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
function numFrom(src: string, pattern: RegExp, label: string): number {
    const m = src.match(pattern);
    assert.ok(m, `${label} not found`);
    return Number(String(m![1]).replace(/_/g, ''));
}

function numArray(src: string, name: string): number[] {
    const m = src.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]'));
    assert.ok(m, `array ${name} not found`);
    const nums = m![1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    assert.ok(nums.length > 0, `array ${name} parsed empty`);
    return nums;
}

function singleNum(src: string, name: string): number {
    // \b end so DOCTRINE_HOSPITAL_DISCOUNT doesn't match DOCTRINE_HOSPITAL_DISCOUNT_PCT.
    const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    assert.ok(m, `constant ${name} not found`);
    return Number(m![1]);
}

// Like singleNum but tolerates a TS type annotation (e.g. `NAME: number = 1`).
function annotatedNum(src: string, name: string): number {
    const m = src.match(new RegExp(name + '(?::\\s*\\w+)?\\s*=\\s*(\\d+)'));
    assert.ok(m, `constant ${name} not found`);
    return Number(m![1]);
}

describe('parity: Healer rank perk arrays (_progress.ts ⇄ professionLogic.ts)', () => {
    for (const name of ['HEALER_PER_TARGET_COOLDOWN_SEC', 'HEALER_HEAL_XP_BONUS_PCT']) {
        it(`${name} matches (compared by name, order-independent)`, () => {
            assert.deepEqual(numArray(PROGRESS, name), numArray(PROFESSION, name), `${name} drifted — sync both files`);
        });
    }
});

describe('parity: pet evolution stat deltas (_evolution.ts ⇄ pet-evolutions.ts)', () => {
    // Evolution no longer clamps to per-tier caps (HP/ATK/DEF/SPD are uncapped now —
    // training builds them up to the level-100 ceiling), so the mirrored data is the
    // additive tier-gap deltas. Keep the server + client copies identical.
    const PETEVO = read('shinobij.client', 'src', 'data', 'pet-evolutions.ts');
    function objNums(src: string, name: string): Record<string, number> {
        const m = src.match(new RegExp(name + '[^{]*\\{([^}]*)\\}'));
        assert.ok(m, `object ${name} not found`);
        const out: Record<string, number> = {};
        for (const f of m![1].matchAll(/(\w+):\s*(-?\d+)/g)) out[f[1]] = Number(f[2]);
        return out;
    }
    for (const name of ['RARE_DELTA', 'LEGENDARY_DELTA']) {
        it(`${name} matches`, () => {
            const server = objNums(EVOLUTION, name);
            const client = objNums(PETEVO, name);
            for (const stat of ['hp', 'attack', 'defense', 'speed', 'moveRange']) {
                assert.ok(server[stat] !== undefined, `server ${name}.${stat} not parsed`);
                assert.equal(server[stat], client[stat], `${name}.${stat} drifted — sync both evolution files`);
            }
        });
    }
});

describe('parity: pet expedition durations (EXP_DURATION_MINUTES ⇄ petExpeditionOptions.durationMs)', () => {
    it('scout/forage/ruins durations match', () => {
        const block = EXPEDITION.match(/EXP_DURATION_MINUTES[^{]*\{([^}]*)\}/);
        assert.ok(block, 'EXP_DURATION_MINUTES not found');
        const serverMin: Record<string, number> = {};
        for (const m of block![1].matchAll(/(\w+):\s*(\d+)/g)) serverMin[m[1]] = Number(m[2]);
        assert.ok(Object.keys(serverMin).length >= 3, 'expected >= 3 expedition types');
        let checked = 0;
        for (const m of PETCONFIG.matchAll(/type:\s*"(\w+)"[^}]*?durationMs:\s*([0-9*\s]+?)\s*,/g)) {
            const type = m[1];
            if (serverMin[type] === undefined) continue;
            const expr = m[2].trim();
            assert.match(expr, /^[\d*\s]+$/, `durationMs expr for ${type} is not pure digit*digit`);
            const ms = expr.split('*').map(x => Number(x.trim())).reduce((a, b) => a * b, 1);
            assert.equal(ms / 60000, serverMin[type], `${type} duration drifted (server ${serverMin[type]}m vs client ${ms / 60000}m)`);
            checked += 1;
        }
        assert.equal(checked, Object.keys(serverMin).length, 'did not match every server expedition type to a client option');
    });
});

describe('parity: medics doctrine hospital discount (heal.ts ⇄ clan-doctrines.ts)', () => {
    it('server DOCTRINE_HOSPITAL_DISCOUNT_PCT matches client DOCTRINE_HOSPITAL_DISCOUNT', () => {
        assert.equal(
            singleNum(HEAL, 'DOCTRINE_HOSPITAL_DISCOUNT_PCT'),
            singleNum(DOCTRINES, 'DOCTRINE_HOSPITAL_DISCOUNT'),
            'medics hospital discount drifted between heal.ts and clan-doctrines.ts',
        );
    });
});

// Guards the BALANCE-CRITICAL XP/level/stat-budget invariant across the two build
// roots. _xp-engine.test.ts already compares the server port against a hand-copied
// replica; this closes the THIRD side — the real client modules (constants/game.ts
// + lib/stats.ts) — so a client-only drift (re-adding the testing boost, changing
// the curve coefficient, or diverging the budget formula) fails npm test.
describe('parity: XP engine constants + formulas (game.ts + stats.ts ⇄ api/_xp-engine.ts)', () => {
    it('CHARACTER_XP_GAIN_MULTIPLIER matches and stays the real ×1 (testing boost off)', () => {
        const client = annotatedNum(GAME, 'CHARACTER_XP_GAIN_MULTIPLIER');
        const server = annotatedNum(XPENGINE, 'CHARACTER_XP_GAIN_MULTIPLIER');
        assert.equal(client, server, 'XP multiplier drifted between game.ts and _xp-engine.ts');
        assert.equal(client, 1, 'XP multiplier is not 1 — the testing boost must stay off in production');
    });
    for (const name of ['MAX_LEVEL', 'MAX_STAT', 'STARTING_STAT_POINTS']) {
        it(`${name} matches across build roots`, () => {
            assert.equal(singleNum(GAME, name), singleNum(XPENGINE, name), `${name} drifted between game.ts and _xp-engine.ts`);
        });
    }
    it('xpNeeded uses the same 3·L² curve on both sides', () => {
        const curve = 'Math.round(3 * level * level)';
        assert.ok(STATS.includes(curve), 'client lib/stats.ts lost the 3·L² xpNeeded curve');
        assert.ok(XPENGINE.includes(curve), 'server api/_xp-engine.ts lost the 3·L² xpNeeded curve');
    });
    it('statBudgetAtLevel uses the same linear formula on both sides', () => {
        const formula = 'STARTING_STAT_POINTS + Math.round(((clampedLevel - 1) / (MAX_LEVEL - 1)) * STAT_POINTS_FROM_XP_TO_CAP)';
        assert.ok(STATS.includes(formula), 'client lib/stats.ts statBudgetAtLevel formula drifted');
        assert.ok(XPENGINE.includes(formula), 'server api/_xp-engine.ts statBudgetAtLevel formula drifted');
    });
});

describe('parity: bank interest rate + cap (village-upgrades.ts + Bank.tsx ⇄ api/_bank-interest.ts)', () => {
    it('the per-level bank interest rate matches across build roots', () => {
        const client = numFrom(VILLAGE_UP, /key:\s*"bank"[^}]*?perLevel:\s*([\d.]+)/, 'client bank perLevel');
        const server = numFrom(BANK_INT, /BANK_UPGRADE_PER_LEVEL\s*=\s*([\d.]+)/, 'server BANK_UPGRADE_PER_LEVEL');
        assert.equal(client, server, 'bank interest rate drifted between village-upgrades.ts and _bank-interest.ts');
    });
    it('the interest-earning principal cap matches across build roots', () => {
        const client = numFrom(BANK_SCREEN, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'client BANK_INTEREST_PRINCIPAL_CAP');
        const server = numFrom(BANK_INT, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'server BANK_INTEREST_PRINCIPAL_CAP');
        assert.equal(client, server, 'bank principal cap drifted between Bank.tsx and _bank-interest.ts');
    });
});
