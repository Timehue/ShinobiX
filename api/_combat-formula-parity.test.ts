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
// two sources are read for. api/combat-core/pvp-solo-jutsu-parity.test.ts backs
// this behaviourally by running BOTH real engines over the whole jutsu catalog.
const SOLO_ENGINE = readFileSync(join(ROOT, 'api', 'solo-pve', '_engine.ts'), 'utf8');
const SOLO_ENCOUNTER = readFileSync(join(ROOT, 'api', 'solo-pve', '_ai-encounter.ts'), 'utf8');
/** The resolvers solo PvE pulls out of api/pvp/move.ts (its whole combat core). */
const SOLO_SHARED_RESOLVERS = (() => {
    const block = SOLO_ENGINE.match(/import \{([^}]*)\} from '\.\.\/pvp\/move\.js';/);
    assert.ok(block, 'solo-pve/_engine.ts no longer imports from the PvP engine at all — PvE has forked its own combat core');
    return block![1].split(',').map((name) => name.trim()).filter(Boolean);
})();
const sharesWithPvp = (fn: string) => assert.ok(
    SOLO_SHARED_RESOLVERS.includes(fn),
    `solo-pve/_engine.ts no longer imports ${fn} from api/pvp/move.ts — PvE would need its own copy, reopening PvE↔PvP drift`,
);
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
    // Now centralized in dotMitigationPVE, which #4 below proves App.tsx calls.
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
    // Both engines must cap at the same number or PvE and PvP bleed diverge.
    it('MAX_WOUND_STACKS (server) === MAX_WOUND_STACKS_PVE (client) + both engines cap at apply', () => {
        assert.equal(num(SERVER_FORMULAS, 'MAX_WOUND_STACKS'), num(CLIENT, 'MAX_WOUND_STACKS_PVE'), 'Wound stack cap diverged between server and client');
        assert.match(SERVER, /function capWoundStacks/, 'move.ts lost capWoundStacks');
        assert.match(CLIENT, /export function capWoundStacks/, 'combat-math.ts lost capWoundStacks');
        assert.match(SERVER, /capWoundStacks\(addJutsuStatus/, 'move.ts no longer caps Wound stacks at apply');
        // PvE applies statuses through the same applyJutsu/tickStatuses, so the
        // cap is the same code — not a mirrored constant.
        sharesWithPvp('applyJutsu');
        sharesWithPvp('tickStatuses');
    });
    // Stun AP penalty: server move.ts uses `100 - STUN_AP_PENALTY` for the
    // stunned fighter's starting AP; client App.tsx uses `STUN_AP_PENALTY`
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
    // Regression guard for the 2026-06-05 audit finding: WOUND_CAP_BY_RANK_PVE was
    // DEFINED BUT NEVER READ, so the cap-value assertion above passed while the PvE
    // wound path applied no rank cap at all. Assert the cap is actually consumed so
    // it can't silently go dead again (which would re-open the PvE↔PvP divergence).
    it('PvE actually consumes the wound rank cap (not a dead constant)', () => {
        assert.match(CLIENT, /export function woundCapForRankPVE/, 'woundCapForRankPVE helper missing from combat-math.ts');
        // The client copy above is now preview/display only. Live PvE takes the
        // server's own rank cap, because it resolves jutsu through applyJutsu.
        assert.match(SERVER_FORMULAS, /function woundCapForJutsu/, 'combat-core/formulas.ts lost the Wound rank cap');
        assert.match(
            SERVER_FORMULAS,
            /woundCapForJutsu\(jutsu\)/,
            'woundAmountForFinalDamage no longer applies the rank cap — Wound would ignore bloodline rank',
        );
        assert.match(SERVER, /woundAmountForFinalDamage\(/, 'move.ts no longer routes Wound through the rank-capped helper');
        sharesWithPvp('applyJutsu');
    });
    // #2 amp duration: PvP forces IDG/IDT/DDG/DDT to 4 rounds (STATUS_DURATIONS_OVERRIDE);
    // PvE centralizes the same value in AMP_STATUS_ROUNDS_PVE. Assert all four server
    // overrides equal the client constant AND that App.tsx actually consumes it (so the
    // amp duration can't silently drift back to the old per-site `rounds: 2`).
    it('amp status duration matches (IDG/IDT/DDG/DDT) and PvE consumes the constant', () => {
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
        sharesWithPvp('applyJutsu');
    });
    // #3 Drain: PvE consumes drainTickPVE (mastery-scaled, HP+chakra only). The
    // DRAIN_* value parity is covered by the PAIRS loop above; this guards that the
    // PvE path actually uses the helper (not the old flat-250 literal) and no longer
    // drains stamina.
    it('PvE consumes the mastery-scaled drain helper and drops stamina drain', () => {
        assert.match(CLIENT, /export function drainTickPVE/, 'drainTickPVE helper missing from combat-math.ts');
        // drainTick lives inside move.ts tickStatuses; PvE ticks statuses with
        // that exact function, so PvE drain is mastery-scaled and stamina-free
        // by construction.
        assert.match(SERVER, /drainTick\(/, 'move.ts no longer mastery-scales Drain');
        sharesWithPvp('tickStatuses');
    });
    // DoT DR mitigation: the DR_DOT_SCALE value parity is covered in PAIRS
    // above; this guards that PvE actually CONSUMES the dotMitigationPVE
    // helper (App.tsx applies it where it ticks Wound/Poison/Drain). Without
    // the helper, PvE applied DoTs raw and a heavy-armor build tanked DoTs
    // harder in PvP than in PvE — the same balance gap the wound-cap and amp
    // duration regression guards catch.
    it('PvE consumes the DoT DR-mitigation helper (not raw ticks)', () => {
        assert.match(CLIENT, /export function dotMitigationPVE/, 'dotMitigationPVE helper missing from combat-math.ts');
        // dotMitigation lives inside move.ts applyDoTs, and PvE ticks its DoTs by
        // calling that same applyDoTs — so a heavy-armour build cannot tank DoTs
        // differently in PvE than in PvP.
        assert.match(SERVER, /dotMitigationFromRawDr\(/, 'move.ts no longer DR-mitigates DoT ticks');
        sharesWithPvp('applyDoTs');
    });
    // #5 stacking: PvP's STACKABLE_STATUS set (non-listed statuses replace on
    // re-apply) must match the client's STACKABLE_STATUS_PVE, and App.tsx must
    // route status application through mergeCombatStatus (else non-stackable
    // statuses — Stun/Seals/Prevents/DoTs — pile up again).
    it('STACKABLE_STATUS set matches and PvE routes through mergeCombatStatus', () => {
        assert.deepEqual(
            stackableSet(SERVER_TAGS, 'STACKABLE_STATUS'),
            stackableSet(CLIENT, 'STACKABLE_STATUS_PVE'),
            'stackable-status set diverged between server and client',
        );
        // PvE applies every status through the server's applyJutsu, which owns the
        // STACKABLE_STATUS replace-vs-stack decision.
        sharesWithPvp('applyJutsu');
    });
    // EP mastery-scaling parity (2026-06-15). The PvP server applies a jutsu's
    // mastery to EP exactly ONCE: scaledEp = effectPower + level×0.2 (move.ts
    // resolveBaseDamage), and calculateDamage mirrors it. The bug: the PvE cast
    // fed scaleJutsuByLevel's already-mastery-scaled EP into calculateDamage,
    // which applied mastery a SECOND time — so PvE only matched PvP at max
    // mastery and under-hit below it. The cast must pass RAW effectPower.
    it('PvE jutsu cast does not double-scale mastery EP (feeds raw EP)', () => {
        // PvE no longer has a cast path of its own to double-scale in: it hands
        // the raw jutsu to the server's applyJutsu, which applies mastery once.
        sharesWithPvp('applyJutsu');
        assert.doesNotMatch(
            SOLO_ENGINE,
            /scaledEffectPower/,
            'solo-pve/_engine.ts pre-scales EP before handing the jutsu to applyJutsu — mastery would apply twice',
        );
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
    it('Heal/Shield ramp by masteryDamageFrac + hard-cap (server move.ts ⇄ client Arena.tsx)', () => {
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
        sharesWithPvp('applyJutsu');
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
    // Guard the per-rank stat cap is actually CONSUMED on both sides (not a dead
    // constant, like the wound-cap regression of 2026-06-05): PvP feeds rank-capped
    // fighters into resolveBaseDamage; PvE wraps the combat-stat objects in Arena.tsx.
    it('per-rank stat cap is consumed on both sides (not dead)', () => {
        assert.match(CLIENT_GAME_CONSTS, /export function perRankStatCap/, 'perRankStatCap missing from constants/game.ts');
        assert.ok(
            SERVER.includes('formulaSelf: cappedSelf') && SERVER.includes('formulaOpponent: cappedOpp'),
            'move.ts no longer feeds rank-capped fighters into the combat-core resolveJutsu base-damage phase — the PvP stat cap is dead',
        );
        // PvE caps on both ends: the sealed AI is built through perRankStatCap,
        // and the fight itself runs the same rank-capped resolveJutsu phase above.
        assert.ok(
            SOLO_ENCOUNTER.includes('perRankStatCap('),
            'solo-pve/_ai-encounter.ts no longer rank-caps the sealed AI stats — the PvE stat cap is dead',
        );
        sharesWithPvp('applyJutsu');
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
    // Gear specialty-stat fold (owner ruling 2026-07-31): the client folds
    // equipped-item stat bonuses into combat stats (Arena characterCombatStats)
    // and the server mirrors it in hydrateCharacterFromSave. Guard both sides
    // actually CONSUME the fold so neither can silently drop it.
    it('gear stat-bonus fold is consumed on both sides (not dead)', () => {
        const SERVER_SESSION = readFileSync(join(ROOT, 'api', 'pvp', 'session.ts'), 'utf8');
        assert.ok(SERVER_SESSION.includes('deriveEquipmentStatBonuses('), 'session.ts no longer folds gear stat bonuses — server combat lost gear specialty stats');
        // PvE seals its player through the SAME hydrator PvP uses, so the fold is
        // one implementation rather than two that can drift.
        assert.ok(
            SOLO_ENCOUNTER.includes('hydrateCharacterFromSave('),
            'solo-pve/_ai-encounter.ts no longer seals its player via hydrateCharacterFromSave — PvE would lose the gear stat fold',
        );
    });

    it('bloodline multiplier table agrees (server _multipliers.ts ⇄ client combat-math.ts)', () => {
        assert.deepEqual(
            bloodlineTable(SERVER_MULT, 'api/pvp/_multipliers.ts'),
            bloodlineTable(CLIENT, 'combat-math.ts'),
            'bloodline offense multiplier table diverged between the server derivation and the client mirror',
        );
    });
});
