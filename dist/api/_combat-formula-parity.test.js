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
const CLIENT_APP = (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, 'shinobij.client', 'src', 'App.tsx'), 'utf8');
function num(src, name) {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*([0-9.]+)`));
    node_assert_1.strict.ok(m, `Could not find numeric const "${name}"`);
    return Number(m[1]);
}
// Extract the single-quoted names from a `new Set([...])` literal that follows
// the given const name. Used to compare the server/client stackable-status sets.
function stackableSet(src, constName) {
    const i = src.indexOf(constName);
    node_assert_1.strict.ok(i >= 0, `${constName} not found`);
    const open = src.indexOf('new Set([', i);
    node_assert_1.strict.ok(open >= 0, `${constName} is not a new Set([...])`);
    const close = src.indexOf('])', open);
    node_assert_1.strict.ok(close >= 0, `${constName} set literal not closed`);
    return [...src.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
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
    ['DRAIN_BASE_TICK', 'DRAIN_BASE_TICK_PVE'],
    ['DRAIN_PER_LEVEL', 'DRAIN_PER_LEVEL_PVE'],
    ['DRAIN_MAX_TICK', 'DRAIN_MAX_TICK_PVE'],
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
    // Regression guard for the 2026-06-05 audit finding: WOUND_CAP_BY_RANK_PVE was
    // DEFINED BUT NEVER READ, so the cap-value assertion above passed while the PvE
    // wound path applied no rank cap at all. Assert the cap is actually consumed so
    // it can't silently go dead again (which would re-open the PvE↔PvP divergence).
    (0, node_test_1.it)('PvE actually consumes the wound rank cap (not a dead constant)', () => {
        node_assert_1.strict.match(CLIENT, /export function woundCapForRankPVE/, 'woundCapForRankPVE helper missing from combat-math.ts');
        node_assert_1.strict.ok(CLIENT_APP.includes('woundCapForRankPVE('), 'App.tsx no longer calls woundCapForRankPVE — the PvE wound rank cap is dead again');
    });
    // #2 amp duration: PvP forces IDG/IDT/DDG/DDT to 4 rounds (STATUS_DURATIONS_OVERRIDE);
    // PvE centralizes the same value in AMP_STATUS_ROUNDS_PVE. Assert all four server
    // overrides equal the client constant AND that App.tsx actually consumes it (so the
    // amp duration can't silently drift back to the old per-site `rounds: 2`).
    (0, node_test_1.it)('amp status duration matches (IDG/IDT/DDG/DDT) and PvE consumes the constant', () => {
        const ampNames = ['Increase Damage Given', 'Increase Damage Taken', 'Decrease Damage Given', 'Decrease Damage Taken'];
        const clientAmp = num(CLIENT, 'AMP_STATUS_ROUNDS_PVE');
        for (const name of ampNames) {
            const m = SERVER.match(new RegExp(`'${name}':\\s*([0-9]+)`));
            node_assert_1.strict.ok(m, `server STATUS_DURATIONS_OVERRIDE missing "${name}"`);
            node_assert_1.strict.equal(Number(m[1]), clientAmp, `${name} duration (${m[1]}) != AMP_STATUS_ROUNDS_PVE (${clientAmp})`);
        }
        node_assert_1.strict.ok(CLIENT_APP.includes('AMP_STATUS_ROUNDS_PVE'), 'App.tsx no longer uses AMP_STATUS_ROUNDS_PVE — PvE amp durations drifted back to per-site literals');
    });
    // #3 Drain: PvE consumes drainTickPVE (mastery-scaled, HP+chakra only). The
    // DRAIN_* value parity is covered by the PAIRS loop above; this guards that the
    // PvE path actually uses the helper (not the old flat-250 literal) and no longer
    // drains stamina.
    (0, node_test_1.it)('PvE consumes the mastery-scaled drain helper and drops stamina drain', () => {
        node_assert_1.strict.match(CLIENT, /export function drainTickPVE/, 'drainTickPVE helper missing from combat-math.ts');
        node_assert_1.strict.ok(CLIENT_APP.includes('drainTickPVE('), 'App.tsx no longer calls drainTickPVE — PvE drain is not mastery-scaled');
        node_assert_1.strict.ok(!CLIENT_APP.includes('drainStamina'), 'App.tsx still references drainStamina — Drain should not touch stamina (match PvP)');
    });
    // #5 stacking: PvP's STACKABLE_STATUS set (non-listed statuses replace on
    // re-apply) must match the client's STACKABLE_STATUS_PVE, and App.tsx must
    // route status application through mergeCombatStatus (else non-stackable
    // statuses — Stun/Seals/Prevents/DoTs — pile up again).
    (0, node_test_1.it)('STACKABLE_STATUS set matches and PvE routes through mergeCombatStatus', () => {
        node_assert_1.strict.deepEqual(stackableSet(SERVER, 'STACKABLE_STATUS'), stackableSet(CLIENT, 'STACKABLE_STATUS_PVE'), 'stackable-status set diverged between server and client');
        node_assert_1.strict.ok(CLIENT_APP.includes('mergeCombatStatus('), 'App.tsx no longer routes status application through mergeCombatStatus — non-stackable statuses can stack again');
    });
});
