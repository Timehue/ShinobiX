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

// ── Frozen type surface (define once; Waves 2/3 add consumers, never re-shape) ──
export type TowerModifierKind =
    // Wave 1 — number chassis + boss-mechanic levers (consumed by the engine now)
    | 'hp' | 'dmg' | 'roundCap' | 'summon' | 'regen' | 'enrageCap'
    // Wave 2 — affix keystones (frozen; no consumer until Wave 2)
    | 'hazard' | 'debuff' | 'healcut'
    // Wave 3 — objectives + capstones (frozen; no consumer until Wave 3)
    | 'objective' | 'extraPhase' | 'dualAugment';

export type TowerModifier = {
    kind: TowerModifierKind;
    /** numeric payload — meaning depends on kind (a multiplier, a percent, a count, a flag-as-1) */
    value: number;
    /** short human label rendered in the pre-fight modifier manifest */
    label: string;
    /** Wave-2 hazard variant discriminant (unused in Wave 1) */
    variant?: 'static' | 'rotating' | 'proximity' | 'escalating' | 'flat' | 'positional';
};

/** The sealed result of resolving a spire tier. Written onto the session at entry; read-only after. */
export type AscensionSeal = {
    ascensionTier: number;
    /** enemy max-HP multiplier — GUIDE only (spire HP is authored per-floor); surfaced for the manifest */
    hpMult: number;
    /** enemy OUTGOING damage multiplier, folded at the engine's wMult junction for enemy attackers */
    dmgMult: number;
    /** hard round cap for this floor (>= 1); the engine reads it in place of MAX_ROUNDS */
    roundCap: number;
    /** max enrage stacks the boss may reach (spire-only; story leaves this unset → uncapped) */
    enrageCap: number;
    /** sealed modifier list, rendered as manifest chips + (Waves 2/3) consumed by the engine */
    modifierStack: TowerModifier[];
};

// ── Ascension constants (the thin, capped number chassis) ──────────────────────
export const SPIRE_MAX_TIER = 20;
export const HP_STEP = 0.10;          // hpMult = 1 + tier*0.10 (guide)
export const HP_MULT_CAP = 3.0;
export const DMG_STEP = 0.06;         // dmgMult = 1 + tier*0.06 (applied to enemy damage)
export const DMG_MULT_CAP = 2.20;
export const SPIRE_ENRAGE_CAP = 2;    // enrage bounded to 2 stacks (1.70×) — the load-bearing anti-one-shot cap

// ── Wave 2 affix keystones (floors 9-14+) ──────────────────────────────────────
// Keystones layer a TACTICAL demand on top of the number chassis so mid-Spire floors
// stop being a pure stat-check. Three consumers, all squad-side and all sealed:
//   • hazard  — round-end tile chip (engine derives tiles from map geometry + variant)
//   • debuff  — extra INCOMING damage on squad targets, folded at the wMult junction
//   • healcut — reduces net healing the squad receives (snapshot-scaled in runJutsu)
// DEBUFF_TAKEN_CAP is the direct analog of SPIRE_ENRAGE_CAP: debuff is a NEW multiplicative
// term on the same wMult product as enrage(≤1.70×) × dmgMult(≤2.20×), so the summed
// vulnerability is hard-clamped here at the seal so a maxed enemy hit can't cold-one-shot.
export const DEBUFF_TAKEN_CAP = 0.30;   // max +30% incoming damage from all vulnerability keystones combined
export const HEALCUT_MAX = 60;          // healing-reduction percent is clamped to this (never a net negative heal)

