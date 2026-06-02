/**
 * Combat-formula parity guard (server ⇄ client).
 *
 * The damage formula lives in TWO files because api/ (cPanel tsc) and
 * shinobij.client/ (Vite) are separate build roots with no shared module:
 *   • api/pvp/move.ts                      — authoritative PvP resolution
 *   • shinobij.client/src/lib/combat-math  — the client mirror (PvE + previews)
 *
 * They are hand-synced, and the whole point is that PvE and PvP produce
 * IDENTICAL damage for the same inputs. This test fails `npm test` if one
 * copy's tuning constant is changed without the other — closing the drift gap
 * that a true shared module would (without the cross-build-boundary risk).
 *
 * Static text analysis only: reads source, imports nothing, opens no DB —
 * so it can never destabilise a live endpoint (mirrors server-routes.test.ts).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(join(HERE, 'pvp', 'move.ts'), 'utf8');
const CLIENT = readFileSync(join(HERE, '..', 'shinobij.client', 'src', 'lib', 'combat-math.ts'), 'utf8');

function num(src: string, name: string): number {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*([0-9.]+)`));
    assert.ok(m, `Could not find numeric const "${name}"`);
    return Number(m[1]);
}

function woundCaps(src: string): Record<string, number> {
    const i = src.indexOf('WOUND_CAP_BY_RANK');
    assert.ok(i >= 0, 'WOUND_CAP_BY_RANK not found');
    const block = src.slice(i, i + 200);
    const out: Record<string, number> = {};
    for (const k of ['basic', 'AB', 'S']) {
        const m = block.match(new RegExp(`${k}:\\s*([0-9]+)`));
        assert.ok(m, `wound cap "${k}" not found`);
        out[k] = Number(m[1]);
    }
    return out;
}

// server const name ⇄ client const name (client suffixes with _PVE).
const PAIRS: Array<[string, string]> = [
    ['EP_MULTIPLIER', 'EP_MULTIPLIER_PVE'],
    ['K_DR', 'K_DR_PVE'],
    ['K_AMP', 'K_AMP_PVE'],
    ['HEAL_FLAT', 'HEAL_FLAT_PVE'],
    ['SHIELD_FLAT', 'SHIELD_FLAT_PVE'],
    ['WOUND_HARD_CAP_PCT', 'WOUND_HARD_CAP_PCT_PVE'],
];

describe('combat formula parity (move.ts ⇄ combat-math.ts)', () => {
    for (const [s, c] of PAIRS) {
        it(`${s} (server) === ${c} (client)`, () => {
            assert.equal(num(SERVER, s), num(CLIENT, c), `${s} and ${c} diverged — PvE and PvP damage would no longer match`);
        });
    }
    it('WOUND_CAP_BY_RANK matches (basic / AB / S)', () => {
        assert.deepEqual(woundCaps(SERVER), woundCaps(CLIENT), 'wound rank caps diverged between server and client');
    });
});
