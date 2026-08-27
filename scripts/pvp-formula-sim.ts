/**
 * PvP formula sandbox — exercises a deterministic subset of the live combat
 * helpers under three scenarios:
 *
 *   A) statFactor matrix for archetypal stat builds (no combat — pure formula)
 *   B) Head-to-head damage breakdown between the same 6 builds
 *   C) 100-fighter tournament: every fighter at max stats, A-rank bloodline,
 *      6-piece Legendary set, best weapon. Six hand-designed, five-jutsu
 *      archetype drafts are sealed through the live player-content schema.
 *      A deterministic rule policy runs an AP-based turn (100 AP/turn) and
 *      chooses among damage, sustain, Cleanse, Clear, and equipment actions.
 *      Every unordered pair is crossed over BOTH fighter seat and opener, and
 *      seat/opener diagnostics are reported independently of archetype rates.
 *
 * This is still a model, not the authoritative api/pvp/move.ts handler. It has
 * no grid/pathing, targeting, consumable choice, human tactics, or stochastic
 * policy. Its rates are policy-conditioned diagnostics, not live win forecasts.
 * Keep the limitations printed by scenario C when interpreting output.
 *
 * Run: npx tsx scripts/pvp-formula-sim.ts
 */

import { basename } from 'node:path';
import {
    normalizePlayerBloodlineJutsus,
} from '../api/bloodlines/_jutsu-schema.js';
import {
    CAPPED_AMP_TAGS,
    COPY_EXCLUDED_BUFFS,
    STACKABLE_STATUS,
} from '../api/pvp/_tags.js';
import {
    EP_MULTIPLIER,
    JUTSU_MAX_LEVEL,
    MAX_STAT,
    MAX_WOUND_STACKS,
    STUN_AP_PENALTY,
    WEAPON_AMP_TAG_CAP,
    WOUND_CAP_BY_RANK,
    ampTagCapForRank,
    ampMultiplierFromStatuses,
    bloodlineDamageMultiplier,
    cappedPostDamage,
    drainTick,
    drContributionFromStatuses,
    dotMitigationFromRawDr,
    effectiveDrFromRaw,
    getDefense,
    getOffense,
    healAmountForMastery,
    itemDamageMultiplier,
    pierceTrueDamage,
    scaledTagPercent,
    shieldAmountForMastery,
    statFactorFromComposites,
    statusDurationFor,
} from '../api/combat-core/formulas.js';
import { MAX_ACTIONS, MAX_ROUNDS } from '../api/combat-core/constants.js';
import { adjustedApCost } from '../api/combat-core/resources.js';
import {
    activeCombatStatuses,
    addCombatStatus,
    capDeferredCombatStatusStacks,
    countActiveCombatStatuses,
    hasCombatStatus,
    removeActiveCombatStatusesByKind,
    removeActiveCombatStatusesByName,
    tickCombatStatuses,
} from '../api/combat-core/statuses.js';
import {
    COMBAT_RESOURCES_V2,
    v2JutsuResourceCost,
    v2PoisonOnSpend,
    v2ResourceRegen,
} from '../api/_combat-resources.js';
import {
    MAX_LEVEL,
    maxChakraForLevel,
    maxHpForLevel,
} from '../api/_xp-engine.js';

// ── Model constants ───────────────────────────────────────────────────────────
// Formula/turn/resource constants above are imported from their live owners.
const SIM_LEVEL         = MAX_LEVEL;
// Heal/Shield TAG values are imported from the canonical formula module.
// Note: the separate 'basicHeal' ACTION (60-AP built-in move) scales with
// maxHp at 10% — that's a different mechanic and stays as-is.
const WOUND_CAP_AB      = WOUND_CAP_BY_RANK.AB;
const HP_CAP            = maxHpForLevel(SIM_LEVEL);
const MAX_CHAKRA        = maxChakraForLevel(SIM_LEVEL);
const PLAYER_BLOODLINE_RANK = 'A Rank';
const A_RANK_BLOODLINE  = 1.15;
const A_RANK_FORMULA_TAG_CAP = ampTagCapForRank(PLAYER_BLOODLINE_RANK);
// The player creator offers A-rank authors 25% or 30%; its sanitizer owns the
// final clamp. This differs from the formula's defensive 35% A/B ceiling.
const A_RANK_CREATOR_TAG_PCT = 30;
const STANDARD_TAG_PCT  = 30;        // uncapped tags
// Best armor available in game data is Legendary, not Mythic. 5 armor slots
// have a Legendary piece (head/body/waist/legs/feet — hand has gloves which
// carry stat bonuses but no armorQuality). 5 × 0.07 = 0.35 raw DR.
const FULL_LEGENDARY_DR = 0.35;
// Each Legendary armor set grants ONE 1%-per-piece passive across all 6
// pieces. The hand (gloves) slot DOES carry the passive even without DR, so
// the full set yields 6% in exactly one category.
const SET_PASSIVE_PCT   = 6;
const BEST_WEAPON_EP    = 30;
const AP_PER_TURN       = 100;
const COST_UTILITY      = 40;
const COST_DAMAGE       = 60;
const COST_CLEANSE      = 60;
const COST_CLEAR        = 60;
const COST_WEAPON       = 40;
const CLEANSE_CD        = 10;
const CLEAR_CD          = 10;
const ABSOLUTE_SHIELD_CAP = 5_000;
// Wide diagnostic band for this sandbox. A faithful live-engine gate should use
// a tighter, telemetry-backed band; here we only refuse to call a large skew fair.
const FAIRNESS_DOMINANCE_LIMIT = 0.60;

// ── Types ─────────────────────────────────────────────────────────────────────
type TagName =
    | 'Heal' | 'Shield' | 'Barrier' | 'Pierce' | 'Stun' | 'Poison' | 'Drain'
    | 'Absorb' | 'Reflect' | 'Lifesteal'
    | 'Increase Damage Given' | 'Decrease Damage Given'
    | 'Increase Damage Taken' | 'Decrease Damage Taken'
    | 'Ignition' | 'Wound' | 'Recoil' | 'Increase Heal'
    | 'Bloodline Seal' | 'Elemental Seal'
    | 'Buff Prevent' | 'Debuff Prevent' | 'Cleanse Prevent' | 'Clear Prevent' | 'Stun Prevent'
    | 'Lag' | 'Overclock' | 'Copy' | 'Mirror' | 'Siphon';

type Tag = { name: TagName; percent?: number; amount?: number };

type Status = {
    name: TagName;
    rounds: number;
    activeRound?: number;
    inactiveRound?: number;
    percent?: number;
    amount?: number;
    kind: 'positive' | 'negative';
};

type Stats = {
    taijutsuOffense: number; taijutsuDefense: number;
    bukijutsuOffense: number; bukijutsuDefense: number;
    ninjutsuOffense: number; ninjutsuDefense: number;
    genjutsuOffense: number; genjutsuDefense: number;
    strength: number; speed: number; intelligence: number; willpower: number;
};

type JutsuType = 'Any' | 'Taijutsu' | 'Bukijutsu' | 'Ninjutsu' | 'Genjutsu';

export type Jutsu = {
    id: string;
    name: string;
    type: JutsuType;
    apCost: 40 | 60;
    effectPower: number;   // 0 for utility, 40 standard, 50 nuke
    chakraCost: number;
    cooldown: number;
    tags: Tag[];
};

export type Archetype = 'Standard-Meta' | 'DoT-Sustain' | 'Control-Lock' | 'Anti-Caster' | 'Tempo' | 'Disruption';
export const ARCHETYPES: readonly Archetype[] = ['Standard-Meta', 'DoT-Sustain', 'Control-Lock', 'Anti-Caster', 'Tempo', 'Disruption'];

export type Fighter = {
    name: string;
    archetype: Archetype;
    stats: Stats;
    hp: number; maxHp: number;
    chakra: number; maxChakra: number;
    shield: number;
    bloodlineMult: number;
    armorRawDR: number;
    itemDamagePct: number;
    itemAbsorbPct: number;
    itemReflectPct: number;
    itemLifeStealPct: number;
    statuses: Status[];
    cooldowns: Record<string, number>;
    jutsu: Jutsu[];
    weaponEp: number;
    weaponEffect?: TagName;
    weaponEffectValue?: number;
};

