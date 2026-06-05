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
 * Paths are resolved from process.cwd() (npm test runs from the repo root) so
 * this file contains no import.meta — it is also compiled by the cPanel build,
 * whose Node16 CJS-interop output rejects import.meta.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SERVER = readFileSync(join(ROOT, 'api', 'pvp', 'move.ts'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'shinobij.client', 'src', 'lib', 'combat-math.ts'), 'utf8');
const CLIENT_APP = readFileSync(join(ROOT, 'shinobij.client', 'src', 'App.tsx'), 'utf8');

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
    // Regression guard for the 2026-06-05 audit finding: WOUND_CAP_BY_RANK_PVE was
    // DEFINED BUT NEVER READ, so the cap-value assertion above passed while the PvE
    // wound path applied no rank cap at all. Assert the cap is actually consumed so
    // it can't silently go dead again (which would re-open the PvE↔PvP divergence).
    it('PvE actually consumes the wound rank cap (not a dead constant)', () => {
        assert.match(CLIENT, /export function woundCapForRankPVE/, 'woundCapForRankPVE helper missing from combat-math.ts');
        assert.ok(
            CLIENT_APP.includes('woundCapForRankPVE('),
            'App.tsx no longer calls woundCapForRankPVE — the PvE wound rank cap is dead again',
        );
    });
    // #2 amp duration: PvP forces IDG/IDT/DDG/DDT to 4 rounds (STATUS_DURATIONS_OVERRIDE);
    // PvE centralizes the same value in AMP_STATUS_ROUNDS_PVE. Assert all four server
    // overrides equal the client constant AND that App.tsx actually consumes it (so the
    // amp duration can't silently drift back to the old per-site `rounds: 2`).
    it('amp status duration matches (IDG/IDT/DDG/DDT) and PvE consumes the constant', () => {
        const ampNames = ['Increase Damage Given', 'Increase Damage Taken', 'Decrease Damage Given', 'Decrease Damage Taken'];
        const clientAmp = num(CLIENT, 'AMP_STATUS_ROUNDS_PVE');
        for (const name of ampNames) {
            const m = SERVER.match(new RegExp(`'${name}':\\s*([0-9]+)`));
            assert.ok(m, `server STATUS_DURATIONS_OVERRIDE missing "${name}"`);
            assert.equal(Number(m![1]), clientAmp, `${name} duration (${m![1]}) != AMP_STATUS_ROUNDS_PVE (${clientAmp})`);
        }
        assert.ok(
            CLIENT_APP.includes('AMP_STATUS_ROUNDS_PVE'),
            'App.tsx no longer uses AMP_STATUS_ROUNDS_PVE — PvE amp durations drifted back to per-site literals',
        );
    });
});
