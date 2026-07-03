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
exports.SPIRE_ENRAGE_CAP = exports.DMG_MULT_CAP = exports.DMG_STEP = exports.HP_MULT_CAP = exports.HP_STEP = exports.SPIRE_MAX_TIER = void 0;
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