// ── Stat/status helpers ───────────────────────────────────────────────────────
const statFactor = statFactorFromComposites;

function activeStatuses(f: Fighter, round: number): Status[] {
    return activeCombatStatuses(f.statuses, round);
}
function hasStatus(f: Fighter, name: TagName, round: number): boolean {
    return hasCombatStatus(f.statuses, name, round);
}
function countActive(f: Fighter, name: TagName, round: number): number {
    return countActiveCombatStatuses(f.statuses, name, round);
}
function addStatus(
    f: Fighter,
    s: Status,
    round: number,
    stackable = STACKABLE_STATUS.has(s.name),
    bypassRecipientPrevention = false,
) {
    // Cancel by Buff Prevent / Debuff Prevent
    if (!bypassRecipientPrevention && s.kind === 'positive' && hasStatus(f, 'Buff Prevent', round)) return;
    if (!bypassRecipientPrevention && s.kind === 'negative' && hasStatus(f, 'Debuff Prevent', round)) return;
    // Stun blocked by Stun Prevent
    if (!bypassRecipientPrevention && s.name === 'Stun' && hasStatus(f, 'Stun Prevent', round)) return;
    // A copied/refreshed status authors a fresh lifecycle. In particular, Copy
    // and Mirror may snapshot a status that is active now but already scheduled
    // to yield next round; carrying that source `inactiveRound` forward would
    // retire the new copy at the exact moment it activates.
    const deferred = { ...s, activeRound: round + 1 };
    delete deferred.inactiveRound;
    f.statuses = addCombatStatus(f.statuses, deferred, {
        durationFor: statusDurationFor,
        isStackable: () => stackable,
        currentRound: round,
    });
    if (s.name === 'Wound') {
        f.statuses = capDeferredCombatStatusStacks(
            f.statuses,
            'Wound',
            MAX_WOUND_STACKS,
            round,
            round + 1,
        );
    }
}

function drContribution(attacker: Fighter, defender: Fighter, round: number): number {
    return drContributionFromStatuses(activeStatuses(attacker, round), activeStatuses(defender, round));
}
// All damage-amp tags (IDG attacker / IDT defender / Ignition defender) feed
// the same diminishing-returns pool — mirrors how DDG/DDT/armor feed the DR
// pool. Stack 1 is big, stack 4 is marginal, stacks share the pool across
// types so IDG + Ignition can't combo-multiply.
function ampMultiplier(attacker: Fighter, defender: Fighter, round: number): number {
    return ampMultiplierFromStatuses(activeStatuses(attacker, round), activeStatuses(defender, round));
}

