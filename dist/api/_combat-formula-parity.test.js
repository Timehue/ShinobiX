"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const ROOT = process.cwd();
const SERVER = (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, 'api', 'pvp', 'move.ts'), 'utf8');
const CLIENT = (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, 'shinobij.client', 'src', 'lib', 'combat-math.ts'), 'utf8');
function num(src, name) {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*([0-9.]+)`));
    node_assert_1.strict.ok(m, `Could not find numeric const "${name}"`);
    return Number(m[1]);
}
function woundCaps(src) {
    const i = src.indexOf('WOUND_CAP_BY_RANK');
    node_assert_1.strict.ok(i >= 0, 'WOUND_CAP_BY_RANK not found');
    const block = src.slice(i, i + 200);
    const out = {};
    for (const k of ['basic', 'AB', 'S']) {
        const m = block.match(new RegExp(`${k}:\\s*([0-9]+)`));
        node_assert_1.strict.ok(m, `wound cap "${k}" not found`);
        out[k] = Number(m[1]);
    }
    return out;
}
// server const name ⇄ client const name (client suffixes with _PVE).
const PAIRS = [
    ['EP_MULTIPLIER', 'EP_MULTIPLIER_PVE'],
    ['K_DR', 'K_DR_PVE'],
    ['K_AMP', 'K_AMP_PVE'],
    ['HEAL_FLAT', 'HEAL_FLAT_PVE'],
    ['SHIELD_FLAT', 'SHIELD_FLAT_PVE'],
    ['WOUND_HARD_CAP_PCT', 'WOUND_HARD_CAP_PCT_PVE'],
];
(0, node_test_1.describe)('combat formula parity (move.ts ⇄ combat-math.ts)', () => {
    for (const [s, c] of PAIRS) {
        (0, node_test_1.it)(`${s} (server) === ${c} (client)`, () => {
            node_assert_1.strict.equal(num(SERVER, s), num(CLIENT, c), `${s} and ${c} diverged — PvE and PvP damage would no longer match`);
        });
    }
    (0, node_test_1.it)('WOUND_CAP_BY_RANK matches (basic / AB / S)', () => {
        node_assert_1.strict.deepEqual(woundCaps(SERVER), woundCaps(CLIENT), 'wound rank caps diverged between server and client');
    });
});
