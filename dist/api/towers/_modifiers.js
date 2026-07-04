"use strict";
/*
 * Battle Towers — Endless Spire Ascension modifiers (Wave 1).
 *
 * The Endless Spire is a dedicated boss-gauntlet mode layered on the four tower bosses:
 * floor N === ascension tier N (1..SPIRE_MAX_TIER). Difficulty escalates through a THIN,
 * CAPPED number chassis (enemy HP + outgoing damage) plus the bosses' native mechanics —
 * NOT stat inflation, which the statFactor [0.35,1.85] clamp saturates anyway.
 *
 * resolveAscensionModifiers is the PURE single source of truth: it maps a (tier, boss,
 * weekAffix) into a sealed AscensionSeal. The entry handler seals this onto the session
 * BEFORE the first writeSession; the engine only READS the sealed values (session.dmgMult,
 * session.roundCap, session.enrageCap, session.modifierStack), never recomputing them. No
 * kv / clock / RNG here → the seal is deterministic and refresh-safe.
 *
 * The full TowerModifier union declares the W2/W3 kinds too, but Wave 1 only EMITS (and the
 * engine only CONSUMES) the number/mechanic kinds; the affix-hazard / objective / capstone
 * kinds are frozen shapes with no consumer yet (Waves 2/3 add them without re-shaping this).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPIRE_WEEKLY_BLESSINGS = exports.DUAL_AUGMENT_DEBUFF_BONUS = exports.DUAL_AUGMENT_HAZARD_BONUS = exports.SUDDEN_DEATH_PCT = exports.SUDDEN_DEATH_WINDOW = exports.EXTRA_PHASE_BLAST_PCT = exports.EXTRA_PHASE_THRESHOLD = exports.HEALCUT_MAX = exports.DEBUFF_TAKEN_CAP = exports.SPIRE_ENRAGE_CAP = exports.DMG_MULT_CAP = exports.DMG_STEP = exports.HP_MULT_CAP = exports.HP_STEP = exports.SPIRE_MAX_TIER = void 0;
exports.weeklySpireBlessing = weeklySpireBlessing;
exports.ascensionHpMult = ascensionHpMult;
exports.ascensionDmgMult = ascensionDmgMult;
exports.resolveAscensionModifiers = resolveAscensionModifiers;
// ── Ascension constants (the thin, capped number chassis) ──────────────────────
exports.SPIRE_MAX_TIER = 20;
exports.HP_STEP = 0.10; // hpMult = 1 + tier*0.10 (guide)
exports.HP_MULT_CAP = 3.0;
exports.DMG_STEP = 0.06; // dmgMult = 1 + tier*0.06 (applied to enemy damage)
exports.DMG_MULT_CAP = 2.20;
exports.SPIRE_ENRAGE_CAP = 2; // enrage bounded to 2 stacks (1.70×) — the load-bearing anti-one-shot cap
// ── Wave 2 affix keystones (floors 9-14+) ──────────────────────────────────────
// Keystones layer a TACTICAL demand on top of the number chassis so mid-Spire floors
// stop being a pure stat-check. Three consumers, all squad-side and all sealed:
//   • hazard  — round-end tile chip (engine derives tiles from map geometry + variant)
//   • debuff  — extra INCOMING damage on squad targets, folded at the wMult junction
//   • healcut — reduces net healing the squad receives (snapshot-scaled in runJutsu)
// DEBUFF_TAKEN_CAP is the direct analog of SPIRE_ENRAGE_CAP: debuff is a NEW multiplicative
// term on the same wMult product as enrage(≤1.70×) × dmgMult(≤2.20×), so the summed
// vulnerability is hard-clamped here at the seal so a maxed enemy hit can't cold-one-shot.
exports.DEBUFF_TAKEN_CAP = 0.30; // max +30% incoming damage from all vulnerability keystones combined
exports.HEALCUT_MAX = 60; // healing-reduction percent is clamped to this (never a net negative heal)
// ── Wave 3 capstones (floors 15-20) — the apex encounters ──────────────────────
// Three FROZEN kinds finally get consumers, each bounded + story-safe:
//   • extraPhase — an extra HP-gate that fires a one-time DESPERATION BLAST to the squad
//     (bounded % of maxHp, never regen → can't stall past the round cap).
//   • objective  — "Sudden Death": the arena collapses in the final rounds, chipping the
//     whole squad so stalling out the clock is fatal (bounded, late-round only).
//   • dualAugment — "Cataclysm": the hazard + vulnerability keystones amplify each other,
//     staying UNDER DEBUFF_TAKEN_CAP (the debuff clamp still hard-bounds the one-shot ceiling).
exports.EXTRA_PHASE_THRESHOLD = 40; // HP% gate the desperation blast fires at (distinct from all boss phases)
exports.EXTRA_PHASE_BLAST_PCT = 6; // desperation blast = this % of each squad member's maxHp (one-time)
exports.SUDDEN_DEATH_WINDOW = 3; // collapse chips the squad in the last N rounds before the cap
exports.SUDDEN_DEATH_PCT = 5; // collapse chip = this % of each squad member's maxHp per round
exports.DUAL_AUGMENT_HAZARD_BONUS = 1; // +1% to each hazard chip when Cataclysm is live
exports.DUAL_AUGMENT_DEBUFF_BONUS = 5; // +5% summed vulnerability (still clamped to DEBUFF_TAKEN_CAP)
// Cumulative tier gates for the keystones (a floor carries every keystone at/under its tier).
const HAZARD_ROTATING_TIER = 9; // a sweeping column of fire — dodge by moving off it each round
const DEBUFF_FLAT_TIER = 10; // Sundered Guard — flat +damage-taken, unconditional
const HEALCUT_TIER = 11; // Withering Aura — squad healing is throttled
const HAZARD_PROXIMITY_TIER = 13; // Chain Lightning — punishes clustering (≥2 allies adjacent)
const DEBUFF_POSITIONAL_TIER = 14; // Exposed — +damage-taken UNLESS the target stands on a ward
const EXTRA_PHASE_TIER = 15; // Second Wind — desperation blast phase (Wave 3)
const SUDDEN_DEATH_TIER = 17; // Sudden Death — collapsing-floor finale (Wave 3)
const DUAL_AUGMENT_TIER = 18; // Cataclysm — keystone synergy (Wave 3)
const HAZARD_ESCALATING_TIER = 19; // Rising Inferno — a central blaze whose bite grows each round
exports.SPIRE_WEEKLY_BLESSINGS = [
    { id: 'vigor', name: 'Ancestral Vigor', icon: '⏳', blurb: '+3 rounds on every floor — more time to out-think the boss.', modifier: { kind: 'roundCap', value: 3, label: '✨ Blessing — Ancestral Vigor (+3 rounds)' } },
    { id: 'falter', name: 'Faltering Foes', icon: '🛡️', blurb: 'Enemies deal 12% less damage this week.', modifier: { kind: 'dmg', value: -0.12, label: '✨ Blessing — Faltering Foes (foes −12% damage)' } },
    { id: 'trial', name: 'Extended Trial', icon: '🕰️', blurb: '+4 rounds on every floor — a patient week to push deep.', modifier: { kind: 'roundCap', value: 4, label: '✨ Blessing — Extended Trial (+4 rounds)' } },
    { id: 'waning', name: 'Waning Malice', icon: '🌙', blurb: 'Enemies deal 8% less damage this week.', modifier: { kind: 'dmg', value: -0.08, label: '✨ Blessing — Waning Malice (foes −8% damage)' } },
    { id: 'tailwind', name: "Climber's Tailwind", icon: '🍃', blurb: 'Enemies deal 15% less damage — a gentle week for new climbers.', modifier: { kind: 'dmg', value: -0.15, label: "✨ Blessing — Climber's Tailwind (foes −15% damage)" } },
];
/** PURE. The Weekly Blessing for a reset-week index (deterministic; clock-free). */
function weeklySpireBlessing(weekIndex) {
    const n = exports.SPIRE_WEEKLY_BLESSINGS.length;
    const i = ((Math.floor(Number(weekIndex) || 0) % n) + n) % n;
    return exports.SPIRE_WEEKLY_BLESSINGS[i];
}
function clampTier(tier) {
    return Math.max(1, Math.min(exports.SPIRE_MAX_TIER, Math.floor(Number(tier) || 1)));
}
function ascensionHpMult(tier) {
    return Math.min(exports.HP_MULT_CAP, 1 + clampTier(tier) * exports.HP_STEP);
}
function ascensionDmgMult(tier) {
    return Math.min(exports.DMG_MULT_CAP, 1 + clampTier(tier) * exports.DMG_STEP);
}
const round2 = (n) => Math.round(n * 100) / 100;
/**
 * PURE. Resolve a spire (tier, bossId, roundBudget, weekAffix?) into the sealed AscensionSeal.
 * The engine reads the sealed values; it never calls this again. `roundBudget` is the floor's
 * authored budget (already carries headroom over the target kill time); Wave 1 uses it verbatim
 * as the hard cap (Waves 2/3 add the round-tightening keystones). `weekAffix`, if given, is
 * layered onto the manifest and (for number-kind affixes) folded into the effective mults.
 */