// ── Damage application (formula-helper-backed model of applyJutsu) ────────────
export function applyJutsu(self: Fighter, opp: Fighter, jutsu: Jutsu, round: number, mastery = JUTSU_MAX_LEVEL): { dealt: number; healed: number } {
    const scaledEp = jutsu.effectPower === 0 ? 0 : jutsu.effectPower + mastery * 0.2;
    const off = getOffense(self.stats, jutsu.type);
    const def = getDefense(opp.stats, jutsu.type);
    const sf = statFactor(off, def);
    const blMult = bloodlineDamageMultiplier(self.bloodlineMult, hasStatus(self, 'Bloodline Seal', round));
    const itemDmgMult = itemDamageMultiplier(self.itemDamagePct);
    const baseDmg = Math.max(0, Math.floor(scaledEp * EP_MULTIPLIER * sf * blMult * itemDmgMult));

    const armorRawDR = Math.min(1.5, Math.max(0, opp.armorRawDR));
    const statusDR = drContribution(self, opp, round);
    const rawTotal = armorRawDR + statusDR;
    const effectiveDR = effectiveDrFromRaw(rawTotal);

    let damage = baseDmg;
    let pierce = false;
    let healing = 0;
    let shieldGain = 0;

    const healBoost = activeStatuses(self, round)
        .filter(s => s.name === 'Increase Heal')
        .reduce((m, s) => m * (1 + (s.percent ?? 0) / 100), 1);

    // Apply tag effects. Ordinary jutsu statuses activate next round, matching
    // statusForJutsu in the live resolver. Ground-zone exceptions are outside
    // this no-grid model.
    for (const tag of jutsu.tags) {
        const pct = Math.floor(scaledTagPercent(tag.percent ?? 0, mastery, tag.name, 'A', CAPPED_AMP_TAGS));
        switch (tag.name) {
            case 'Heal':                  healing += healAmountForMastery(mastery, healBoost); break;
            case 'Shield':                shieldGain += shieldAmountForMastery(mastery); break;
            case 'Pierce':                pierce = true; break;
            case 'Stun':                  addStatus(opp, { name: 'Stun', rounds: 1, kind: 'negative' }, round); break;
            case 'Poison':                addStatus(opp, { name: 'Poison', rounds: 2, percent: pct, kind: 'negative' }, round); break;
            case 'Drain': {
                const tick = drainTick(mastery);
                addStatus(opp, { name: 'Drain', rounds: 2, amount: tick, kind: 'negative' }, round);
                break;
            }
            case 'Absorb':                addStatus(self, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Reflect':               addStatus(self, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Lifesteal':             addStatus(self, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Increase Damage Given': addStatus(self, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Decrease Damage Given': addStatus(opp, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' }, round); break;
            case 'Increase Damage Taken': addStatus(opp, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' }, round); break;
            case 'Decrease Damage Taken': addStatus(self, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Ignition':              addStatus(opp, { name: 'Ignition', rounds: 2, percent: pct, kind: 'negative' }, round); break;
            case 'Increase Heal':         addStatus(self, { name: 'Increase Heal', rounds: 2, percent: pct, kind: 'positive' }, round); break;
            case 'Recoil':                addStatus(opp, { name: 'Recoil', rounds: 2, percent: pct, kind: 'negative' }, round); break;
            case 'Bloodline Seal':        addStatus(opp, { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }, round); break;
            case 'Elemental Seal':        addStatus(opp, { name: 'Elemental Seal', rounds: 1, kind: 'negative' }, round); break;
            case 'Debuff Prevent':        addStatus(self, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }, round); break;
            case 'Buff Prevent':          addStatus(opp, { name: 'Buff Prevent', rounds: 2, kind: 'negative' }, round); break;
            case 'Cleanse Prevent':       addStatus(opp, { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' }, round); break;
            case 'Clear Prevent':         addStatus(self, { name: 'Clear Prevent', rounds: 2, kind: 'positive' }, round); break;
            case 'Stun Prevent':          addStatus(self, { name: 'Stun Prevent', rounds: 2, kind: 'positive' }, round); break;
            case 'Lag':                   addStatus(opp, { name: 'Lag', rounds: 1, percent: pct, kind: 'negative' }, round); break;
            case 'Overclock':             addStatus(self, { name: 'Overclock', rounds: 1, percent: pct, kind: 'positive' }, round); break;
            case 'Mirror': {
                // Copy every active debuff for a fresh two-round window. The
                // originals remain; Debuff Prevent blocks the entire Mirror.
                if (hasStatus(opp, 'Debuff Prevent', round)) break;
                const toCopy = activeStatuses(self, round).filter(s => s.kind === 'negative');
                for (const t of toCopy) addStatus(opp, { ...t, rounds: 2 }, round, STACKABLE_STATUS.has(t.name), true);
                break;
            }
            case 'Copy': {
                // Copy active buffs except Absorb/Lifesteal for a fresh two-round
                // window. Buff Prevent blocks the entire Copy.
                if (hasStatus(self, 'Buff Prevent', round)) break;
                const stolen = activeStatuses(opp, round).filter(s => (
                    s.kind === 'positive' && !COPY_EXCLUDED_BUFFS.has(s.name)
                ));
                for (const t of stolen) addStatus(self, { ...t, rounds: 2 }, round, STACKABLE_STATUS.has(t.name), true);
                break;
            }
            case 'Siphon': break;  // handled post-damage above
        }
    }

    if (pierce) {
        damage = pierceTrueDamage(off, jutsu.apCost, mastery);
    } else {
        damage = Math.max(0, Math.floor(damage * (1 - effectiveDR) * ampMultiplier(self, opp, round)));
    }

    let dealtFinal = 0, healedFinal = healing;
    if (damage > 0) {
        const blocked = pierce ? 0 : Math.min(opp.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);
        // Pierce bypasses a shield; it must not silently destroy that shield for
        // the next attack. Ordinary hits consume exactly what the shield blocked.
        opp.shield = Math.max(0, opp.shield - blocked);
        opp.hp = Math.max(0, opp.hp - finalDmg);
        dealtFinal = finalDmg;

        // Wound DoT + Siphon (instant heal on hit damage)
        for (const tag of jutsu.tags) {
            if (tag.name === 'Wound') {
                const amt = cappedPostDamage(finalDmg, Math.min(tag.percent ?? WOUND_CAP_AB, WOUND_CAP_AB));
                addStatus(opp, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' }, round);
            }
            if (tag.name === 'Siphon') {
                const h = Math.floor(cappedPostDamage(finalDmg, tag.percent ?? A_RANK_FORMULA_TAG_CAP) * healBoost);
                self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h;
            }
        }

        // Reflect / Absorb (status-based, on defender)
        const reflectPct = activeStatuses(opp, round)
            .filter(status => status.name === 'Reflect')
            .reduce((sum, status) => sum + (status.percent ?? STANDARD_TAG_PCT), 0);
        if (reflectPct > 0 && !pierce) { const r = cappedPostDamage(finalDmg, reflectPct); self.hp = Math.max(0, self.hp - r); }
        const absorbPct = activeStatuses(opp, round)
            .filter(status => status.name === 'Absorb')
            .reduce((sum, status) => sum + (status.percent ?? STANDARD_TAG_PCT), 0);
        if (absorbPct > 0 && !pierce) { const ah = cappedPostDamage(finalDmg, absorbPct); opp.hp = Math.min(opp.maxHp, opp.hp + ah); }
        // Item passives
        if (!pierce) {
            if (opp.itemAbsorbPct > 0)    opp.hp = Math.min(opp.maxHp, opp.hp + cappedPostDamage(finalDmg, opp.itemAbsorbPct));
            if (opp.itemReflectPct > 0)   self.hp = Math.max(0, self.hp - cappedPostDamage(finalDmg, opp.itemReflectPct));
            if (self.itemLifeStealPct > 0) { const h = cappedPostDamage(finalDmg, self.itemLifeStealPct); self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h; }
        }
        // Lifesteal (status)
        const lifestealPct = activeStatuses(self, round)
            .filter(status => status.name === 'Lifesteal')
            .reduce((sum, status) => sum + (status.percent ?? STANDARD_TAG_PCT), 0);
        if (lifestealPct > 0 && finalDmg > 0) { const h = Math.floor(cappedPostDamage(finalDmg, lifestealPct) * healBoost); self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h; }
        // Recoil (attacker takes self damage from opponent's Recoil status)
        const recoil = activeStatuses(self, round).find(s => s.name === 'Recoil');
        if (recoil && finalDmg > 0) { const r = cappedPostDamage(finalDmg, recoil.percent ?? STANDARD_TAG_PCT); self.hp = Math.max(0, self.hp - r); }
    }

    if (healing > 0)   self.hp = Math.min(self.maxHp, self.hp + healing);
    if (shieldGain > 0) self.shield = Math.min(ABSOLUTE_SHIELD_CAP, self.maxHp, self.shield + shieldGain);

    return { dealt: dealtFinal, healed: healedFinal };
}

// ── DoT ticks ─────────────────────────────────────────────────────────────────
function applyDoTs(f: Fighter, round: number): number {
    let total = 0;
    const ownStatusDr = activeStatuses(f, round)
        .filter(status => status.name === 'Decrease Damage Taken')
        .reduce((sum, status) => sum + (status.percent ?? 0) / 100, 0);
    const mitigation = dotMitigationFromRawDr(f.armorRawDR, ownStatusDr);
    const mitigate = (raw: number) => Math.max(0, Math.floor(raw * mitigation));
    for (const s of activeStatuses(f, round)) {
        // Under combatResourcesV2 Poison reacts to jutsu spend in takeTurn;
        // only the legacy ruleset uses a passive max-chakra tick.
        if (s.name === 'Poison' && !COMBAT_RESOURCES_V2) { const d = mitigate(Math.floor(f.maxChakra * ((s.percent ?? 6) / 100))); f.hp = Math.max(0, f.hp - d); total += d; }
        else if (s.name === 'Drain') { const d = mitigate(s.amount ?? 50); f.hp = Math.max(0, f.hp - d); f.chakra = Math.max(0, f.chakra - d); total += d; }
        else if (s.name === 'Wound') { const d = mitigate(s.amount ?? 0); f.hp = Math.max(0, f.hp - d); total += d; }
    }
    return total;
}
function tickRoundStatuses(f: Fighter, round: number) {
    f.statuses = tickCombatStatuses(f.statuses, round);
}

function tickTurnCooldowns(f: Fighter) {
    for (const k of Object.keys(f.cooldowns)) {
        f.cooldowns[k] = Math.max(0, (f.cooldowns[k] ?? 0) - 1);
        if (f.cooldowns[k] === 0) delete f.cooldowns[k];
    }
}

// ── Player-level AI ───────────────────────────────────────────────────────────
type Action = { kind: 'jutsu'; jutsu: Jutsu } | { kind: 'cleanse' } | { kind: 'clear' } | { kind: 'basicHeal' } | { kind: 'pass' };

function effectiveActionApCost(self: Fighter, baseCost: number, round: number): number {
    const statuses = activeStatuses(self, round);
    return adjustedApCost(baseCost, {
        lagPct: statuses.find(status => status.name === 'Lag')?.percent,
        overclockPct: statuses.find(status => status.name === 'Overclock')?.percent,
    });
}

function pickAction(self: Fighter, opp: Fighter, apLeft: number, round: number): Action {
    const hpPct = self.hp / self.maxHp;
    const oppBuffStacks = activeStatuses(opp, round).filter(s => s.kind === 'positive').length;
    const copyableOppBuffStacks = activeStatuses(opp, round).filter(s => (
        s.kind === 'positive' && !COPY_EXCLUDED_BUFFS.has(s.name)
    )).length;
    const selfNegStacks = activeStatuses(self, round).filter(s => s.kind === 'negative').length;
    const selfIdgStacks = countActive(self, 'Increase Damage Given', round);
    const oppHasArmor = opp.armorRawDR + drContribution(self, opp, round) > 0.5;
    const oppHasShield = opp.shield > 0;
    const oppHasDoT = ['Wound', 'Poison', 'Drain'].some(n => hasStatus(opp, n as TagName, round));
    const canPayAp = (baseCost: number) => apLeft >= effectiveActionApCost(self, baseCost, round);

    // Universal high-priority responses
    // 1. Sustain layer — prefer jutsu Heal tag (750) over basicHeal (10% maxHp = 1000)
    //    when both available. basicHeal as fallback on long CD.
    if (hpPct < 0.40 && canPayAp(COST_UTILITY)) {
        const healJutsu = self.jutsu.find(j => j.apCost === 40 && j.tags.some(t => t.name === 'Heal') && (self.cooldowns[j.id] ?? 0) === 0 && self.chakra >= j.chakraCost);
        if (healJutsu) return { kind: 'jutsu', jutsu: healJutsu };
        // basicHeal: 60 AP, 10 chakra, 5-turn CD, heals 10% maxHp (= 1000 at 10K)
        if (canPayAp(60) && (self.cooldowns['basicHeal'] ?? 0) === 0 && self.chakra >= 10 && hpPct < 0.30) {
            return { kind: 'basicHeal' };
        }
    }
    // 2. Cleanse if buried in debuffs
    if (selfNegStacks >= 2 && canPayAp(COST_CLEANSE) && (self.cooldowns['cleanse'] ?? 0) === 0 && !hasStatus(self, 'Cleanse Prevent', round)) {
        return { kind: 'cleanse' };
    }
    // 3. Clear opponent buffs if they have many
    if (oppBuffStacks >= 2 && canPayAp(COST_CLEAR) && (self.cooldowns['clear'] ?? 0) === 0 && !hasStatus(opp, 'Clear Prevent', round)) {
        return { kind: 'clear' };
    }
    // 4. Pierce against shielded/armored target
    if (oppHasShield && canPayAp(COST_DAMAGE)) {
        const pierce = self.jutsu.find(j => j.apCost === 60 && j.tags.some(t => t.name === 'Pierce') && (self.cooldowns[j.id] ?? 0) === 0 && self.chakra >= j.chakraCost);
        if (pierce) return { kind: 'jutsu', jutsu: pierce };
    }

    // Score all available jutsu
    const options: Array<{ jutsu: Jutsu; score: number }> = [];
    for (const j of self.jutsu) {
        if ((self.cooldowns[j.id] ?? 0) > 0) continue;
        if (self.chakra < j.chakraCost) continue;
        if (!canPayAp(j.apCost)) continue;

        let score = 0;
        const hasPierceTag = j.tags.some(t => t.name === 'Pierce');
        const off = getOffense(self.stats, j.type);
        const def = getDefense(opp.stats, j.type);
        const sf = statFactor(off, def);
        const blockDR = effectiveDrFromRaw(opp.armorRawDR + drContribution(self, opp, round));

        // Damage estimate
        if (hasPierceTag) {
            score += pierceTrueDamage(off, j.apCost, JUTSU_MAX_LEVEL);
        } else if (j.effectPower > 0) {
            const scaledEp = j.effectPower + JUTSU_MAX_LEVEL * 0.2;
            score += Math.floor(scaledEp * EP_MULTIPLIER * sf
                * itemDamageMultiplier(self.itemDamagePct) * ampMultiplier(self, opp, round) * (1 - blockDR));
        }

        // Tag scoring
        for (const tag of j.tags) {
            switch (tag.name) {
                case 'Heal':                  score += hpPct < 0.50 ? 4000 : -3000; break;
                case 'Shield':                score += self.shield === 0 ? 800 : -800; break;
                case 'Pierce':                score += oppHasArmor ? 3000 : 1000; break;
                case 'Increase Damage Given': {
                    // Diminishing returns — 1st stack huge, 2nd modest, 3rd+ near-zero.
                    if (selfIdgStacks === 0) score += 2500;
                    else if (selfIdgStacks === 1) score += 700;
                    else score -= 300;
                    break;
                }
                case 'Decrease Damage Given': {
                    const cur = countActive(opp, 'Decrease Damage Given', round);
                    score += cur === 0 ? 1800 : cur === 1 ? 500 : -200;
                    break;
                }
                case 'Increase Damage Taken': {
                    const cur = countActive(opp, 'Increase Damage Taken', round);
                    if (cur === 0) score += 2200;
                    else if (cur === 1) score += 600;
                    else score -= 200;
                    break;
                }
                case 'Decrease Damage Taken': {
                    const cur = countActive(self, 'Decrease Damage Taken', round);
                    score += cur === 0 ? 1500 : cur === 1 ? 400 : -200;
                    break;
                }
                case 'Wound':                 score += oppHasDoT ? -300 : 1600; break;
                case 'Poison':                score += hasStatus(opp, 'Poison', round) ? -300 : 1200; break;
                case 'Drain':                 score += hasStatus(opp, 'Drain', round) ? -300 : 1400; break;
                case 'Stun':                  score += hasStatus(opp, 'Stun', round) ? -200 : 900; break;
                case 'Lifesteal':             score += hpPct < 0.60 ? 1500 : 400; break;
                case 'Absorb':                score += hpPct < 0.60 ? 1400 : 400; break;
                case 'Reflect':               score += oppHasShield ? -500 : 1000; break;
                case 'Ignition': {
                    const cur = countActive(opp, 'Ignition', round);
                    score += cur === 0 ? 1500 : cur === 1 ? 400 : -300;
                    break;
                }
                case 'Bloodline Seal':        score += hasStatus(opp, 'Bloodline Seal', round) ? -300 : 1300; break;
                case 'Buff Prevent':          score += oppBuffStacks <= 1 ? 1100 : 500; break;
                case 'Debuff Prevent':        score += selfNegStacks >= 1 ? 1300 : 700; break;
                case 'Increase Heal':         score += hpPct < 0.70 ? 800 : 200; break;
                case 'Lag':                   score += hasStatus(opp, 'Lag', round) ? -200 : 1000; break;
                case 'Overclock':             score += hasStatus(self, 'Overclock', round) ? -200 : 900; break;
                case 'Recoil':                score += hasStatus(opp, 'Recoil', round) ? -200 : 800; break;
                case 'Siphon':                score += 800; break;   // free heal on hit
                case 'Mirror':                score += hasStatus(opp, 'Debuff Prevent', round) ? -2000 : selfNegStacks >= 2 ? 1800 : -200; break;
                case 'Copy':                  score += hasStatus(self, 'Buff Prevent', round) ? -2000 : copyableOppBuffStacks >= 2 ? 1500 : -200; break;
                case 'Stun Prevent':          score += hasStatus(self, 'Stun Prevent', round) ? -200 : 700; break;
                case 'Cleanse Prevent':       score += hasStatus(opp, 'Cleanse Prevent', round) ? -200 : 800; break;
                case 'Clear Prevent':         score += hasStatus(self, 'Clear Prevent', round) ? -200 : 700; break;
                case 'Elemental Seal':        score += hasStatus(opp, 'Elemental Seal', round) ? -200 : 600; break;
            }
        }

        // Slight penalty for high chakra cost to discourage wasteful spam
        score -= Math.floor(j.chakraCost / 4);

        options.push({ jutsu: j, score });
    }

    // Weapon attack — 40 AP, no chakra, 5-turn CD (matches real top weapons).
    if (canPayAp(COST_WEAPON) && (self.cooldowns['weapon'] ?? 0) === 0) {
        const weapJ: Jutsu = {
            id: 'weapon', name: 'Weapon', type: 'Bukijutsu',
            apCost: 40, effectPower: self.weaponEp, chakraCost: 0, cooldown: 5,
            tags: self.weaponEffect ? [{ name: self.weaponEffect, percent: self.weaponEffectValue ?? STANDARD_TAG_PCT }] : [],
        };
        const off = getOffense(self.stats, 'Bukijutsu');
        const def = getDefense(opp.stats, 'Bukijutsu');
        const sf = statFactor(off, def);
        const blockDR = effectiveDrFromRaw(opp.armorRawDR + drContribution(self, opp, round));
        const scaledEp = self.weaponEp + JUTSU_MAX_LEVEL * 0.2;
        let wScore = Math.floor(scaledEp * EP_MULTIPLIER * sf * itemDamageMultiplier(self.itemDamagePct) * ampMultiplier(self, opp, round) * (1 - blockDR));
        // Weapon effect bonus (Reflect/Lifesteal/Absorb/Shield from blade)
        if (self.weaponEffect === 'Lifesteal' && hpPct < 0.70) wScore += 1000;
        if (self.weaponEffect === 'Reflect') wScore += 600;
        if (self.weaponEffect === 'Absorb' && hpPct < 0.70) wScore += 800;
        if (self.weaponEffect === 'Shield' && self.shield === 0) wScore += 500;
        options.push({ jutsu: weapJ, score: wScore });
    }

    if (!options.length) return { kind: 'pass' };
    options.sort((a, b) => b.score - a.score);
    return { kind: 'jutsu', jutsu: options[0]!.jutsu };
}

// ── Turn execution (AP-based) ─────────────────────────────────────────────────
export function takeTurn(self: Fighter, opp: Fighter, round: number): { dealt: number } {
    let totalDealt = 0;
    const stunned = hasStatus(self, 'Stun', round);
    let ap = stunned ? Math.max(0, AP_PER_TURN - STUN_AP_PENALTY) : AP_PER_TURN;

    // Live PvP consumes Stun when it establishes this turn's reduced AP budget.
    if (stunned) {
        self.statuses = removeActiveCombatStatusesByName(self.statuses, ['Stun'], round).statuses;
    }

    let actionsThisTurn = 0;
    while (ap > 0 && actionsThisTurn < MAX_ACTIONS && self.hp > 0 && opp.hp > 0) {
        const action = pickAction(self, opp, ap, round);
        if (action.kind === 'pass') break;
        const baseApCost = action.kind === 'jutsu' ? action.jutsu.apCost
            : action.kind === 'cleanse' ? COST_CLEANSE
                : action.kind === 'clear' ? COST_CLEAR
                    : 60;
        const spentAp = effectiveActionApCost(self, baseApCost, round);
        if (action.kind === 'cleanse') {
            self.statuses = removeActiveCombatStatusesByKind(self.statuses, 'negative', round).statuses;
            self.cooldowns['cleanse'] = CLEANSE_CD;
            ap -= spentAp;
        } else if (action.kind === 'clear') {
            opp.statuses = removeActiveCombatStatusesByKind(opp.statuses, 'positive', round).statuses;
            self.cooldowns['clear'] = CLEAR_CD;
            ap -= spentAp;
        } else if (action.kind === 'basicHeal') {
            self.hp = Math.min(self.maxHp, self.hp + Math.floor(self.maxHp * 0.10));
            self.chakra = Math.max(0, self.chakra - 10);
            self.cooldowns['basicHeal'] = 5;
            ap -= spentAp;
        } else {
            const j = action.jutsu;
            ap -= spentAp;
            if (j.cooldown > 0) self.cooldowns[j.id] = j.cooldown;
            const r = applyJutsu(self, opp, j, round);
            totalDealt += r.dealt;
            self.chakra = Math.max(0, self.chakra - j.chakraCost);
            if (COMBAT_RESOURCES_V2 && j.chakraCost > 0) {
                const poisonPct = activeStatuses(self, round)
                    .filter(status => status.name === 'Poison')
                    .reduce((sum, status) => sum + (status.percent ?? 6), 0);
                if (poisonPct > 0) {
                    self.hp = Math.max(0, self.hp - v2PoisonOnSpend(j.chakraCost, poisonPct));
                }
            }
        }
        actionsThisTurn++;
    }
    return { dealt: totalDealt };
}

// ── Single fight ──────────────────────────────────────────────────────────────
export type Seat = 'p1' | 'p2';
export type FightSummary = {
    winner: Seat | 'draw';
    opener: Seat;
    turns: number;
    p1Dealt: number;
    p2Dealt: number;
};

function normalizedEffectiveHealthParts(fighter: Pick<Fighter, 'hp' | 'maxHp' | 'shield'>): { effective: number; maxHp: number } {
    const maxHp = Math.max(1, Number(fighter.maxHp) || 0);
    const hp = Math.max(0, Math.min(Number(fighter.hp) || 0, maxHp));
    const shield = Math.max(0, Math.min(Number(fighter.shield) || 0, ABSOLUTE_SHIELD_CAP, maxHp));
    return { effective: hp + shield, maxHp };
}

export function simulateFight(p1: Fighter, p2: Fighter, opener: Seat = 'p1', maxTurns = MAX_ROUNDS): FightSummary {
    let p1Dealt = 0, p2Dealt = 0;
    let turn = 0;
    const order: readonly Seat[] = opener === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
    while (turn < maxTurns && p1.hp > 0 && p2.hp > 0) {
        turn++;
        for (const seat of order) {
            const self = seat === 'p1' ? p1 : p2;
            const opp = seat === 'p1' ? p2 : p1;
            if (self.hp <= 0 || opp.hp <= 0) break;

            const dotDamage = applyDoTs(self, turn);
            if (seat === 'p1') p2Dealt += dotDamage;
            else p1Dealt += dotDamage;
            if (COMBAT_RESOURCES_V2) {
                self.chakra = Math.min(self.maxChakra, self.chakra + v2ResourceRegen(SIM_LEVEL));
            }
            if (self.hp <= 0) break;

            const result = takeTurn(self, opp, turn);
            if (seat === 'p1') p1Dealt += result.dealt;
            else p2Dealt += result.dealt;

            // Cooldowns are per-fighter and age after that fighter acts.
            tickTurnCooldowns(self);
            if (self.hp <= 0 || opp.hp <= 0) break;
        }
        // Live PvP status durations are round properties: after the closer
        // finishes, both sides age once. This avoids modeling the old seat-biased
        // current-actor lifecycle that the authoritative engine no longer uses.
        if (p1.hp > 0 && p2.hp > 0) {
            tickRoundStatuses(p1, turn);
            tickRoundStatuses(p2, turn);
        }
    }
    let winner: 'p1' | 'p2' | 'draw';
    if (p1.hp <= 0 && p2.hp <= 0) winner = 'draw';
    else if (p1.hp <= 0) winner = 'p2';
    else if (p2.hp <= 0) winner = 'p1';
    else {
        // Match the authoritative timeout rule: compare bounded effective-health
        // ratios, not raw HP totals, using cross multiplication for exact ties.
        const p1Health = normalizedEffectiveHealthParts(p1);
        const p2Health = normalizedEffectiveHealthParts(p2);
        const comparison = p1Health.effective * p2Health.maxHp - p2Health.effective * p1Health.maxHp;
        winner = comparison > 0 ? 'p1' : comparison < 0 ? 'p2' : 'draw';
    }
    return { winner, opener, turns: turn, p1Dealt, p2Dealt };
}

// ── Builders ──────────────────────────────────────────────────────────────────
function maxedStats(): Stats {
    return {
        taijutsuOffense: MAX_STAT, taijutsuDefense: MAX_STAT,
        bukijutsuOffense: MAX_STAT, bukijutsuDefense: MAX_STAT,
        ninjutsuOffense: MAX_STAT, ninjutsuDefense: MAX_STAT,
        genjutsuOffense: MAX_STAT, genjutsuDefense: MAX_STAT,
        strength: MAX_STAT, speed: MAX_STAT, intelligence: MAX_STAT, willpower: MAX_STAT,
    };
}

/**
 * Project a simulator draft through the same boundary that seals player-authored
 * bloodline jutsu for live PvP, then adapt the normalized fields back to this
 * sandbox's compact shape. Keeping this exported makes creator legality and
 * idempotent live-schema round trips directly testable.
 */
export function sealAPlayerAuthoredLoadout(draft: readonly Jutsu[]): Jutsu[] {
    const normalized = normalizePlayerBloodlineJutsus(draft.map(jutsu => ({
        id: jutsu.id,
        name: jutsu.name,
        type: jutsu.type,
        element: 'None',
        ap: jutsu.apCost,
        range: 4,
        effectPower: jutsu.effectPower,
        cooldown: jutsu.cooldown,
        method: 'SINGLE',
        tags: jutsu.tags.map(tag => ({ name: tag.name, percent: tag.percent ?? 0 })),
    })), PLAYER_BLOODLINE_RANK);

    return normalized.map(jutsu => {
        const apCost = Number(jutsu.ap);
        if (apCost !== 40 && apCost !== 60) {
            throw new Error(`Live A-rank schema returned unsupported ${apCost}-AP jutsu ${String(jutsu.id)}.`);
        }
        const normalizedType = String(jutsu.type);
        if (!['Any', 'Taijutsu', 'Bukijutsu', 'Ninjutsu', 'Genjutsu'].includes(normalizedType)) {
            throw new Error(`Live A-rank schema returned unsupported jutsu type ${normalizedType}.`);
        }
        return {
            id: String(jutsu.id),
            name: String(jutsu.name),
            type: normalizedType as JutsuType,
            apCost,
            effectPower: Number(jutsu.effectPower) || 0,
            chakraCost: v2JutsuResourceCost(apCost, SIM_LEVEL),
            cooldown: Number(jutsu.cooldown) || 7,
            tags: jutsu.tags.map(tag => ({
                name: tag.name as TagName,
                percent: tag.percent,
            })),
        };
    });
}

// Rule-policy archetype drafts. Live sealing below, not these literals, owns
// player-content limits such as count, AP/tag compatibility, percentage choices,
// uniqueness, effect power, cooldown, target, and total bloodline points.
function loadoutFor(archetype: Archetype): { jutsu: Jutsu[]; weaponEffect: TagName; weaponEffectValue: number } {
    const T: JutsuType = 'Ninjutsu';
    const N = (n: string) => `${archetype}-${n}`;
    // Player-authored jutsu share the global 7-round cooldown. Five-jutsu kits
    // lean on weapon attacks (CD 5), basicHeal (CD 5), and cleanse/clear (CD 10)
    // while their authored techniques recover.
    const JUTSU_CD = 7;
    const damageCost = v2JutsuResourceCost(60, SIM_LEVEL);
    const utilityCost = v2JutsuResourceCost(40, SIM_LEVEL);
    const std    = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 40, chakraCost: damageCost, cooldown: JUTSU_CD, tags });
    const nuke   = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 50, chakraCost: damageCost, cooldown: JUTSU_CD, tags });
    const pierce = (id: string):              Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 40, chakraCost: damageCost, cooldown: JUTSU_CD, tags: [{ name: 'Pierce' }] });
    const util   = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 40, effectPower: 0,  chakraCost: utilityCost, cooldown: JUTSU_CD, tags });

    // Shorthand for percent values
    const C  = A_RANK_CREATOR_TAG_PCT;
    const S  = A_RANK_CREATOR_TAG_PCT;
    const W  = WOUND_CAP_AB;
    const V  = WEAPON_AMP_TAG_CAP;

    // Each five-jutsu draft is intentionally small enough for an A-rank
    // bloodline. The live normalizer remains authoritative and may clamp or
    // remove anything that violates creator rules or the ten-point budget.
    switch (archetype) {
        case 'Standard-Meta':
            // Balanced mix — damage variety + classic IDG/DDT setup tools.
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    nuke  ('Nuke+Wound',     [{ name: 'Wound',                 percent: W }]),
                    pierce('Pierce'),
                    std   ('Std+Ignition',   [{ name: 'Ignition',              percent: C }]),
                    util  ('IDG+Heal',       [{ name: 'Increase Damage Given', percent: C }, { name: 'Heal' }]),
                    util  ('DDT+Shield',     [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Shield' }]),
                ]),
                weaponEffect: 'Lifesteal', weaponEffectValue: V,
            };
        case 'DoT-Sustain':
            // Tick-heavy: Wound/Poison/Drain everywhere + sustain through ticks.
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    nuke  ('Nuke+Plague',    [{ name: 'Wound',  percent: W }]),
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    util  ('Lifesteal+Heal', [{ name: 'Lifesteal', percent: C }, { name: 'Heal' }]),
                    util  ('DDT+Shield',     [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Shield' }]),
                ]),
                weaponEffect: 'Lifesteal', weaponEffectValue: V,
            };
        case 'Control-Lock':
            // Heavy disruption plus enough sustain to survive its long CDs.
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    std   ('Std+Stun',       [{ name: 'Stun' }]),
                    std   ('Std+Lag',        [{ name: 'Lag', percent: S }]),
                    std   ('Std+Wound',      [{ name: 'Wound', percent: W }]),
                    util  ('IDT+Heal',       [{ name: 'Increase Damage Taken', percent: C }, { name: 'Heal' }]),
                    util  ('DDG+Shield',     [{ name: 'Decrease Damage Given', percent: C }, { name: 'Shield' }]),
                ]),
                weaponEffect: 'Absorb', weaponEffectValue: V,
            };
        case 'Anti-Caster':
            // Hard counter to control/burst. Reflect/Absorb + prevents.
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    nuke  ('Nuke+Wound',     [{ name: 'Wound', percent: W }]),
                    pierce('Pierce'),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),
                    util  ('Reflect+Heal',   [{ name: 'Reflect', percent: C }, { name: 'Heal' }]),
                    util  ('Absorb+Shield',  [{ name: 'Absorb', percent: C }, { name: 'Shield' }]),
                ]),
                weaponEffect: 'Reflect', weaponEffectValue: V,
            };
        case 'Tempo':
            // Action economy + amp stacking. Overclock for extra AP, Recoil
            // for passive damage, IDG/IDT/Ignition for amp stacks (DR-pooled).
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    nuke  ('Nuke+Ignite',    [{ name: 'Ignition', percent: C }]),
                    pierce('Pierce'),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),
                    util  ('Overclock+Lag',  [{ name: 'Overclock', percent: S }, { name: 'Lag', percent: S }]),
                    util  ('IDG+DDT',        [{ name: 'Increase Damage Given', percent: C }, { name: 'Decrease Damage Taken', percent: C }]),
                ]),
                weaponEffect: 'Lifesteal', weaponEffectValue: V,
            };
        case 'Disruption':
            // Status manipulation — Mirror copies debuffs, Copy steals buffs,
            // while Recoil and IDT/DDG keep pressure on the opponent.
            return {
                jutsu: sealAPlayerAuthoredLoadout([
                    pierce('Pierce'),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),
                    std   ('Std+Mirror',     [{ name: 'Mirror' }]),
                    std   ('Std+Copy',       [{ name: 'Copy' }]),
                    util  ('IDT+DDG',        [{ name: 'Increase Damage Taken', percent: C }, { name: 'Decrease Damage Given', percent: C }]),
                ]),
                weaponEffect: 'Lifesteal', weaponEffectValue: V,
            };
    }
}

