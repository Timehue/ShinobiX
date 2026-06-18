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
const PETSTATS = read('shinobij.client', 'src', 'data', 'pet-stats.ts');
const PETCONFIG = read('shinobij.client', 'src', 'data', 'pet-config.ts');

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

describe('parity: Healer rank perk arrays (_progress.ts ⇄ professionLogic.ts)', () => {
    for (const name of ['HEALER_PER_TARGET_COOLDOWN_SEC', 'HEALER_HEAL_XP_BONUS_PCT', 'HEALER_HOSPITAL_TIMER_SEC']) {
        it(`${name} matches (compared by name, order-independent)`, () => {
            assert.deepEqual(numArray(PROGRESS, name), numArray(PROFESSION, name), `${name} drifted — sync both files`);
        });
    }
});

describe('parity: pet evolution rarity caps (RARITY_CAPS ⇄ petStatCaps)', () => {
    // Scope the tier search to AFTER the table declaration — pet-stats.ts has an
    // unrelated earlier `rare: {` table that would otherwise match first.
    function tierCaps(src: string, tableName: string, tier: string): Record<string, number> {
        const tableIdx = src.indexOf(tableName);
        assert.ok(tableIdx >= 0, `table ${tableName} not found`);
        const m = src.slice(tableIdx).match(new RegExp(tier + ':\\s*\\{([^}]*)\\}'));
        assert.ok(m, `tier ${tier} not found in ${tableName}`);
        const out: Record<string, number> = {};
        for (const f of m![1].matchAll(/(\w+):\s*(\d+)/g)) out[f[1]] = Number(f[2]);
        return out;
    }
    for (const tier of ['rare', 'legendary']) {
        it(`${tier} hp/attack/defense/speed match`, () => {
            const server = tierCaps(EVOLUTION, 'RARITY_CAPS', tier);
            const client = tierCaps(PETSTATS, 'petStatCaps', tier);
            for (const stat of ['hp', 'attack', 'defense', 'speed']) {
                assert.ok(server[stat] !== undefined, `server ${tier}.${stat} not parsed`);
                assert.equal(server[stat], client[stat], `${tier}.${stat} drifted`);
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