// ── Wave 3 capstones (floors 15-20) — the apex encounters ──────────────────────
// Three FROZEN kinds finally get consumers, each bounded + story-safe:
//   • extraPhase — an extra HP-gate that fires a one-time DESPERATION BLAST to the squad
//     (bounded % of maxHp, never regen → can't stall past the round cap).
//   • objective  — "Sudden Death": the arena collapses in the final rounds, chipping the
//     whole squad so stalling out the clock is fatal (bounded, late-round only).
//   • dualAugment — "Cataclysm": the hazard + vulnerability keystones amplify each other,
//     staying UNDER DEBUFF_TAKEN_CAP (the debuff clamp still hard-bounds the one-shot ceiling).
export const EXTRA_PHASE_THRESHOLD = 40;      // HP% gate the desperation blast fires at (distinct from all boss phases)
export const EXTRA_PHASE_BLAST_PCT = 6;       // desperation blast = this % of each squad member's maxHp (one-time)
export const SUDDEN_DEATH_WINDOW = 3;         // collapse chips the squad in the last N rounds before the cap
export const SUDDEN_DEATH_PCT = 5;            // collapse chip = this % of each squad member's maxHp per round
export const DUAL_AUGMENT_HAZARD_BONUS = 1;   // +1% to each hazard chip when Cataclysm is live
export const DUAL_AUGMENT_DEBUFF_BONUS = 5;   // +5% summed vulnerability (still clamped to DEBUFF_TAKEN_CAP)

// Cumulative tier gates for the keystones (a floor carries every keystone at/under its tier).
const HAZARD_ROTATING_TIER = 9;   // a sweeping column of fire — dodge by moving off it each round
const DEBUFF_FLAT_TIER = 10;      // Sundered Guard — flat +damage-taken, unconditional
const HEALCUT_TIER = 11;          // Withering Aura — squad healing is throttled
const HAZARD_PROXIMITY_TIER = 13; // Chain Lightning — punishes clustering (≥2 allies adjacent)
const DEBUFF_POSITIONAL_TIER = 14;// Exposed — +damage-taken UNLESS the target stands on a ward
const EXTRA_PHASE_TIER = 15;      // Second Wind — desperation blast phase (Wave 3)
const SUDDEN_DEATH_TIER = 17;     // Sudden Death — collapsing-floor finale (Wave 3)
const DUAL_AUGMENT_TIER = 18;     // Cataclysm — keystone synergy (Wave 3)
const HAZARD_ESCALATING_TIER = 19;// Rising Inferno — a central blaze whose bite grows each round

// ── Weekly Blessing — a rotating, player-FAVOURABLE affix layered on every floor this
//    reset-week. Deliberately all boons (never punishes) → low friction; it just varies HOW the
//    week helps (more time vs. softer foes), giving a fresh reason to push your weekly best.
//    Sealed at ENTRY (the handler computes the week index once and passes .modifier into
//    resolveAscensionModifiers → folded into dmgMult/roundCap + shown as a chip). PURE + clock-free
//    here, so a run started mid-week keeps its blessing across a week rollover, and settle needs no
//    recompute. The engine's `Math.max(1, dmgMult)` floor means a dmg boon can't make foes weaker
//    than base at the very lowest tiers — fine, those floors are trivial anyway.
export type SpireWeeklyBlessing = { id: string; name: string; blurb: string; icon: string; modifier: TowerModifier };
export const SPIRE_WEEKLY_BLESSINGS: readonly SpireWeeklyBlessing[] = [
    { id: 'vigor',    name: 'Ancestral Vigor',      icon: '⏳', blurb: '+3 rounds on every floor — more time to out-think the boss.',        modifier: { kind: 'roundCap', value: 3,     label: '✨ Blessing — Ancestral Vigor (+3 rounds)' } },
    { id: 'falter',   name: 'Faltering Foes',       icon: '🛡️', blurb: 'Enemies deal 12% less damage this week.',                            modifier: { kind: 'dmg',      value: -0.12, label: '✨ Blessing — Faltering Foes (foes −12% damage)' } },
    { id: 'trial',    name: 'Extended Trial',       icon: '🕰️', blurb: '+4 rounds on every floor — a patient week to push deep.',           modifier: { kind: 'roundCap', value: 4,     label: '✨ Blessing — Extended Trial (+4 rounds)' } },
    { id: 'waning',   name: 'Waning Malice',        icon: '🌙', blurb: 'Enemies deal 8% less damage this week.',                             modifier: { kind: 'dmg',      value: -0.08, label: '✨ Blessing — Waning Malice (foes −8% damage)' } },
    { id: 'tailwind', name: "Climber's Tailwind",   icon: '🍃', blurb: 'Enemies deal 15% less damage — a gentle week for new climbers.',    modifier: { kind: 'dmg',      value: -0.15, label: "✨ Blessing — Climber's Tailwind (foes −15% damage)" } },
];
/** PURE. The Weekly Blessing for a reset-week index (deterministic; clock-free). */
export function weeklySpireBlessing(weekIndex: number): SpireWeeklyBlessing {
    const n = SPIRE_WEEKLY_BLESSINGS.length;
    const i = ((Math.floor(Number(weekIndex) || 0) % n) + n) % n;
    return SPIRE_WEEKLY_BLESSINGS[i]!;
}