// Each archetype picks a thematically-matched Legendary armor set (only one
// set's bonus applies — sets don't stack).
//   Void Sovereign  → +6% itemDamagePct      (offense-focused archetypes)
//   Eternal Bulwark → +6% itemAbsorbPct      (sustain-focused)
//   Crimson Tide    → +6% itemLifeStealPct   (DoT/sustain)
//   Mirror Soul     → +6% itemReflectPct     (counter)
function armorSetFor(archetype: Archetype): { dmg: number; absorb: number; reflect: number; lifesteal: number } {
    const base = { dmg: 0, absorb: 0, reflect: 0, lifesteal: 0 };
    switch (archetype) {
        case 'Standard-Meta':  return { ...base, dmg: SET_PASSIVE_PCT };      // Void Sovereign
        case 'Tempo':          return { ...base, dmg: SET_PASSIVE_PCT };      // Void Sovereign
        case 'Control-Lock':   return { ...base, dmg: SET_PASSIVE_PCT };      // Void Sovereign
        case 'DoT-Sustain':    return { ...base, lifesteal: SET_PASSIVE_PCT };// Crimson Tide
        case 'Anti-Caster':    return { ...base, reflect: SET_PASSIVE_PCT };  // Mirror Soul
        case 'Disruption':     return { ...base, absorb: SET_PASSIVE_PCT };   // Eternal Bulwark
    }
}

