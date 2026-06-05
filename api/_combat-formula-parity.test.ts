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
// STUN_AP_PENALTY lives in the client constants module, not combat-math —
// pinned here so the server endTurn AP penalty can't drift from the client's.
const CLIENT_GAME_CONSTS = readFileSync(join(ROOT, 'shinobij.client', 'src', 'constants', 'game.ts'), 'utf8');

function num(src: string, name: string): number {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*([0-9.]+)`));
    assert.ok(m, `Could not find numeric const "${name}"`);
    return Number(m[1]);
}

// Extract the single-quoted names from a `new Set([...])` literal that follows
// the given const name. Used to compare the server/client stackable-status sets.
function stackableSet(src: string, constName: string): string[] {
    const i = src.indexOf(constName);
    assert.ok(i >= 0, `${constName} not found`);
    const open = src.indexOf('new Set([', i);
    assert.ok(open >= 0, `${constName} is not a new Set([...])`);
    const close = src.indexOf('])', open);
    assert.ok(close >= 0, `${constName} set literal not closed`);
    return [...src.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
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
    ['DRAIN_BASE_TICK', 'DRAIN_BASE_TICK_PVE'],
    ['DRAIN_PER_LEVEL', 'DRAIN_PER_LEVEL_PVE'],
    ['DRAIN_MAX_TICK', 'DRAIN_MAX_TICK_PVE'],
    // #2 DoT DR mitigation: server applyDoTs scales every Wound/Poison/Drain
    // tick by (1 - effDR × DR_DOT_SCALE); PvE used to skip this entirely.
    // Now centralized in dotMitigationPVE, which #4 below proves App.tsx calls.
    ['DR_DOT_SCALE', 'DR_DOT_SCALE_PVE'],
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
    // Stun AP penalty: server move.ts uses `100 - STUN_AP_PENALTY` for the
    // stunned fighter's starting AP; client App.tsx uses `STUN_AP_PENALTY`
    // from constants/game.ts. Drift here means a stunned player on one side
    // takes a different AP hit than on the other — pin to keep the numbers
    // identical.
    it('STUN_AP_PENALTY (server) === STUN_AP_PENALTY (client constants/game.ts)', () => {
        assert.equal(
            num(SERVER, 'STUN_AP_PENALTY'),
            num(CLIENT_GAME_CONSTS, 'STUN_AP_PENALTY'),
            'STUN_AP_PENALTY diverged between server move.ts and client constants/game.ts',
        );
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
    // #3 Drain: PvE consumes drainTickPVE (mastery-scaled, HP+chakra only). The
    // DRAIN_* value parity is covered by the PAIRS loop above; this guards that the
    // PvE path actually uses the helper (not the old flat-250 literal) and no longer
    // drains stamina.
    it('PvE consumes the mastery-scaled drain helper and drops stamina drain', () => {
        assert.match(CLIENT, /export function drainTickPVE/, 'drainTickPVE helper missing from combat-math.ts');
        assert.ok(CLIENT_APP.includes('drainTickPVE('), 'App.tsx no longer calls drainTickPVE — PvE drain is not mastery-scaled');
        assert.ok(!CLIENT_APP.includes('drainStamina'), 'App.tsx still references drainStamina — Drain should not touch stamina (match PvP)');
    });
    // DoT DR mitigation: the DR_DOT_SCALE value parity is covered in PAIRS
    // above; this guards that PvE actually CONSUMES the dotMitigationPVE
    // helper (App.tsx applies it where it ticks Wound/Poison/Drain). Without
    // the helper, PvE applied DoTs raw and a heavy-armor build tanked DoTs
    // harder in PvP than in PvE — the same balance gap the wound-cap and amp
    // duration regression guards catch.
    it('PvE consumes the DoT DR-mitigation helper (not raw ticks)', () => {
        assert.match(CLIENT, /export function dotMitigationPVE/, 'dotMitigationPVE helper missing from combat-math.ts');
        assert.ok(
            CLIENT_APP.includes('dotMitigationPVE('),
            'App.tsx no longer calls dotMitigationPVE — PvE DoTs would tick unmitigated again, breaking PvE↔PvP parity',
        );
    });
    // #5 stacking: PvP's STACKABLE_STATUS set (non-listed statuses replace on
    // re-apply) must match the client's STACKABLE_STATUS_PVE, and App.tsx must
    // route status application through mergeCombatStatus (else non-stackable
    // statuses — Stun/Seals/Prevents/DoTs — pile up again).
    it('STACKABLE_STATUS set matches and PvE routes through mergeCombatStatus', () => {
        assert.deepEqual(
            stackableSet(SERVER, 'STACKABLE_STATUS'),
            stackableSet(CLIENT, 'STACKABLE_STATUS_PVE'),
            'stackable-status set diverged between server and client',
        );
        assert.ok(
            CLIENT_APP.includes('mergeCombatStatus('),
            'App.tsx no longer routes status application through mergeCombatStatus — non-stackable statuses can stack again',
        );
    });
});
