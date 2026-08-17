/**
 * Combat-formula parity guard (server ⇄ client).
 *
 * Live PvP and Solo PvE both execute api/pvp/move.ts and the shared
 * api/combat-core formulas. The Vite build keeps a hand-synced
 * shinobij.client/src/lib/combat-math mirror for previews and display math.
 *
 * This test fails `npm test` if preview tuning drifts from the authoritative
 * formulas, or if Solo PvE stops delegating to the shared server resolver.
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
const SERVER_FORMULAS = readFileSync(join(ROOT, 'api', 'combat-core', 'formulas.ts'), 'utf8');
// The canonical tag registries (STACKABLE_STATUS etc.) were centralized into
// api/pvp/_tags.ts; move.ts imports them. Read the set literals from there.
const SERVER_TAGS = readFileSync(join(ROOT, 'api', 'pvp', '_tags.ts'), 'utf8');
const CLIENT = readFileSync(join(ROOT, 'shinobij.client', 'src', 'lib', 'combat-math.ts'), 'utf8');
// PvE used to run a SECOND, hand-mirrored engine in the browser
// (screens/Arena.tsx). That reducer is deleted: solo PvE is now server-side and
// IMPORTS its resolvers straight from the PvP engine, so the constants below are
// not mirrored into PvE — they are the same code executing. The old
// "does the PvE engine still consume this?" guards therefore became
// "is PvE still wired to the PvP engine's implementation?", which is what these
// sources are read for. api/combat-core/pvp-solo-jutsu-parity.test.ts backs
// this behaviourally by running BOTH real engines over the whole jutsu catalog.
//
// That wiring question is asked by `assertSoloUsesSharedMove` further down,
// which is kept in preference to a plain import-list check because it also
// proves the resolver is CALLED — an import PvE stopped using would satisfy the
// weaker form while PvE quietly ran something else.
const SOLO_ENGINE = readFileSync(join(ROOT, 'api', 'solo-pve', '_engine.ts'), 'utf8');
const SOLO_ENCOUNTER = readFileSync(join(ROOT, 'api', 'solo-pve', '_ai-encounter.ts'), 'utf8');
const SERVER_SESSION = readFileSync(join(ROOT, 'api', 'pvp', 'session.ts'), 'utf8');
// STUN_AP_PENALTY lives in the client constants module, not combat-math —
// pinned here so the server endTurn AP penalty can't drift from the client's.
const CLIENT_GAME_CONSTS = readFileSync(join(ROOT, 'shinobij.client', 'src', 'constants', 'game.ts'), 'utf8');
// EP-at-level scaling for display lives in the jutsu-scaling module; pinned here
// so the EP a player SEES can't drift from the EP combat actually deals.
const CLIENT_SCALING = readFileSync(join(ROOT, 'shinobij.client', 'src', 'lib', 'jutsu-scaling.ts'), 'utf8');
// The tower AI planning sim carries its own frozen statFactor copy
// (COMBAT_FORMULA_DUPLICATION_EXCEPTION) — pinned below so AI planning can't
// silently diverge from real damage after a retune.
const SERVER_SIM = readFileSync(join(ROOT, 'api', 'towers', '_sim.ts'), 'utf8');
// The bloodline offense multiplier table (1.08 starter / 1.10 B / 1.15 A /
// 1.20 S) is hand-duplicated between the server derivation and the client.
const SERVER_MULT = readFileSync(join(ROOT, 'api', 'pvp', '_multipliers.ts'), 'utf8');

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

function assertSoloUsesSharedMove(name: 'applyJutsu' | 'applyDoTs' | 'tickStatuses'): void {
    const marker = "} from '../pvp/move.js';";
    const importEnd = SOLO_ENGINE.indexOf(marker);
    assert.ok(importEnd >= 0, 'Solo PvE no longer imports the shared PvP move resolver');
    const importStart = SOLO_ENGINE.lastIndexOf('import {', importEnd);
    assert.ok(importStart >= 0, 'Solo PvE shared move import is malformed');
    const sharedMoveImport = SOLO_ENGINE.slice(importStart, importEnd + marker.length);
    assert.match(sharedMoveImport, new RegExp(`\\b${name}\\b`), `Solo PvE no longer imports ${name} from pvp/move.ts`);
    assert.match(SOLO_ENGINE, new RegExp(`\\b${name}\\(`), `Solo PvE no longer calls the shared ${name} resolver`);
}

// server const name ⇄ client const name (client suffixes with _PVE).
const PAIRS: Array<[string, string]> = [
    ['EP_MULTIPLIER', 'EP_MULTIPLIER_PVE'],
    ['K_DR', 'K_DR_PVE'],
    ['K_AMP', 'K_AMP_PVE'],
    // Increase Generals stack pool: raises str/spd/int/wil (feeds statFactor),
    // soft-capped so linear stacking can't drive statFactor to the [0.35,1.85]
    // clamp. PvE and PvP must pool identically or the same buff diverges.
    ['K_GENERALS', 'K_GENERALS_PVE'],
    // Increase Discipline (legacy signature jutsu): style-locked offense lift.
    // Pool AND ×2 scale must match or the same buff hits differently in PvE/PvP.
    ['K_DISCIPLINE', 'K_DISCIPLINE_PVE'],
    ['DISCIPLINE_BONUS_SCALE', 'DISCIPLINE_BONUS_SCALE_PVE'],
    ['HEAL_FLAT', 'HEAL_FLAT_PVE'],
    ['SHIELD_FLAT', 'SHIELD_FLAT_PVE'],
    ['WOUND_HARD_CAP_PCT', 'WOUND_HARD_CAP_PCT_PVE'],
    ['DRAIN_BASE_TICK', 'DRAIN_BASE_TICK_PVE'],
    ['DRAIN_PER_LEVEL', 'DRAIN_PER_LEVEL_PVE'],
    ['DRAIN_MAX_TICK', 'DRAIN_MAX_TICK_PVE'],
    // #2 DoT DR mitigation: server applyDoTs scales every Wound/Poison/Drain
    // tick by (1 - effDR × DR_DOT_SCALE); PvE used to skip this entirely.
    // The preview mirror is centralized in dotMitigationPVE; live Solo/PvP
    // consumption is pinned against the shared server resolver below.
    ['DR_DOT_SCALE', 'DR_DOT_SCALE_PVE'],
];

describe('combat formula parity (move.ts ⇄ combat-math.ts)', () => {
    for (const [s, c] of PAIRS) {
        it(`${s} (server) === ${c} (client)`, () => {
            assert.equal(num(SERVER_FORMULAS, s), num(CLIENT, c), `${s} and ${c} diverged — PvE and PvP damage would no longer match`);
        });
    }
    it('WOUND_CAP_BY_RANK matches (basic / AB / S)', () => {
        assert.deepEqual(woundCaps(SERVER_FORMULAS), woundCaps(CLIENT), 'wound rank caps diverged between server and client');
    });
    // Wound STACK cap (2026-07-01). Per-hit Wound magnitude is rank-capped above; this
    // bounds the concurrent STACK COUNT so repeated Wound casts can't compound bleed.
    // Live Solo and PvP share the resolver that applies this cap; the client
    // mirror remains pinned for previews.
    it('MAX_WOUND_STACKS preview mirror matches and the shared live resolver caps at apply', () => {
        assert.equal(num(SERVER_FORMULAS, 'MAX_WOUND_STACKS'), num(CLIENT, 'MAX_WOUND_STACKS_PVE'), 'Wound stack cap diverged between server and client');
        assert.match(SERVER, /function capWoundStacks/, 'move.ts lost capWoundStacks');
        assert.match(CLIENT, /export function capWoundStacks/, 'combat-math.ts lost capWoundStacks');
        assert.match(SERVER, /capWoundStacks\(addJutsuStatus/, 'move.ts no longer caps Wound stacks at apply');
        // PvE applies statuses through the same applyJutsu/tickStatuses, so the
        // cap is the same code — not a mirrored constant.
        assertSoloUsesSharedMove('applyJutsu');
        assertSoloUsesSharedMove('tickStatuses');
    });
    // Stun AP penalty: server move.ts uses `100 - STUN_AP_PENALTY` for the
    // stunned fighter's starting AP; the client uses `STUN_AP_PENALTY`
    // from constants/game.ts. Drift here means a stunned player on one side
    // takes a different AP hit than on the other — pin to keep the numbers
    // identical.
    it('STUN_AP_PENALTY (server) === STUN_AP_PENALTY (client constants/game.ts)', () => {
        assert.equal(
            num(SERVER_FORMULAS, 'STUN_AP_PENALTY'),
            num(CLIENT_GAME_CONSTS, 'STUN_AP_PENALTY'),
            'STUN_AP_PENALTY diverged between server move.ts and client constants/game.ts',
        );
    });
    // Guard that the authoritative shared resolver consumes the rank cap. The
    // client helper remains a preview mirror, not an independent combat engine.
    it('the live Solo/PvP resolver consumes the wound rank cap', () => {
        assert.match(CLIENT, /export function woundCapForRankPVE/, 'woundCapForRankPVE helper missing from combat-math.ts');
        // The client copy above is now preview/display only. Live PvE takes the
        // server's own rank cap, because it resolves jutsu through applyJutsu.
        assert.match(SERVER_FORMULAS, /function woundCapForJutsu/, 'combat-core/formulas.ts lost the Wound rank cap');
        assert.match(SERVER_FORMULAS, /Math\.min\(rawPercent \|\| 30, woundCapForJutsu\(jutsu\), WOUND_HARD_CAP_PCT\)/, 'shared Wound formula no longer consumes woundCapForJutsu');
        assert.match(SERVER, /woundAmountForFinalDamage\(finalDmg, pct, jutsu\)/, 'move.ts no longer consumes the shared Wound formula');
        assertSoloUsesSharedMove('applyJutsu');
    });
    // Amp duration is server-owned in the shared resolver; keep the client
    // preview constant numerically pinned and prove live status application
    // routes through statusDurationFor.
    it('amp status duration matches (IDG/IDT/DDG/DDT) and the shared resolver consumes it', () => {
        const ampNames = ['Increase Damage Given', 'Increase Damage Taken', 'Decrease Damage Given', 'Decrease Damage Taken'];
        const clientAmp = num(CLIENT, 'AMP_STATUS_ROUNDS_PVE');
        for (const name of ampNames) {
            const m = SERVER_FORMULAS.match(new RegExp(`'${name}':\\s*([0-9]+)`));
            assert.ok(m, `server STATUS_DURATIONS_OVERRIDE missing "${name}"`);
            assert.equal(Number(m![1]), clientAmp, `${name} duration (${m![1]}) != AMP_STATUS_ROUNDS_PVE (${clientAmp})`);
        }
        // PvE gets STATUS_DURATIONS_OVERRIDE for free: it applies statuses via the
        // server's applyJutsu, so there are no PvE-side per-site literals left to
        // drift.
        assert.match(SERVER, /durationFor: statusDurationFor/, 'move.ts no longer routes status duration through the shared override');
        assertSoloUsesSharedMove('applyJutsu');
    });
    // Drain executes in the shared resolver. The DRAIN_* value parity is covered
    // above; pin mastery scaling plus the HP+chakra-only tick semantics here.
    it('live Solo/PvP consumes the mastery-scaled drain helper and does not drain stamina', () => {
        assert.match(CLIENT, /export function drainTickPVE/, 'drainTickPVE helper missing from combat-math.ts');
        // drainTick lives inside move.ts tickStatuses; PvE ticks statuses with
        // that exact function, so PvE drain is mastery-scaled and stamina-free
        // by construction.
        assert.match(SERVER_FORMULAS, /export function drainTick\(masteryLevel: number\)/, 'shared Drain mastery helper is missing');
        assert.match(SERVER, /const drainTickAmount = drainTick\(masteryLevel\)/, 'move.ts no longer consumes the mastery-scaled Drain helper');
        assert.match(SERVER, /hp: Math\.max\(0, f\.hp - amt\), chakra: Math\.max\(0, f\.chakra - amt\)/, 'Drain tick no longer affects HP+chakra');
        assert.doesNotMatch(SERVER, /drainStamina/, 'Drain should not touch stamina');
        assertSoloUsesSharedMove('applyJutsu');
        assertSoloUsesSharedMove('applyDoTs');
        assertSoloUsesSharedMove('tickStatuses');
    });
    // DoT DR mitigation: the DR_DOT_SCALE value parity is covered in PAIRS
    // above; the live Solo/PvP path consumes the authoritative helper through
    // the shared DoT resolver.
    it('live Solo/PvP consumes the DoT DR-mitigation helper (not raw ticks)', () => {
        assert.match(CLIENT, /export function dotMitigationPVE/, 'dotMitigationPVE helper missing from combat-math.ts');
        // dotMitigation lives inside move.ts applyDoTs, and PvE ticks its DoTs by
        // calling that same applyDoTs — so a heavy-armour build cannot tank DoTs
        // differently in PvE than in PvP.
        assert.match(SERVER_FORMULAS, /export function dotMitigationFromRawDr/, 'shared DoT mitigation helper is missing');
        assert.match(SERVER, /const dotMitigation = dotMitigationFromRawDr\(ownArmor, ownStatusDR\)/, 'shared DoT resolver no longer consumes DR mitigation');
        assertSoloUsesSharedMove('applyDoTs');
    });
    // #5 stacking: PvP's STACKABLE_STATUS set (non-listed statuses replace on
    // re-apply) must match the client's STACKABLE_STATUS_PVE preview mirror.
    // Live Solo/PvP routes application through addCombatStatus once.
    it('STACKABLE_STATUS preview set matches and live Solo/PvP uses shared status merging', () => {
        assert.deepEqual(
            stackableSet(SERVER_TAGS, 'STACKABLE_STATUS'),
            stackableSet(CLIENT, 'STACKABLE_STATUS_PVE'),
            'stackable-status set diverged between server and client',
        );
        // PvE applies every status through the server's applyJutsu, which owns the
        // STACKABLE_STATUS replace-vs-stack decision.
        assert.match(SERVER, /statuses: addCombatStatus\(f\.statuses, s, \{[\s\S]{0,180}isStackable: name => STACKABLE_STATUS\.has\(name\)/, 'move.ts no longer routes status application through the shared merge policy');
        assertSoloUsesSharedMove('applyJutsu');
    });
    // EP mastery-scaling parity (2026-06-15). The PvP server applies a jutsu's
    // mastery to EP exactly ONCE: scaledEp = effectPower + level×0.2 (move.ts
    // resolveBaseDamage), and calculateDamage mirrors it. The bug: the PvE cast
    // fed scaleJutsuByLevel's already-mastery-scaled EP into calculateDamage,
    // which applied mastery a SECOND time — so PvE only matched PvP at max
    // mastery and under-hit below it. Solo must pass the authored jutsu to the
    // shared resolver instead of pre-scaling effectPower.
    it('Solo PvE jutsu cast does not double-scale mastery EP (feeds raw jutsu)', () => {
        // PvE no longer has a cast path of its own to double-scale in: it hands
        // the raw jutsu to the server's applyJutsu, which applies mastery once.
        assertSoloUsesSharedMove('applyJutsu');
        assert.doesNotMatch(
            SOLO_ENGINE,
            /scaledEffectPower/,
            'solo-pve/_engine.ts pre-scales EP before handing the jutsu to applyJutsu — mastery would apply twice',
        );
        assert.match(SOLO_ENGINE, /const result = applyJutsu\(\s*self,\s*opponent,\s*jutsu as Parameters<typeof applyJutsu>\[2\]/, 'Solo PvE no longer passes the authored jutsu to applyJutsu');
    });
    // "Show current-level EP": the inspect display (scaleJutsuByLevel) must use
    // the SAME mastery→EP ramp combat actually uses (epAtMax × masteryFrac, where
    // masteryFrac ramps from MASTERY_MIN_DAMAGE_FRAC to 1.0) so the EP a player
    // sees equals the EP that lands.
    it('display EP (scaleJutsuByLevel) matches the dealt-damage EP formula', () => {
        assert.match(CLIENT_SCALING, /epAtMax\s*\*\s*masteryFrac/, 'display EP no longer uses the epAtMax × masteryFrac ramp — it would diverge from dealt damage');
        assert.match(CLIENT_SCALING, /MASTERY_MIN_DAMAGE_FRAC/, 'display EP no longer ramps from MASTERY_MIN_DAMAGE_FRAC');
        assert.match(CLIENT, /epAtMax\s*\*\s*masteryFrac/, 'dealt damage (combat-math) no longer uses the epAtMax × masteryFrac ramp');
    });
    // Mastery → damage ramp parity. The steep "untrained jutsu hit soft, ramp to
    // 100% at max mastery" curve must use the SAME min-fraction and max-level on
    // the server and client, or PvE and PvP damage diverge below max mastery.
    it('MASTERY_MIN_DAMAGE_FRAC (server) === MASTERY_MIN_DAMAGE_FRAC (client constants/game.ts)', () => {
        assert.equal(
            num(SERVER_FORMULAS, 'MASTERY_MIN_DAMAGE_FRAC'),
            num(CLIENT_GAME_CONSTS, 'MASTERY_MIN_DAMAGE_FRAC'),
            'MASTERY_MIN_DAMAGE_FRAC diverged between server move.ts and client constants/game.ts',
        );
    });
    // Heal/Shield mastery ramp parity (2026-07-01). The flat Heal/Shield magnitudes
    // now scale by the SAME masteryDamageFrac curve as damage and are hard-capped at
    // the FLAT ceiling on BOTH engines — so a low-mastery heal/shield is identical in
    // PvE and PvP, and a maxed one is exactly HEAL_FLAT/SHIELD_FLAT as before.
    it('Heal/Shield ramp by masteryDamageFrac + hard-cap in the shared Solo/PvP resolver', () => {
        assert.match(SERVER_FORMULAS, /function masteryDamageFrac/, 'combat-core/formulas.ts lost the masteryDamageFrac helper');
        assert.match(CLIENT, /export function masteryDamageFrac/, 'combat-math.ts lost the masteryDamageFrac export');
        for (const src of [SERVER_FORMULAS, CLIENT]) {
            assert.match(src, /MASTERY_MIN_DAMAGE_FRAC \+ \(1 - MASTERY_MIN_DAMAGE_FRAC\)/, 'masteryDamageFrac formula drifted between engines');
        }
        // Server (move.ts): Heal/Shield = min(FLAT, floor(FLAT × magnitudeFrac × …)).
        assert.match(SERVER_FORMULAS, /function healAmountForMastery/, 'combat-core/formulas.ts lost Heal mastery helper');
        assert.match(SERVER, /healAmountForMastery\(masteryLevel, healBoost\)/, 'move.ts Heal no longer consumes the combat-core mastery helper');
        assert.match(SERVER_FORMULAS, /function shieldAmountForMastery/, 'combat-core/formulas.ts lost Shield mastery helper');
        assert.match(SERVER, /shieldAmountForMastery\(masteryLevel\)/, 'move.ts Shield no longer consumes the combat-core mastery helper');
        // PvE resolves Heal/Shield through that same move.ts path, so it inherits
        // both the mastery ramp and the flat hard-cap.
        assertSoloUsesSharedMove('applyJutsu');
    });
    it('JUTSU_MAX_LEVEL (server) === JUTSU_MAX_LEVEL (client constants/game.ts)', () => {
        assert.equal(
            num(SERVER_FORMULAS, 'JUTSU_MAX_LEVEL'),
            num(CLIENT_GAME_CONSTS, 'JUTSU_MAX_LEVEL'),
            'JUTSU_MAX_LEVEL diverged between server move.ts and client constants/game.ts — the mastery ramp denominators would differ',
        );
    });
    // Per-rank jutsu mastery-level caps (anti-twink, 2026-06-26). The EFFECTIVE
    // mastery used for EP/tag/drain/pierce scaling is clamped to the caster's rank
    // ceiling; the server (move.ts) and client (constants/game.ts) jutsuLevelCapForLevel
    // tables must agree or PvE and PvP would cap mastery differently for the same rank.
    for (const cap of ['JUTSU_LEVEL_CAP_ACADEMY', 'JUTSU_LEVEL_CAP_GENIN', 'JUTSU_LEVEL_CAP_CHUNIN', 'JUTSU_LEVEL_CAP_JONIN']) {
        it(`${cap} (server) === ${cap} (client constants/game.ts)`, () => {
            assert.equal(
                num(SERVER_FORMULAS, cap),
                num(CLIENT_GAME_CONSTS, cap),
                `${cap} diverged between server move.ts and client constants/game.ts — PvE and PvP would cap jutsu mastery differently by rank`,
            );
        });
    }
    // Per-rank STAT caps (anti-twink, progression redesign). The stats the damage
    // formula reads are clamped to the fighter's rank ceiling; the server (move.ts)
    // and client (constants/game.ts) statCapForLevel tables must agree or PvE and PvP
    // would cap stats differently for the same rank.
    for (const cap of ['STAT_CAP_ACADEMY', 'STAT_CAP_GENIN', 'STAT_CAP_CHUNIN', 'STAT_CAP_JONIN', 'STAT_CAP_SPECIAL_JONIN']) {
        it(`${cap} (server) === ${cap} (client constants/game.ts)`, () => {
            assert.equal(
                num(SERVER_FORMULAS, cap),
                num(CLIENT_GAME_CONSTS, cap),
                `${cap} diverged between server move.ts and client constants/game.ts — PvE and PvP would cap stats differently by rank`,
            );
        });
    }
    // Guard the per-rank stat cap is actually consumed by the shared cast
    // resolver and by Solo's server-authored enemy construction.
    it('per-rank stat cap is consumed by live Solo/PvP (not dead)', () => {
        assert.match(CLIENT_GAME_CONSTS, /export function perRankStatCap/, 'perRankStatCap missing from constants/game.ts');
        assert.ok(
            SERVER.includes('formulaSelf: cappedSelf') && SERVER.includes('formulaOpponent: cappedOpp'),
            'move.ts no longer feeds rank-capped fighters into the combat-core resolveJutsu base-damage phase — the PvP stat cap is dead',
        );
        // PvE caps on both ends: the sealed AI is built through perRankStatCap,
        // and the fight itself runs the same rank-capped resolveJutsu phase above.
        // Matched on the full call rather than a bare `perRankStatCap(` so the
        // guard still means something if the result stops being assigned to the
        // stats the encounter actually seals.
        assert.match(SOLO_ENCOUNTER, /const stats = perRankStatCap\(scaledStats, level\)/, 'Solo PvE no longer rank-caps server-authored enemy stats');
        assertSoloUsesSharedMove('applyJutsu');
    });

    // ── statFactor tuning triple-pin ──────────────────────────────────────────
    // The core damage curve — clamp [0.35, 1.85], slope 0.85 over MAX_STAT*2 —
    // is written out in THREE places: the authoritative server formula
    // (combat-core/formulas.ts statFactorFromComposites), the client mirror
    // (combat-math.ts), and the tower AI planning sim's frozen copy
    // (towers/_sim.ts statFactor). Retuning one without the others makes PvE
    // previews / AI planning stop matching real damage.
    function statFactorTuning(src: string, label: string): { slope: number; lo: boolean; hi: boolean } {
        const i = src.indexOf('(MAX_STAT * 2)) * ');
        assert.ok(i >= 0, `${label}: statFactor slope expression "(MAX_STAT * 2)) * <slope>" not found`);
        const around = src.slice(Math.max(0, i - 140), i + 80);
        const slope = around.match(/\(MAX_STAT \* 2\)\) \* ([0-9.]+)/);
        assert.ok(slope, `${label}: statFactor slope literal not found`);
        return { slope: Number(slope![1]), lo: around.includes('0.35'), hi: around.includes('1.85') };
    }
    it('statFactor slope + clamp agree across formulas.ts / combat-math.ts / towers/_sim.ts', () => {
        const server = statFactorTuning(SERVER_FORMULAS, 'combat-core/formulas.ts');
        const client = statFactorTuning(CLIENT, 'combat-math.ts');
        const sim = statFactorTuning(SERVER_SIM, 'towers/_sim.ts');
        for (const [label, t] of [['server', server], ['client', client], ['sim', sim]] as const) {
            assert.equal(t.slope, server.slope, `statFactor slope diverged in the ${label} copy`);
            assert.ok(t.lo && t.hi, `statFactor clamp bounds [0.35, 1.85] missing from the ${label} copy`);
        }
    });

    // ── Bloodline offense multiplier table pin (server ⇄ client) ─────────────
    // deriveBloodlineMultiplier (api/pvp/_multipliers.ts) mirrors the client's
    // getBloodlineMultiplier (combat-math.ts) by hand: S 1.20 / A 1.15 /
    // other-rank 1.10, built-in starter flat 1.08. Drift means honest fighters
    // deal different damage in PvE previews vs the sealed server fight.
    function bloodlineTable(src: string, label: string): [number, number, number, number] {
        const ranked = src.match(/S Rank["']\s*\?\s*([0-9.]+)\s*:[^?]*A Rank["']\s*\?\s*([0-9.]+)\s*:\s*([0-9.]+)/);
        assert.ok(ranked, `${label}: ranked bloodline multiplier ternary not found`);
        const starter = src.match(/return 1\.08/) ?? src.match(/\breturn ([0-9.]+); \/\/ starter/);
        assert.ok(starter, `${label}: starter (flat 1.08) branch not found`);
        return [Number(ranked![1]), Number(ranked![2]), Number(ranked![3]), 1.08];
    }
    // Gear specialty-stat fold (owner ruling 2026-07-31): live Solo and PvP
    // hydrate save-backed fighters through the same server function.
    it('gear stat-bonus fold is consumed by shared server hydration (not dead)', () => {
        assert.ok(SERVER_SESSION.includes('deriveEquipmentStatBonuses('), 'session.ts no longer folds gear stat bonuses — server combat lost gear specialty stats');
        // PvE seals its player through the SAME hydrator PvP uses, so the fold is
        // one implementation rather than two that can drift.
        assert.match(SOLO_ENCOUNTER, /const hydrated = hydrateCharacterFromSave\(/, 'Solo PvE no longer seals its player via hydrateCharacterFromSave — PvE would lose the gear stat fold');
    });

    it('bloodline multiplier table agrees (server _multipliers.ts ⇄ client combat-math.ts)', () => {
        assert.deepEqual(
            bloodlineTable(SERVER_MULT, 'api/pvp/_multipliers.ts'),
            bloodlineTable(CLIENT, 'combat-math.ts'),
            'bloodline offense multiplier table diverged between the server derivation and the client mirror',
        );
    });
});