export function makeChampion(name: string, archetype: Archetype): Fighter {
    const loadout = loadoutFor(archetype);
    const set = armorSetFor(archetype);
    return {
        name, archetype, stats: maxedStats(),
        hp: HP_CAP, maxHp: HP_CAP,
        chakra: MAX_CHAKRA, maxChakra: MAX_CHAKRA,
        shield: 0,
        bloodlineMult: A_RANK_BLOODLINE,
        armorRawDR: FULL_LEGENDARY_DR,
        itemDamagePct:    set.dmg,
        itemAbsorbPct:    set.absorb,
        itemReflectPct:   set.reflect,
        itemLifeStealPct: set.lifesteal,
        statuses: [], cooldowns: {},
        jutsu: loadout.jutsu,
        weaponEp: BEST_WEAPON_EP,
        weaponEffect: loadout.weaponEffect,
        weaponEffectValue: loadout.weaponEffectValue,
    };
}

export function cloneFighter(f: Fighter): Fighter { return JSON.parse(JSON.stringify(f)); }

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — statFactor matrix
// ─────────────────────────────────────────────────────────────────────────────
function scenarioA() {
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('SCENARIO A — statFactor matrix for 6 stat archetypes (Ninjutsu)');
    console.log('═══════════════════════════════════════════════════════════════════════');
    const builds = [
        { name: 'Maxed',    fn: () => { const s = maxedStats(); return s; } },
        { name: 'Glass',    fn: () => { const s = maxedStats(); s.taijutsuDefense = s.bukijutsuDefense = s.ninjutsuDefense = s.genjutsuDefense = 0; return s; } },
        { name: 'Tank',     fn: () => { const s = maxedStats(); s.taijutsuOffense = s.bukijutsuOffense = s.ninjutsuOffense = s.genjutsuOffense = 0; return s; } },
        { name: 'Balanced', fn: () => { const s = maxedStats(); for (const k of Object.keys(s) as (keyof Stats)[]) (s as Record<string, number>)[k as string] = 1250; return s; } },
        { name: 'Spec-Off', fn: () => { const s = maxedStats(); s.taijutsuDefense = s.ninjutsuDefense = 1250; return s; } },
        { name: 'Spec-Def', fn: () => { const s = maxedStats(); s.taijutsuOffense = s.ninjutsuOffense = 1250; return s; } },
    ];
    const pad = (s: string, n: number) => s.padEnd(n);
    const padR = (s: string, n: number) => s.padStart(n);
    let header = pad('ATK \\ DEF', 12);
    for (const b of builds) header += padR(b.name, 10);
    console.log(header);
    for (const atk of builds) {
        let row = pad(atk.name, 12);
        for (const def of builds) {
            const sf = statFactor(getOffense(atk.fn(), 'Ninjutsu'), getDefense(def.fn(), 'Ninjutsu'));
            row += padR(sf.toFixed(2), 10);
        }
        console.log(row);
    }
    console.log('  Maxed vs Maxed = 1.00 (current behavior preserved at endgame).\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — sample damage values
// ─────────────────────────────────────────────────────────────────────────────
function scenarioB() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('SCENARIO B — sample damage at A-rank vs A-rank, both maxed, full Legendary');
    console.log('═══════════════════════════════════════════════════════════════════════');
    const atk = makeChampion('A', 'Standard-Meta');
    const def = makeChampion('B', 'Standard-Meta');
    const cases: Array<[string, Jutsu]> = [
        ['Standard 60-AP (EP 40, no tags)',       { id: 'd1', name: 'Std', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 50, cooldown: 0, tags: [] }],
        ['Nuke 60-AP (EP 50, no tags)',           { id: 'd2', name: 'Nuke', type: 'Ninjutsu', apCost: 60, effectPower: 50, chakraCost: 80, cooldown: 2, tags: [] }],
        ['Nuke + Wound 30%',                       { id: 'd3', name: 'NukeW', type: 'Ninjutsu', apCost: 60, effectPower: 50, chakraCost: 80, cooldown: 2, tags: [{ name: 'Wound', percent: 30 }] }],
        ['Pierce (capped 900)',                    { id: 'd4', name: 'Pierce', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 60, cooldown: 3, tags: [{ name: 'Pierce' }] }],
        ['Standard 60-AP w/ 4× IDG stacks (35% formula cap)', { id: 'd5', name: 'StdAmp', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 50, cooldown: 0, tags: [] }],
    ];
    console.log('Vs full Legendary armor (DR 0.35) + Void Sovereign set (+6% damage):\n');
    for (const [label, j] of cases) {
        const a = cloneFighter(atk); const d = cloneFighter(def);
        if (label.includes('IDG stacks')) {
            for (let i = 0; i < 4; i++) a.statuses.push({ name: 'Increase Damage Given', rounds: 2, percent: A_RANK_FORMULA_TAG_CAP, kind: 'positive' });
        }
        const r = applyJutsu(a, d, j, 1);
        console.log(`  ${label.padEnd(40)} → ${r.dealt.toString().padStart(5)} dmg`);
    }
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — crossed archetype tournament
// ─────────────────────────────────────────────────────────────────────────────
export type Tally = { wins: number; losses: number; draws: number; games: number };
export type FightRunner = (p1: Fighter, p2: Fighter, opener: Seat, maxTurns?: number) => FightSummary;
export type IntegrityIssueCode = 'SEAT_DOMINANCE' | 'OPENER_DOMINANCE' | 'TALLY_CONSERVATION' | 'MATCHUP_RECIPROCITY';
export type IntegrityIssue = { code: IntegrityIssueCode; message: string };
export type TournamentReport = {
    rosterSize: number;
    totalFights: number;
    drawCount: number;
    totalTurns: number;
    turnDistribution: Record<string, number>;
    entrants: Record<string, Tally>;
    archetypes: Record<Archetype, Tally>;
    matchups: Record<Archetype, Record<Archetype, Tally>>;
    seats: Record<Seat, Tally>;
    opener: Tally;
    integrityIssues: IntegrityIssue[];
};

function emptyTally(): Tally {
    return { wins: 0, losses: 0, draws: 0, games: 0 };
}

function recordPerspective(tally: Tally, outcome: 'win' | 'loss' | 'draw') {
    tally.games++;
    if (outcome === 'win') tally.wins++;
    else if (outcome === 'loss') tally.losses++;
    else tally.draws++;
}

export function scoredRate(tally: Tally): number {
    return tally.games > 0 ? (tally.wins + tally.draws * 0.5) / tally.games : 0.5;
}

function isDominantRate(rate: number): boolean {
    return rate >= FAIRNESS_DOMINANCE_LIMIT || rate <= 1 - FAIRNESS_DOMINANCE_LIMIT;
}

export function evaluateTournamentIntegrity(report: Omit<TournamentReport, 'integrityIssues'> | TournamentReport): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const p1Rate = scoredRate(report.seats.p1);
    const openerRate = scoredRate(report.opener);
    if (report.seats.p1.games > 0 && isDominantRate(p1Rate)) {
        issues.push({ code: 'SEAT_DOMINANCE', message: `P1 seat scored ${(p1Rate * 100).toFixed(1)}% (limit ${(FAIRNESS_DOMINANCE_LIMIT * 100).toFixed(0)}%).` });
    }
    if (report.opener.games > 0 && isDominantRate(openerRate)) {
        issues.push({ code: 'OPENER_DOMINANCE', message: `Initiative split: opener ${(openerRate * 100).toFixed(1)}%, closer ${((1 - openerRate) * 100).toFixed(1)}% (allowed band ${((1 - FAIRNESS_DOMINANCE_LIMIT) * 100).toFixed(0)}-${(FAIRNESS_DOMINANCE_LIMIT * 100).toFixed(0)}%).` });
    }

    const entrantTallies = Object.values(report.entrants);
    const entrantGames = entrantTallies.reduce((sum, tally) => sum + tally.games, 0);
    const entrantWins = entrantTallies.reduce((sum, tally) => sum + tally.wins, 0);
    const entrantLosses = entrantTallies.reduce((sum, tally) => sum + tally.losses, 0);
    const entrantDraws = entrantTallies.reduce((sum, tally) => sum + tally.draws, 0);
    if (entrantGames !== report.totalFights * 2
        || entrantWins !== entrantLosses
        || entrantWins !== report.totalFights - report.drawCount
        || entrantDraws !== report.drawCount * 2) {
        issues.push({ code: 'TALLY_CONSERVATION', message: 'Entrant W/L/D totals do not conserve fight outcomes.' });
    }

    for (const a of ARCHETYPES) {
        for (const b of ARCHETYPES) {
            if (a >= b) continue;
            const ab = report.matchups[a][b];
            const ba = report.matchups[b][a];
            if (ab.games !== ba.games || ab.wins !== ba.losses || ab.losses !== ba.wins || ab.draws !== ba.draws) {
                issues.push({ code: 'MATCHUP_RECIPROCITY', message: `${a}/${b} directional tallies are not reciprocal.` });
            }
        }
    }
    return issues;
}

export function makeTournamentRoster(size = 100): Fighter[] {
    return Array.from({ length: size }, (_, index) => {
        const archetype = ARCHETYPES[index % ARCHETYPES.length]!;
        return makeChampion(`F${index + 1}-${archetype}`, archetype);
    });
}

export function runTournament(
    roster: readonly Fighter[] = makeTournamentRoster(),
    fight: FightRunner = simulateFight,
): TournamentReport {
    const names = new Set(roster.map(fighter => fighter.name));
    if (names.size !== roster.length) throw new Error('Tournament fighter names must be unique.');

    const entrants = Object.fromEntries(roster.map(fighter => [fighter.name, emptyTally()])) as Record<string, Tally>;
    const archetypes = Object.fromEntries(ARCHETYPES.map(archetype => [archetype, emptyTally()])) as Record<Archetype, Tally>;
    const matchups = Object.fromEntries(ARCHETYPES.map(a => [
        a,
        Object.fromEntries(ARCHETYPES.map(b => [b, emptyTally()])),
    ])) as Record<Archetype, Record<Archetype, Tally>>;
    const seats: Record<Seat, Tally> = { p1: emptyTally(), p2: emptyTally() };
    const opener = emptyTally();
    const turnDistribution: Record<string, number> = { '1-5': 0, '6-10': 0, '11-15': 0, '16-20': 0, '21-25': 0 };
    let totalFights = 0;
    let totalTurns = 0;
    let drawCount = 0;

    const recordBout = (p1Index: number, p2Index: number, openingSeat: Seat) => {
        const p1Template = roster[p1Index]!;
        const p2Template = roster[p2Index]!;
        const result = fight(cloneFighter(p1Template), cloneFighter(p2Template), openingSeat, MAX_ROUNDS);
        totalFights++;
        totalTurns += result.turns;
        if (result.winner === 'draw') drawCount++;

        const outcomeForSeat = (seat: Seat): 'win' | 'loss' | 'draw' => result.winner === 'draw' ? 'draw' : result.winner === seat ? 'win' : 'loss';
        const p1Outcome = outcomeForSeat('p1');
        const p2Outcome = outcomeForSeat('p2');
        recordPerspective(seats.p1, p1Outcome);
        recordPerspective(seats.p2, p2Outcome);
        recordPerspective(opener, outcomeForSeat(openingSeat));
        recordPerspective(entrants[p1Template.name]!, p1Outcome);
        recordPerspective(entrants[p2Template.name]!, p2Outcome);
        recordPerspective(archetypes[p1Template.archetype], p1Outcome);
        recordPerspective(archetypes[p2Template.archetype], p2Outcome);
        recordPerspective(matchups[p1Template.archetype][p2Template.archetype], p1Outcome);
        recordPerspective(matchups[p2Template.archetype][p1Template.archetype], p2Outcome);

        if (result.turns <= 5) turnDistribution['1-5']++;
        else if (result.turns <= 10) turnDistribution['6-10']++;
        else if (result.turns <= 15) turnDistribution['11-15']++;
        else if (result.turns <= 20) turnDistribution['16-20']++;
        else turnDistribution['21-25']++;
    };

    // Four crossed bouts per unordered pair: both seat assignments × both
    // opening seats. This prevents roster order, seat, and opener from being
    // silently conflated in entrant/archetype rates.
    for (let i = 0; i < roster.length; i++) {
        for (let j = i + 1; j < roster.length; j++) {
            for (const [p1Index, p2Index] of [[i, j], [j, i]] as const) {
                recordBout(p1Index, p2Index, 'p1');
                recordBout(p1Index, p2Index, 'p2');
            }
        }
    }

    const base = {
        rosterSize: roster.length,
        totalFights,
        drawCount,
        totalTurns,
        turnDistribution,
        entrants,
        archetypes,
        matchups,
        seats,
        opener,
    };
    return { ...base, integrityIssues: evaluateTournamentIntegrity(base) };
}

function scenarioC() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('SCENARIO C — 100 fighters, max stats, A-rank bloodline, Legendary gear');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('  • Canonical EP/DR/amp/tag/resource helpers + 25-round cap');
    console.log('  • Level-100 V2 pool/cost/regen and exertion-based Poison');
    console.log('  • Five-jutsu A-rank drafts sealed by live count/AP/tag/percent/point rules');
    console.log('  • Full Legendary armor → armorRawDR = 0.35; one +6% set passive');
    console.log('  • Policy-conditioned diagnostic; every pair runs both seats × both openers');
    console.log('  • Limitations: no grid/range/targeting, consumable policy, human adaptation,');
    console.log('    ground zones, stamina-discipline loadouts, or stochastic decisions');
    console.log('  • Do not treat these deterministic-policy rates as live win forecasts\n');

    const started = Date.now();
    const report = runTournament();
    const elapsed = Date.now() - started;

    console.log(`Fights:          ${report.totalFights}`);
    console.log(`Draws (HP-tied): ${report.drawCount} (${(100 * report.drawCount / report.totalFights).toFixed(1)}%)`);
    console.log(`Avg turns:       ${(report.totalTurns / report.totalFights).toFixed(1)}`);
    console.log(`Runtime:         ${elapsed} ms\n`);

    console.log('Seat/opener diagnostics under this rule policy (draw = half-win):');
    console.log(`  P1 seat: ${formatPercent(scoredRate(report.seats.p1))}  W ${report.seats.p1.wins} L ${report.seats.p1.losses} D ${report.seats.p1.draws}`);
    console.log(`  P2 seat: ${formatPercent(scoredRate(report.seats.p2))}  W ${report.seats.p2.wins} L ${report.seats.p2.losses} D ${report.seats.p2.draws}`);
    console.log(`  Opener:  ${formatPercent(scoredRate(report.opener))}  W ${report.opener.wins} L ${report.opener.losses} D ${report.opener.draws}`);
    if (report.integrityIssues.length) {
        console.log('  ⚠ FAILED EVIDENCE CHECK:');
        for (const issue of report.integrityIssues) console.log(`    ${issue.code}: ${issue.message}`);
    } else {
        console.log('  ✓ No seat/opener dominance under this policy; tally integrity passed.');
    }

    console.log('\nTurn distribution:');
    for (const [bucket, count] of Object.entries(report.turnDistribution)) {
        const bar = '█'.repeat(Math.floor(60 * count / report.totalFights));
        console.log(`  ${bucket.padStart(6)}: ${String(count).padStart(5)} ${bar}`);
    }

    console.log('\nPolicy-conditioned scored rate by archetype:');
    for (const archetype of ARCHETYPES) {
        const tally = report.archetypes[archetype];
        const rate = scoredRate(tally);
        const bar = '█'.repeat(Math.floor(rate * 50));
        console.log(`  ${archetype.padEnd(13)} ${formatPercent(rate)}  W ${String(tally.wins).padStart(5)}  L ${String(tally.losses).padStart(5)}  D ${String(tally.draws).padStart(4)}  ${bar}`);
    }

    console.log('\nPolicy-conditioned matchup matrix (row archetype perspective):');
    const pad = (s: string, n: number) => s.padEnd(n);
    const padR = (s: string, n: number) => s.padStart(n);
    let header = pad('ROW \\ OPP', 14);
    for (const archetype of ARCHETYPES) header += padR(archetype, 13);
    console.log(header);
    for (const rowArchetype of ARCHETYPES) {
        let row = pad(rowArchetype, 14);
        for (const opponentArchetype of ARCHETYPES) {
            if (rowArchetype === opponentArchetype) {
                // A two-perspective mirror cell is 50% by conservation, not
                // evidence of opener fairness. The opener metric above owns it.
                row += padR('—', 13);
                continue;
            }
            const tally = report.matchups[rowArchetype][opponentArchetype];
            row += padR(`${(scoredRate(tally) * 100).toFixed(0)}% (${tally.games})`, 13);
        }
        console.log(row);
    }
    console.log('');
}

function formatPercent(rate: number): string {
    return `${(rate * 100).toFixed(1).padStart(5)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function main() {
    scenarioA();
    scenarioB();
    scenarioC();
}

const entry = process.argv[1] ? basename(process.argv[1]) : '';
if (/^pvp-formula-sim\.(?:ts|js|mts|mjs)$/.test(entry)) main();