function clampTier(tier: number): number {
    return Math.max(1, Math.min(SPIRE_MAX_TIER, Math.floor(Number(tier) || 1)));
}

export function ascensionHpMult(tier: number): number {
    return Math.min(HP_MULT_CAP, 1 + clampTier(tier) * HP_STEP);
}
export function ascensionDmgMult(tier: number): number {
    return Math.min(DMG_MULT_CAP, 1 + clampTier(tier) * DMG_STEP);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * PURE. Resolve a spire (tier, bossId, roundBudget, weekAffix?) into the sealed AscensionSeal.
 * The engine reads the sealed values; it never calls this again. `roundBudget` is the floor's
 * authored budget (already carries headroom over the target kill time); Wave 1 uses it verbatim
 * as the hard cap (Waves 2/3 add the round-tightening keystones). `weekAffix`, if given, is
 * layered onto the manifest and (for number-kind affixes) folded into the effective mults.
 */
export function resolveAscensionModifiers(
    tier: number,
    bossId: string,
    roundBudget: number,
    weekAffix?: TowerModifier,
): AscensionSeal {
    const t = clampTier(tier);
    let hpMult = ascensionHpMult(t);
    let dmgMult = ascensionDmgMult(t);
    let roundCap = Math.max(1, Math.floor(Number(roundBudget) || 12));

    const stack: TowerModifier[] = [
        { kind: 'hp', value: round2(hpMult), label: `Hardened Foes ×${round2(hpMult)}` },
        { kind: 'dmg', value: round2(dmgMult), label: `Sharpened Strikes ×${round2(dmgMult)}` },
        { kind: 'roundCap', value: roundCap, label: `${roundCap}-round limit` },
        { kind: 'enrageCap', value: SPIRE_ENRAGE_CAP, label: `Enrage cap ${SPIRE_ENRAGE_CAP}` },
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
        stack.push({ kind: 'extraPhase', value: EXTRA_PHASE_THRESHOLD, label: `Second Wind — a desperation blast at ${EXTRA_PHASE_THRESHOLD}% HP` });
    if (t >= SUDDEN_DEATH_TIER)
        stack.push({ kind: 'objective', variant: 'flat', value: SUDDEN_DEATH_WINDOW, label: 'Sudden Death — the floor collapses in the final rounds' });
    if (t >= DUAL_AUGMENT_TIER)
        stack.push({ kind: 'dualAugment', value: 1, label: 'Cataclysm — hazards and vulnerability feed each other' });
    if (t >= HAZARD_ESCALATING_TIER)
        stack.push({ kind: 'hazard', variant: 'escalating', value: 3, label: 'Rising Inferno — a central blaze that grows each round' });

    // Weekly affix — a single extra modifier layered on every floor this week. Only the
    // Wave-1 number kinds actually bite; the rest render as a chip until their wave lands.
    if (weekAffix) {
        stack.push(weekAffix);
        if (weekAffix.kind === 'hp') hpMult = Math.min(HP_MULT_CAP, round2(hpMult + weekAffix.value));
        else if (weekAffix.kind === 'dmg') dmgMult = Math.min(DMG_MULT_CAP, round2(dmgMult + weekAffix.value));
        else if (weekAffix.kind === 'roundCap') roundCap = Math.max(1, roundCap + Math.floor(weekAffix.value));
    }

    return {
        ascensionTier: t,
        hpMult: round2(hpMult),
        dmgMult: round2(dmgMult),
        roundCap,
        enrageCap: SPIRE_ENRAGE_CAP,
        modifierStack: stack,
    };
}