function resolveAscensionModifiers(tier, bossId, roundBudget, weekAffix) {
    const t = clampTier(tier);
    let hpMult = ascensionHpMult(t);
    let dmgMult = ascensionDmgMult(t);
    let roundCap = Math.max(1, Math.floor(Number(roundBudget) || 12));
    const stack = [
        { kind: 'hp', value: round2(hpMult), label: `Hardened Foes ×${round2(hpMult)}` },
        { kind: 'dmg', value: round2(dmgMult), label: `Sharpened Strikes ×${round2(dmgMult)}` },
        { kind: 'roundCap', value: roundCap, label: `${roundCap}-round limit` },
        { kind: 'enrageCap', value: exports.SPIRE_ENRAGE_CAP, label: `Enrage cap ${exports.SPIRE_ENRAGE_CAP}` },
    ];
    // Wave 2 keystones — cumulative by tier. Values are percentages (hazard/debuff = % of
    // squad maxHp / % extra damage-taken; healcut = % healing removed) and stay modest +
    // playtest-tunable; the engine caps the combined debuff at DEBUFF_TAKEN_CAP. The engine
    // owns hazard tile geometry — the modifier carries only its variant + percent.
    if (t >= HAZARD_ROTATING_TIER)
        stack.push({ kind: 'hazard', variant: 'rotating', value: 4, label: 'Rolling Cinders — 4% HP on the burning column' });
    if (t >= DEBUFF_FLAT_TIER)
        stack.push({ kind: 'debuff', variant: 'flat', value: 10, label: 'Sundered Guard — +10% damage taken' });
    if (t >= HEALCUT_TIER)
        stack.push({ kind: 'healcut', variant: 'flat', value: 30, label: 'Withering Aura — squad healing −30%' });
    if (t >= HAZARD_PROXIMITY_TIER)
        stack.push({ kind: 'hazard', variant: 'proximity', value: 5, label: 'Chain Lightning — 5% HP where allies cluster' });
    if (t >= DEBUFF_POSITIONAL_TIER)
        stack.push({ kind: 'debuff', variant: 'positional', value: 12, label: 'Exposed — +12% damage taken off-ward' });
    // Wave 3 capstones (floors 15-20).
    if (t >= EXTRA_PHASE_TIER)
        stack.push({ kind: 'extraPhase', value: exports.EXTRA_PHASE_THRESHOLD, label: `Second Wind — a desperation blast at ${exports.EXTRA_PHASE_THRESHOLD}% HP` });
    if (t >= SUDDEN_DEATH_TIER)
        stack.push({ kind: 'objective', variant: 'flat', value: exports.SUDDEN_DEATH_WINDOW, label: 'Sudden Death — the floor collapses in the final rounds' });
    if (t >= DUAL_AUGMENT_TIER)
        stack.push({ kind: 'dualAugment', value: 1, label: 'Cataclysm — hazards and vulnerability feed each other' });
    if (t >= HAZARD_ESCALATING_TIER)
        stack.push({ kind: 'hazard', variant: 'escalating', value: 3, label: 'Rising Inferno — a central blaze that grows each round' });
    // Weekly affix — a single extra modifier layered on every floor this week. Only the
    // Wave-1 number kinds actually bite; the rest render as a chip until their wave lands.
    if (weekAffix) {
        stack.push(weekAffix);
        if (weekAffix.kind === 'hp')
            hpMult = Math.min(exports.HP_MULT_CAP, round2(hpMult + weekAffix.value));
        else if (weekAffix.kind === 'dmg')
            dmgMult = Math.min(exports.DMG_MULT_CAP, round2(dmgMult + weekAffix.value));
        else if (weekAffix.kind === 'roundCap')
            roundCap = Math.max(1, roundCap + Math.floor(weekAffix.value));
    }
    return {
        ascensionTier: t,
        hpMult: round2(hpMult),
        dmgMult: round2(dmgMult),
        roundCap,
        enrageCap: exports.SPIRE_ENRAGE_CAP,
        modifierStack: stack,
    };
}
