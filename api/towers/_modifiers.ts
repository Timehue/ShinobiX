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
