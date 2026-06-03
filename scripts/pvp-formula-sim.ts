/**
 * PvP formula simulator — exercises the v4.3+statFactor combat math from
 * api/pvp/move.ts under three scenarios:
 *
 *   A) statFactor matrix for archetypal stat builds (no combat — pure formula)
 *   B) Head-to-head damage breakdown between the same 6 builds
 *   C) 100-fighter tournament: every fighter at max stats, A-rank bloodline,
 *      6 Mythic armor, best weapon. 6 hand-designed archetype loadouts.
 *      Smart AI runs an AP-based turn (100 AP/turn, optimal 40+60 combo),
 *      uses Heal / Cleanse / Clear / IDG-stack / Pierce-vs-armor properly.
 *
 * Run: npx tsx scripts/pvp-formula-sim.ts
 */

// ── Constants (must match api/pvp/move.ts) ────────────────────────────────────
const MAX_STAT          = 2500;
// TEST: dropped from 40 → 32 to land round-1 standard jutsu in the 875-975
// damage band at A/B/S-rank bloodline. Real game value in move.ts is still 40.
const EP_MULTIPLIER     = 32;
const K_DR              = 0.5;
const K_AMP             = 0.5;       // NEW: diminishing-returns pool for IDG/IDT/Ignition
const AMP_EXP_CAP       = 4;         // kept as a safety floor — natural softcap from K_AMP does the work
// Heal/Shield TAG values (jutsu tags). Flat 750 at max jutsu mastery.
// Note: the separate 'basicHeal' ACTION (60-AP built-in move) scales with
// maxHp at 10% — that's a different mechanic and stays as-is.
const HEAL_FLAT         = 750;
const SHIELD_FLAT       = 750;
const DRAIN_BASE_TICK   = 50;
const DRAIN_PER_LEVEL   = 5;
const DRAIN_MAX_TICK    = 300;
const WOUND_CAP_AB      = 30;        // A/B rank cap
const HP_CAP            = 10000;
const MAX_CHAKRA        = 1000;
const JUTSU_MAX_LEVEL   = 50;
const A_RANK_BLOODLINE  = 1.15;
const A_RANK_TAG_PCT    = 35;        // capped damage tags at A-rank
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

type JutsuType = 'Taijutsu' | 'Bukijutsu' | 'Ninjutsu' | 'Genjutsu';

type Jutsu = {
    id: string;
    name: string;
    type: JutsuType;
    apCost: 40 | 60;
    effectPower: number;   // 0 for utility, 40 standard, 50 nuke
    chakraCost: number;
    cooldown: number;
    tags: Tag[];
};

type Archetype = 'Standard-Meta' | 'DoT-Sustain' | 'Control-Lock' | 'Anti-Caster' | 'Tempo' | 'Disruption';

type Fighter = {
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

// ── Stat helpers (match move.ts) ──────────────────────────────────────────────
function getOffense(s: Stats, type: JutsuType): number {
    if (type === 'Taijutsu')  return s.taijutsuOffense  + s.strength     + s.speed;
    if (type === 'Bukijutsu') return s.bukijutsuOffense + s.intelligence + s.strength;
    if (type === 'Genjutsu')  return s.genjutsuOffense  + s.intelligence + s.willpower;
    return s.ninjutsuOffense + s.willpower + s.speed;
}
function getDefense(s: Stats, type: JutsuType): number {
    if (type === 'Taijutsu')  return s.taijutsuDefense  + s.strength     + s.speed;
    if (type === 'Bukijutsu') return s.bukijutsuDefense + s.intelligence + s.strength;
    if (type === 'Genjutsu')  return s.genjutsuDefense  + s.intelligence + s.willpower;
    return s.ninjutsuDefense + s.willpower + s.speed;
}
function statFactor(off: number, def: number): number {
    return Math.max(0.35, Math.min(1.85, 1 + ((off - def) / (MAX_STAT * 2)) * 0.85));
}

// ── Status helpers ────────────────────────────────────────────────────────────
function hasStatus(f: Fighter, name: TagName): boolean { return f.statuses.some(s => s.name === name); }
function countActive(f: Fighter, name: TagName): number { return f.statuses.filter(s => s.name === name).length; }
function addStatus(f: Fighter, s: Status, stackable = false) {
    // Cancel by Buff Prevent / Debuff Prevent
    if (s.kind === 'positive' && hasStatus(f, 'Buff Prevent')) return;
    if (s.kind === 'negative' && hasStatus(f, 'Debuff Prevent')) return;
    // Stun blocked by Stun Prevent
    if (s.name === 'Stun' && hasStatus(f, 'Stun Prevent')) return;
    if (stackable) f.statuses = [...f.statuses, s];
    else f.statuses = [...f.statuses.filter(x => x.name !== s.name), s];
}

function drContribution(attacker: Fighter, defender: Fighter): number {
    let dr = 0;
    for (const s of attacker.statuses) if (s.name === 'Decrease Damage Given') dr += (s.percent ?? 0) / 100;
    for (const s of defender.statuses) if (s.name === 'Decrease Damage Taken') dr += (s.percent ?? 0) / 100;
    return dr;
}
// All damage-amp tags (IDG attacker / IDT defender / Ignition defender) feed
// the same diminishing-returns pool — mirrors how DDG/DDT/armor feed the DR
// pool. Stack 1 is big, stack 4 is marginal, stacks share the pool across
// types so IDG + Ignition can't combo-multiply.
function ampMultiplier(attacker: Fighter, defender: Fighter): number {
    let rawAmp = 0;
    for (const s of attacker.statuses) {
        if (s.name === 'Increase Damage Given') rawAmp += (s.percent ?? 0) / 100;
    }
    for (const s of defender.statuses) {
        if (s.name === 'Increase Damage Taken') rawAmp += (s.percent ?? 0) / 100;
        if (s.name === 'Ignition')              rawAmp += (s.percent ?? 0) / 100;
    }
    if (rawAmp <= 0) return 1;
    const effectiveAmp = rawAmp / (rawAmp + K_AMP);
    return 1 + effectiveAmp;
}
function cappedPostDamage(damage: number, percent: number): number {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}
function pierceTrueDamage(offense: number, mastery: number): number {
    const masteryFactor = 1 + Math.max(0, Math.min(50, mastery)) * 0.005;
    return Math.floor(Math.max(100, Math.min(900, offense * 0.35 * 1.0 * masteryFactor)));
}

// ── Damage application (ports applyJutsu from move.ts) ────────────────────────
function applyJutsu(self: Fighter, opp: Fighter, jutsu: Jutsu, mastery = JUTSU_MAX_LEVEL): { dealt: number; healed: number } {
    const scaledEp = jutsu.effectPower === 0 ? 0 : jutsu.effectPower + mastery * 0.2;
    const off = getOffense(self.stats, jutsu.type);
    const def = getDefense(opp.stats, jutsu.type);
    const sf = statFactor(off, def);
    const blMult = (hasStatus(self, 'Bloodline Seal')) ? 1.0 : Math.max(1, self.bloodlineMult);
    const itemDmgMult = 1 + Math.max(0, self.itemDamagePct) / 100;
    const baseDmg = Math.max(0, Math.floor(scaledEp * EP_MULTIPLIER * sf * blMult * itemDmgMult));

    const armorRawDR = Math.min(1.5, Math.max(0, opp.armorRawDR));
    const statusDR = drContribution(self, opp);
    const rawTotal = armorRawDR + statusDR;
    const effectiveDR = rawTotal > 0 ? rawTotal / (rawTotal + K_DR) : 0;

    let damage = baseDmg;
    let pierce = false;
    let healing = 0;
    let shieldGain = 0;

    const healBoost = self.statuses
        .filter(s => s.name === 'Increase Heal')
        .reduce((m, s) => m * (1 + (s.percent ?? 0) / 100), 1);

    // Apply tag effects
    for (const tag of jutsu.tags) {
        const pct = Math.floor(Math.max(0, (tag.percent ?? STANDARD_TAG_PCT) - (JUTSU_MAX_LEVEL - mastery) * 0.2));
        switch (tag.name) {
            case 'Heal':                  healing += Math.floor(HEAL_FLAT * healBoost); damage = 0; break;
            case 'Shield':                shieldGain += SHIELD_FLAT; damage = 0; break;
            case 'Pierce':                pierce = true; break;
            case 'Stun':                  addStatus(opp, { name: 'Stun', rounds: 1, kind: 'negative' }); break;
            case 'Poison':                addStatus(opp, { name: 'Poison', rounds: 2, percent: pct, kind: 'negative' }); break;
            case 'Drain': {
                const tick = Math.max(DRAIN_BASE_TICK, Math.min(DRAIN_MAX_TICK, DRAIN_BASE_TICK + mastery * DRAIN_PER_LEVEL));
                addStatus(opp, { name: 'Drain', rounds: 2, amount: tick, kind: 'negative' });
                break;
            }
            case 'Absorb':                addStatus(self, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }); break;
            case 'Reflect':               addStatus(self, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }); break;
            case 'Lifesteal':             addStatus(self, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }); break;
            case 'Increase Damage Given': addStatus(self, { name: 'Increase Damage Given', rounds: 4, percent: pct, kind: 'positive' }, true); break;
            case 'Decrease Damage Given': addStatus(opp, { name: 'Decrease Damage Given', rounds: 4, percent: pct, kind: 'negative' }, true); break;
            case 'Increase Damage Taken': addStatus(opp, { name: 'Increase Damage Taken', rounds: 4, percent: pct, kind: 'negative' }, true); break;
            case 'Decrease Damage Taken': addStatus(self, { name: 'Decrease Damage Taken', rounds: 4, percent: pct, kind: 'positive' }, true); break;
            case 'Ignition':              addStatus(opp, { name: 'Ignition', rounds: 2, percent: pct, kind: 'negative' }, true); break;
            case 'Increase Heal':         addStatus(self, { name: 'Increase Heal', rounds: 2, percent: pct, kind: 'positive' }); break;
            case 'Recoil':                addStatus(opp, { name: 'Recoil', rounds: 2, percent: pct, kind: 'negative' }); break;
            case 'Bloodline Seal':        addStatus(opp, { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }); break;
            case 'Elemental Seal':        addStatus(opp, { name: 'Elemental Seal', rounds: 1, kind: 'negative' }); break;
            case 'Debuff Prevent':        addStatus(self, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }); break;
            case 'Buff Prevent':          addStatus(opp, { name: 'Buff Prevent', rounds: 2, kind: 'negative' }); break;
            case 'Cleanse Prevent':       addStatus(opp, { name: 'Cleanse Prevent', rounds: 2, kind: 'negative' }); break;
            case 'Clear Prevent':         addStatus(self, { name: 'Clear Prevent', rounds: 2, kind: 'positive' }); break;
            case 'Stun Prevent':          addStatus(self, { name: 'Stun Prevent', rounds: 2, kind: 'positive' }); break;
            case 'Lag':                   addStatus(opp, { name: 'Lag', rounds: 1, percent: pct, kind: 'negative' }); break;
            case 'Overclock':             addStatus(self, { name: 'Overclock', rounds: 1, percent: pct, kind: 'positive' }); break;
            case 'Mirror': {
                // COPY self's non-DoT negative effects to opponent — they
                // remain on self too. No longer a free cleanse, just a
                // "spread the debuff pain" tool.
                if (hasStatus(opp, 'Debuff Prevent')) break;
                const toCopy = self.statuses.filter(s => s.kind === 'negative'
                    && !['Wound', 'Poison', 'Drain', 'Ignition'].includes(s.name));
                for (const t of toCopy) addStatus(opp, { ...t });
                break;
            }
            case 'Copy': {
                // Steal opponent's active positive effects.
                const stolen = opp.statuses.filter(s => s.kind === 'positive');
                for (const t of stolen) addStatus(self, { ...t });
                break;
            }
            case 'Siphon': break;  // handled post-damage above
        }
    }

    if (pierce) {
        damage = pierceTrueDamage(off, mastery);
    } else {
        damage = Math.max(0, Math.floor(damage * (1 - effectiveDR) * ampMultiplier(self, opp)));
    }

    let dealtFinal = 0, healedFinal = healing;
    if (damage > 0) {
        const blocked = pierce ? 0 : Math.min(opp.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);
        opp.shield = Math.max(0, opp.shield - damage);
        opp.hp = Math.max(0, opp.hp - finalDmg);
        dealtFinal = finalDmg;

        // Wound DoT + Siphon (instant heal on hit damage)
        for (const tag of jutsu.tags) {
            if (tag.name === 'Wound') {
                const amt = cappedPostDamage(finalDmg, Math.min(tag.percent ?? WOUND_CAP_AB, WOUND_CAP_AB));
                addStatus(opp, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' });
            }
            if (tag.name === 'Siphon') {
                const h = Math.floor(cappedPostDamage(finalDmg, tag.percent ?? A_RANK_TAG_PCT) * healBoost);
                self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h;
            }
        }

        // Reflect / Absorb (status-based, on defender)
        const reflect = opp.statuses.find(s => s.name === 'Reflect');
        if (reflect && !pierce) { const r = cappedPostDamage(finalDmg, reflect.percent ?? STANDARD_TAG_PCT); self.hp = Math.max(0, self.hp - r); }
        const absorb = opp.statuses.find(s => s.name === 'Absorb');
        if (absorb && !pierce) { const ah = cappedPostDamage(finalDmg, absorb.percent ?? STANDARD_TAG_PCT); opp.hp = Math.min(opp.maxHp, opp.hp + ah); }
        // Item passives
        if (!pierce) {
            if (opp.itemAbsorbPct > 0)    opp.hp = Math.min(opp.maxHp, opp.hp + cappedPostDamage(finalDmg, opp.itemAbsorbPct));
            if (opp.itemReflectPct > 0)   self.hp = Math.max(0, self.hp - cappedPostDamage(finalDmg, opp.itemReflectPct));
            if (self.itemLifeStealPct > 0) { const h = cappedPostDamage(finalDmg, self.itemLifeStealPct); self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h; }
        }
        // Lifesteal (status)
        const ls = self.statuses.find(s => s.name === 'Lifesteal');
        if (ls && finalDmg > 0) { const h = Math.floor(cappedPostDamage(finalDmg, ls.percent ?? STANDARD_TAG_PCT) * healBoost); self.hp = Math.min(self.maxHp, self.hp + h); healedFinal += h; }
        // Recoil (attacker takes self damage from opponent's Recoil status)
        const recoil = self.statuses.find(s => s.name === 'Recoil');
        if (recoil && finalDmg > 0) { const r = cappedPostDamage(finalDmg, recoil.percent ?? STANDARD_TAG_PCT); self.hp = Math.max(0, self.hp - r); }
    }

    if (healing > 0)   self.hp = Math.min(self.maxHp, self.hp + healing);
    if (shieldGain > 0) self.shield = Math.min(5000, self.shield + shieldGain);

    return { dealt: dealtFinal, healed: healedFinal };
}

// ── DoT ticks ─────────────────────────────────────────────────────────────────
function applyDoTs(f: Fighter): number {
    let total = 0;
    for (const s of f.statuses) {
        if (s.name === 'Poison') { const d = Math.floor(f.maxChakra * ((s.percent ?? 6) / 100)); f.hp = Math.max(0, f.hp - d); total += d; }
        else if (s.name === 'Drain') { const d = s.amount ?? 50; f.hp = Math.max(0, f.hp - d); f.chakra = Math.max(0, f.chakra - d); total += d; }
        else if (s.name === 'Wound') { const d = s.amount ?? 0; f.hp = Math.max(0, f.hp - d); total += d; }
    }
    return total;
}
function tickStatuses(f: Fighter) {
    f.statuses = f.statuses.map(s => ({ ...s, rounds: s.rounds - 1 })).filter(s => s.rounds > 0);
    for (const k of Object.keys(f.cooldowns)) {
        f.cooldowns[k] = Math.max(0, (f.cooldowns[k] ?? 0) - 1);
        if (f.cooldowns[k] === 0) delete f.cooldowns[k];
    }
}

// ── Player-level AI ───────────────────────────────────────────────────────────
type Action = { kind: 'jutsu'; jutsu: Jutsu } | { kind: 'cleanse' } | { kind: 'clear' } | { kind: 'basicHeal' } | { kind: 'pass' };

function pickAction(self: Fighter, opp: Fighter, apLeft: number): Action {
    const hpPct = self.hp / self.maxHp;
    const oppHpPct = opp.hp / opp.maxHp;
    const oppNegStacks = opp.statuses.filter(s => s.kind === 'positive').length;
    const selfNegStacks = self.statuses.filter(s => s.kind === 'negative').length;
    const selfIdgStacks = countActive(self, 'Increase Damage Given');
    const oppHasArmor = opp.armorRawDR + drContribution(self, opp) > 0.5;
    const oppHasShield = opp.shield > 0;
    const oppHasDoT = ['Wound', 'Poison', 'Drain'].some(n => hasStatus(opp, n as TagName));

    // Universal high-priority responses
    // 1. Sustain layer — prefer jutsu Heal tag (750) over basicHeal (10% maxHp = 1000)
    //    when both available. basicHeal as fallback on long CD.
    if (hpPct < 0.40 && apLeft >= COST_UTILITY) {
        const healJutsu = self.jutsu.find(j => j.apCost === 40 && j.tags.some(t => t.name === 'Heal') && (self.cooldowns[j.id] ?? 0) === 0 && self.chakra >= j.chakraCost);
        if (healJutsu) return { kind: 'jutsu', jutsu: healJutsu };
        // basicHeal: 60 AP, 10 chakra, 5-turn CD, heals 10% maxHp (= 1000 at 10K)
        if (apLeft >= 60 && (self.cooldowns['basicHeal'] ?? 0) === 0 && self.chakra >= 10 && hpPct < 0.30) {
            return { kind: 'basicHeal' };
        }
    }
    // 2. Cleanse if buried in debuffs
    if (selfNegStacks >= 2 && apLeft >= COST_CLEANSE && (self.cooldowns['cleanse'] ?? 0) === 0 && !hasStatus(self, 'Cleanse Prevent')) {
        return { kind: 'cleanse' };
    }
    // 3. Clear opponent buffs if they have many
    if (oppNegStacks >= 2 && apLeft >= COST_CLEAR && (self.cooldowns['clear'] ?? 0) === 0 && !hasStatus(opp, 'Clear Prevent')) {
        return { kind: 'clear' };
    }
    // 4. Pierce against shielded/armored target
    if (oppHasShield && apLeft >= COST_DAMAGE) {
        const pierce = self.jutsu.find(j => j.apCost === 60 && j.tags.some(t => t.name === 'Pierce') && (self.cooldowns[j.id] ?? 0) === 0 && self.chakra >= j.chakraCost);
        if (pierce) return { kind: 'jutsu', jutsu: pierce };
    }

    // Score all available jutsu
    const options: Array<{ jutsu: Jutsu; score: number }> = [];
    for (const j of self.jutsu) {
        if ((self.cooldowns[j.id] ?? 0) > 0) continue;
        if (self.chakra < j.chakraCost) continue;
        if (apLeft < j.apCost) continue;

        let score = 0;
        const hasPierceTag = j.tags.some(t => t.name === 'Pierce');
        const off = getOffense(self.stats, j.type);
        const def = getDefense(opp.stats, j.type);
        const sf = statFactor(off, def);
        const blockDR = Math.min(0.9, (opp.armorRawDR + drContribution(self, opp)) / ((opp.armorRawDR + drContribution(self, opp)) + K_DR));

        // Damage estimate
        if (hasPierceTag) {
            score += pierceTrueDamage(off, JUTSU_MAX_LEVEL);
        } else if (j.effectPower > 0) {
            const scaledEp = j.effectPower + JUTSU_MAX_LEVEL * 0.2;
            score += Math.floor(scaledEp * EP_MULTIPLIER * sf
                * (1 + self.itemDamagePct / 100) * ampMultiplier(self, opp) * (1 - blockDR));
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
                    const cur = countActive(opp, 'Decrease Damage Given');
                    score += cur === 0 ? 1800 : cur === 1 ? 500 : -200;
                    break;
                }
                case 'Increase Damage Taken': {
                    const cur = countActive(opp, 'Increase Damage Taken');
                    if (cur === 0) score += 2200;
                    else if (cur === 1) score += 600;
                    else score -= 200;
                    break;
                }
                case 'Decrease Damage Taken': {
                    const cur = countActive(self, 'Decrease Damage Taken');
                    score += cur === 0 ? 1500 : cur === 1 ? 400 : -200;
                    break;
                }
                case 'Wound':                 score += oppHasDoT ? -300 : 1600; break;
                case 'Poison':                score += hasStatus(opp, 'Poison') ? -300 : 1200; break;
                case 'Drain':                 score += hasStatus(opp, 'Drain') ? -300 : 1400; break;
                case 'Stun':                  score += hasStatus(opp, 'Stun') ? -200 : 900; break;
                case 'Lifesteal':             score += hpPct < 0.60 ? 1500 : 400; break;
                case 'Absorb':                score += hpPct < 0.60 ? 1400 : 400; break;
                case 'Reflect':               score += oppHasShield ? -500 : 1000; break;
                case 'Ignition': {
                    const cur = countActive(opp, 'Ignition');
                    score += cur === 0 ? 1500 : cur === 1 ? 400 : -300;
                    break;
                }
                case 'Bloodline Seal':        score += hasStatus(opp, 'Bloodline Seal') ? -300 : 1300; break;
                case 'Buff Prevent':          score += oppNegStacks <= 1 ? 1100 : 500; break;
                case 'Debuff Prevent':        score += selfNegStacks >= 1 ? 1300 : 700; break;
                case 'Increase Heal':         score += hpPct < 0.70 ? 800 : 200; break;
                case 'Lag':                   score += hasStatus(opp, 'Lag') ? -200 : 1000; break;
                case 'Overclock':             score += hasStatus(self, 'Overclock') ? -200 : 900; break;
                case 'Recoil':                score += hasStatus(opp, 'Recoil') ? -200 : 800; break;
                case 'Siphon':                score += 800; break;   // free heal on hit
                case 'Mirror':                score += selfNegStacks >= 2 ? 1800 : -200; break;
                case 'Copy':                  score += oppNegStacks >= 2 ? 1500 : -200; break;
                case 'Stun Prevent':          score += hasStatus(self, 'Stun Prevent') ? -200 : 700; break;
                case 'Cleanse Prevent':       score += hasStatus(opp, 'Cleanse Prevent') ? -200 : 800; break;
                case 'Clear Prevent':         score += hasStatus(self, 'Clear Prevent') ? -200 : 700; break;
                case 'Elemental Seal':        score += hasStatus(opp, 'Elemental Seal') ? -200 : 600; break;
            }
        }

        // Slight penalty for high chakra cost to discourage wasteful spam
        score -= Math.floor(j.chakraCost / 4);

        options.push({ jutsu: j, score });
    }

    // Weapon attack — 40 AP, no chakra, 5-turn CD (matches real top weapons).
    if (apLeft >= COST_WEAPON && (self.cooldowns['weapon'] ?? 0) === 0) {
        const weapJ: Jutsu = {
            id: 'weapon', name: 'Weapon', type: 'Bukijutsu',
            apCost: 40, effectPower: self.weaponEp, chakraCost: 0, cooldown: 5,
            tags: self.weaponEffect ? [{ name: self.weaponEffect, percent: self.weaponEffectValue ?? STANDARD_TAG_PCT }] : [],
        };
        const off = getOffense(self.stats, 'Bukijutsu');
        const def = getDefense(opp.stats, 'Bukijutsu');
        const sf = statFactor(off, def);
        const blockDR = Math.min(0.9, (opp.armorRawDR + drContribution(self, opp)) / ((opp.armorRawDR + drContribution(self, opp)) + K_DR));
        const scaledEp = self.weaponEp + JUTSU_MAX_LEVEL * 0.2;
        let wScore = Math.floor(scaledEp * EP_MULTIPLIER * sf * (1 + self.itemDamagePct / 100) * ampMultiplier(self, opp) * (1 - blockDR));
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
function takeTurn(self: Fighter, opp: Fighter): { dealt: number } {
    let totalDealt = 0;
    let ap = AP_PER_TURN;

    // Stun penalty
    if (hasStatus(self, 'Stun')) ap -= 40;
    // Lag: AP costs go up (we model as direct AP reduction for simplicity)
    if (hasStatus(self, 'Lag')) ap = Math.floor(ap * (1 - (self.statuses.find(s => s.name === 'Lag')?.percent ?? 20) / 100));
    // Overclock: AP costs go down
    if (hasStatus(self, 'Overclock')) ap = Math.floor(ap * (1 + (self.statuses.find(s => s.name === 'Overclock')?.percent ?? 20) / 100));

    let actionsThisTurn = 0;
    while (ap >= COST_UTILITY && actionsThisTurn < 3 && self.hp > 0 && opp.hp > 0) {
        const action = pickAction(self, opp, ap);
        if (action.kind === 'pass') break;
        if (action.kind === 'cleanse') {
            self.statuses = self.statuses.filter(s => s.kind !== 'negative');
            self.cooldowns['cleanse'] = CLEANSE_CD;
            ap -= COST_CLEANSE;
        } else if (action.kind === 'clear') {
            opp.statuses = opp.statuses.filter(s => s.kind !== 'positive');
            self.cooldowns['clear'] = CLEAR_CD;
            ap -= COST_CLEAR;
        } else if (action.kind === 'basicHeal') {
            self.hp = Math.min(self.maxHp, self.hp + Math.floor(self.maxHp * 0.10));
            self.chakra = Math.max(0, self.chakra - 10);
            self.cooldowns['basicHeal'] = 5;
            ap -= 60;
        } else {
            const j = action.jutsu;
            ap -= j.apCost;
            self.chakra = Math.max(0, self.chakra - j.chakraCost);
            if (j.cooldown > 0) self.cooldowns[j.id] = j.cooldown;
            const r = applyJutsu(self, opp, j);
            totalDealt += r.dealt;
        }
        actionsThisTurn++;
    }
    return { dealt: totalDealt };
}

// ── Single fight ──────────────────────────────────────────────────────────────
type FightSummary = { winner: 'p1' | 'p2' | 'draw'; turns: number; p1Dealt: number; p2Dealt: number };

function simulateFight(p1: Fighter, p2: Fighter, maxTurns = 60): FightSummary {
    let p1Dealt = 0, p2Dealt = 0;
    let turn = 0;
    while (turn < maxTurns && p1.hp > 0 && p2.hp > 0) {
        turn++;
        // P1 turn
        p2Dealt += applyDoTs(p1);
        if (p1.hp <= 0) break;
        const r1 = takeTurn(p1, p2);
        p1Dealt += r1.dealt;
        if (p2.hp <= 0) break;

        // P2 turn
        p1Dealt += applyDoTs(p2);
        if (p2.hp <= 0) break;
        const r2 = takeTurn(p2, p1);
        p2Dealt += r2.dealt;

        // End-of-round upkeep
        tickStatuses(p1); tickStatuses(p2);
        p1.chakra = Math.min(p1.maxChakra, p1.chakra + 75);
        p2.chakra = Math.min(p2.maxChakra, p2.chakra + 75);
    }
    const winner: 'p1' | 'p2' | 'draw' =
        p1.hp <= 0 && p2.hp <= 0 ? 'draw' :
        p1.hp <= 0 ? 'p2' :
        p2.hp <= 0 ? 'p1' :
        p1.hp > p2.hp ? 'p1' : p2.hp > p1.hp ? 'p2' : 'draw';
    return { winner, turns: turn, p1Dealt, p2Dealt };
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

// Smart archetype loadouts — each carefully built like a real PvP player would.
function loadoutFor(archetype: Archetype): { jutsu: Jutsu[]; weaponEffect: TagName; weaponEffectValue: number } {
    const T: JutsuType = 'Ninjutsu';
    const N = (n: string) => `${archetype}-${n}`;
    // All jutsu share the global 7-round cooldown. With 15 jutsu and 2 actions
    // per turn, players cycle through their full kit each 7-round window and
    // lean on weapon attacks (CD 5), basicHeal (CD 5), and cleanse/clear
    // (CD 10) to fill the gaps.
    const JUTSU_CD = 7;
    const std    = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 40, chakraCost: 50, cooldown: JUTSU_CD, tags });
    const nuke   = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 50, chakraCost: 80, cooldown: JUTSU_CD, tags });
    const pierce = (id: string):              Jutsu => ({ id: N(id), name: id, type: T, apCost: 60, effectPower: 40, chakraCost: 60, cooldown: JUTSU_CD, tags: [{ name: 'Pierce' }] });
    const util   = (id: string, tags: Tag[]): Jutsu => ({ id: N(id), name: id, type: T, apCost: 40, effectPower: 0,  chakraCost: 30, cooldown: JUTSU_CD, tags });

    // Shorthand for percent values
    const C  = A_RANK_TAG_PCT;    // 35% — capped damage tags at A-rank
    const S  = STANDARD_TAG_PCT;  // 30% — uncapped tags / Wound-rank-cap A-rank
    const W  = WOUND_CAP_AB;      // 30% — Wound A-rank cap

    // Six competitive A-rank loadouts, each 15 jutsu:
    //   • 7 damage jutsu (60-AP) — each is damage + 1 tag
    //     - up to 1 Nuke (EP 50), up to 1 Pierce (EP 40 + Pierce tag)
    //     - remaining are Standards (EP 40)
    //   • 8 utility jutsu (40-AP) — each carries 2 tags
    //   • ~5 jutsu use capped damage tags at 35% (A-rank cap)
    //   • Remaining ~10 use uncapped tags at 30% or binary/flat effects
    // A real player would pick ONE archetype; the tournament pits them all.
    switch (archetype) {
        case 'Standard-Meta':
            // Balanced mix — damage variety + classic IDG/DDT setup tools.
            return {
                jutsu: [
                    // 7 damage (60-AP)
                    nuke  ('Nuke+Wound',     [{ name: 'Wound',                 percent: W }]),
                    pierce('Pierce'),
                    std   ('Std+Ignition',   [{ name: 'Ignition',              percent: C }]),    // capped #1
                    std   ('Std+Poison',     [{ name: 'Poison',                percent: S }]),
                    std   ('Std+Wound',      [{ name: 'Wound',                 percent: W }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    std   ('Std+Stun',       [{ name: 'Stun' }]),
                    // 8 utility (40-AP, 2 tags each)
                    util  ('IDG+Heal',       [{ name: 'Increase Damage Given', percent: C }, { name: 'Heal' }]),                    // capped #2
                    util  ('DDT+Shield',     [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Shield' }]),                   // capped #3
                    util  ('Reflect+SP',     [{ name: 'Reflect',               percent: C }, { name: 'Stun Prevent' }]),             // capped #4
                    util  ('DDG+IncHeal',    [{ name: 'Decrease Damage Given', percent: C }, { name: 'Increase Heal', percent: S }]), // capped #5
                    util  ('BLSeal+BuffPrv', [{ name: 'Bloodline Seal' },     { name: 'Buff Prevent' }]),
                    util  ('CleansePrv+DP',  [{ name: 'Cleanse Prevent' },    { name: 'Debuff Prevent' }]),
                    util  ('Mirror+ClearPrv',[{ name: 'Mirror' },             { name: 'Clear Prevent' }]),
                    util  ('Lag+Heal',       [{ name: 'Lag', percent: S },    { name: 'Heal' }]),
                ],
                weaponEffect: 'Lifesteal', weaponEffectValue: C,
            };
        case 'DoT-Sustain':
            // Tick-heavy: Wound/Poison/Drain everywhere + sustain through ticks.
            return {
                jutsu: [
                    nuke  ('Nuke+Plague',    [{ name: 'Wound',  percent: W }]),
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    std   ('Std+Wound',      [{ name: 'Wound',  percent: W }]),
                    std   ('Std+Siphon',     [{ name: 'Siphon', percent: C }]),                                                       // capped #1
                    std   ('Std+Ignite',     [{ name: 'Ignition', percent: C }]),                                                     // capped #2
                    std   ('Std+Poison2',    [{ name: 'Poison', percent: S }]),
                    util  ('Lifesteal+Heal', [{ name: 'Lifesteal', percent: C }, { name: 'Heal' }]),                                  // capped #3
                    util  ('IDT+IncHeal',    [{ name: 'Increase Damage Taken', percent: C }, { name: 'Increase Heal', percent: S }]), // capped #4
                    util  ('DDT+Shield',     [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Shield' }]),                    // capped #5
                    util  ('Wound+Poison',   [{ name: 'Wound', percent: W }, { name: 'Poison', percent: S }]),
                    util  ('Drain+IncHeal',  [{ name: 'Drain' }, { name: 'Increase Heal', percent: S }]),
                    util  ('CleansePrv+DP',  [{ name: 'Cleanse Prevent' }, { name: 'Debuff Prevent' }]),
                    util  ('BLSeal+BuffPrv', [{ name: 'Bloodline Seal' }, { name: 'Buff Prevent' }]),
                    util  ('Mirror+SP',      [{ name: 'Mirror' }, { name: 'Stun Prevent' }]),
                ],
                weaponEffect: 'Lifesteal', weaponEffectValue: C,
            };
        case 'Control-Lock':
            // Heavy disruption — Stun/Lag/BL Seal/prevents. NOTE: accepted as
            // weak under 7-turn CDs (continuous lockdown impossible).
            return {
                jutsu: [
                    nuke  ('Nuke+Stun',      [{ name: 'Stun' }]),
                    std   ('Std+Lag',        [{ name: 'Lag', percent: S }]),
                    std   ('Std+Wound',      [{ name: 'Wound', percent: W }]),
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),                                                       // capped #1
                    std   ('Std+Ignite',     [{ name: 'Ignition', percent: C }]),                                                     // capped #2
                    util  ('BLSeal+BuffPrv', [{ name: 'Bloodline Seal' }, { name: 'Buff Prevent' }]),
                    util  ('CleansePrv+SP',  [{ name: 'Cleanse Prevent' }, { name: 'Stun Prevent' }]),
                    util  ('ClearPrv+DP',    [{ name: 'Clear Prevent' }, { name: 'Debuff Prevent' }]),
                    util  ('Lag+Stun',       [{ name: 'Lag', percent: S }, { name: 'Stun' }]),
                    util  ('ESeal+Mirror',   [{ name: 'Elemental Seal' }, { name: 'Mirror' }]),
                    util  ('IDT+Heal',       [{ name: 'Increase Damage Taken', percent: C }, { name: 'Heal' }]),                      // capped #3
                    util  ('DDG+Shield',     [{ name: 'Decrease Damage Given', percent: C }, { name: 'Shield' }]),                    // capped #4
                    util  ('DDT+IncHeal',    [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Increase Heal', percent: S }]), // capped #5
                ],
                weaponEffect: 'Absorb', weaponEffectValue: C,
            };
        case 'Anti-Caster':
            // Hard counter to control/burst. Reflect/Absorb + prevents.
            return {
                jutsu: [
                    nuke  ('Nuke+Wound',     [{ name: 'Wound', percent: W }]),
                    pierce('Pierce'),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),                                                       // capped #1
                    std   ('Std+Wound',      [{ name: 'Wound', percent: W }]),
                    std   ('Std+Stun',       [{ name: 'Stun' }]),
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    util  ('Reflect+Heal',   [{ name: 'Reflect', percent: C }, { name: 'Heal' }]),                                    // capped #2
                    util  ('Absorb+Shield',  [{ name: 'Absorb', percent: C }, { name: 'Shield' }]),                                   // capped #3
                    util  ('DDT+SP',         [{ name: 'Decrease Damage Taken', percent: C }, { name: 'Stun Prevent' }]),              // capped #4
                    util  ('DDG+DebuffPrv',  [{ name: 'Decrease Damage Given', percent: C }, { name: 'Debuff Prevent' }]),            // capped #5
                    util  ('CleansePrv+BP',  [{ name: 'Cleanse Prevent' }, { name: 'Buff Prevent' }]),
                    util  ('IncHeal+Wound',  [{ name: 'Increase Heal', percent: S }, { name: 'Wound', percent: W }]),
                    util  ('Mirror+ClearPrv',[{ name: 'Mirror' }, { name: 'Clear Prevent' }]),
                    util  ('BLSeal+Lag',     [{ name: 'Bloodline Seal' }, { name: 'Lag', percent: S }]),
                ],
                weaponEffect: 'Reflect', weaponEffectValue: C,
            };
        case 'Tempo':
            // Action economy + amp stacking. Overclock for extra AP, Recoil
            // for passive damage, IDG/IDT/Ignition for amp stacks (DR-pooled).
            return {
                jutsu: [
                    nuke  ('Nuke+Ignite',    [{ name: 'Ignition', percent: C }]),                                                     // capped #1
                    pierce('Pierce'),
                    std   ('Std+Wound',      [{ name: 'Wound', percent: W }]),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),                                                       // capped #2
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    std   ('Std+Stun',       [{ name: 'Stun' }]),
                    util  ('Overclock+Lag',  [{ name: 'Overclock', percent: S }, { name: 'Lag', percent: S }]),
                    util  ('IDG+DDT',        [{ name: 'Increase Damage Given', percent: C }, { name: 'Decrease Damage Taken', percent: C }]), // capped #3 (2 capped in 1)
                    util  ('IDT+Heal',       [{ name: 'Increase Damage Taken', percent: C }, { name: 'Heal' }]),                      // capped #4
                    util  ('DDG+Shield',     [{ name: 'Decrease Damage Given', percent: C }, { name: 'Shield' }]),                    // capped #5
                    util  ('IncHeal+SP',     [{ name: 'Increase Heal', percent: S }, { name: 'Stun Prevent' }]),
                    util  ('BLSeal+CleansePrv',[{ name: 'Bloodline Seal' }, { name: 'Cleanse Prevent' }]),
                    util  ('Mirror+BuffPrv', [{ name: 'Mirror' }, { name: 'Buff Prevent' }]),
                    util  ('Wound+Poison',   [{ name: 'Wound', percent: W }, { name: 'Poison', percent: S }]),
                ],
                weaponEffect: 'Lifesteal', weaponEffectValue: C,
            };
        case 'Disruption':
            // Status manipulation — Mirror copies debuffs, Copy steals buffs,
            // tag chaos. Spreads pressure across the kit.
            return {
                jutsu: [
                    nuke  ('Nuke+Stun',      [{ name: 'Stun' }]),
                    pierce('Pierce'),
                    std   ('Std+Lag',        [{ name: 'Lag', percent: S }]),
                    std   ('Std+Recoil',     [{ name: 'Recoil', percent: C }]),                                                       // capped #1
                    std   ('Std+Wound',      [{ name: 'Wound', percent: W }]),
                    std   ('Std+Poison',     [{ name: 'Poison', percent: S }]),
                    std   ('Std+Drain',      [{ name: 'Drain' }]),
                    util  ('Mirror+ClearPrv',[{ name: 'Mirror' }, { name: 'Clear Prevent' }]),
                    util  ('Copy+Heal',      [{ name: 'Copy' }, { name: 'Heal' }]),
                    util  ('IDT+DDG',        [{ name: 'Increase Damage Taken', percent: C }, { name: 'Decrease Damage Given', percent: C }]), // capped #2 (2 capped in 1)
                    util  ('IDG+DDT',        [{ name: 'Increase Damage Given', percent: C }, { name: 'Decrease Damage Taken', percent: C }]), // capped #3 (2 capped in 1)
                    util  ('Ignite+Shield',  [{ name: 'Ignition', percent: C }, { name: 'Shield' }]),                                 // capped #4
                    util  ('Reflect+SP',     [{ name: 'Reflect', percent: C }, { name: 'Stun Prevent' }]),                            // capped #5
                    util  ('BLSeal+BuffPrv', [{ name: 'Bloodline Seal' }, { name: 'Buff Prevent' }]),
                    util  ('ESeal+CleansePrv',[{ name: 'Elemental Seal' }, { name: 'Cleanse Prevent' }]),
                ],
                weaponEffect: 'Lifesteal', weaponEffectValue: C,
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

function makeChampion(name: string, archetype: Archetype): Fighter {
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

function cloneFighter(f: Fighter): Fighter { return JSON.parse(JSON.stringify(f)); }

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
    console.log('SCENARIO B — sample damage at A-rank vs A-rank, both maxed, full Mythic');
    console.log('═══════════════════════════════════════════════════════════════════════');
    const atk = makeChampion('A', 'Standard-Meta');
    const def = makeChampion('B', 'Standard-Meta');
    const cases: Array<[string, Jutsu]> = [
        ['Standard 60-AP (EP 40, no tags)',       { id: 'd1', name: 'Std', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 50, cooldown: 0, tags: [] }],
        ['Nuke 60-AP (EP 50, no tags)',           { id: 'd2', name: 'Nuke', type: 'Ninjutsu', apCost: 60, effectPower: 50, chakraCost: 80, cooldown: 2, tags: [] }],
        ['Nuke + Wound 30%',                       { id: 'd3', name: 'NukeW', type: 'Ninjutsu', apCost: 60, effectPower: 50, chakraCost: 80, cooldown: 2, tags: [{ name: 'Wound', percent: 30 }] }],
        ['Pierce (capped 900)',                    { id: 'd4', name: 'Pierce', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 60, cooldown: 3, tags: [{ name: 'Pierce' }] }],
        ['Standard 60-AP w/ 4× IDG stacks (35%)', { id: 'd5', name: 'StdAmp', type: 'Ninjutsu', apCost: 60, effectPower: 40, chakraCost: 50, cooldown: 0, tags: [] }],
    ];
    console.log('Vs full Legendary armor (DR 0.35) + Void Sovereign set (+6% damage):\n');
    for (const [label, j] of cases) {
        const a = cloneFighter(atk); const d = cloneFighter(def);
        if (label.includes('IDG stacks')) {
            for (let i = 0; i < 4; i++) a.statuses.push({ name: 'Increase Damage Given', rounds: 4, percent: A_RANK_TAG_PCT, kind: 'positive' });
        }
        const r = applyJutsu(a, d, j);
        console.log(`  ${label.padEnd(40)} → ${r.dealt.toString().padStart(5)} dmg`);
    }
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — Archetype tournament
// ─────────────────────────────────────────────────────────────────────────────
function scenarioC() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('SCENARIO C — 100 fighters, max stats, A-rank bloodline, Mythic gear');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('  • A-rank bloodlineMult = 1.15, capped damage tags = 35%, Wound cap = 30%');
    console.log('  • Full Legendary armor   → armorRawDR = 0.35 (5 pieces × 0.07)');
    console.log('  • Each fighter\'s armor set → +6% in ONE category (dmg/absorb/reflect/lifesteal)');
    console.log('  • Best weapon (Mythic)   → weaponEp 30 + Lifesteal/Reflect/Absorb 35%');
    console.log('  • Player-grade AI (heal at <30% HP, cleanse w/ 2+ debuffs, pierce vs armor,');
    console.log('    stack IDG/IDT, prioritize Wound/Ignition setup, AP-budget 40+60 combo)');
    console.log('  • Round-robin: every fighter vs every other (4,950 fights total)\n');

    const archetypes: Archetype[] = ['Standard-Meta', 'DoT-Sustain', 'Control-Lock', 'Anti-Caster', 'Tempo', 'Disruption'];
    const roster: Fighter[] = [];
    for (let i = 0; i < 100; i++) {
        const a = archetypes[i % archetypes.length]!;
        roster.push(makeChampion(`F${i + 1}-${a}`, a));
    }

    const wins = new Array(100).fill(0);
    const losses = new Array(100).fill(0);
    const draws = new Array(100).fill(0);
    let totalTurns = 0, totalFights = 0, drawCount = 0;
    const turnDist: Record<string, number> = { '1-5': 0, '6-10': 0, '11-15': 0, '16-20': 0, '21-30': 0, '31-45': 0, '46-60': 0 };
    const matchupWins: Record<string, Record<string, { w: number; total: number }>> = {};
    for (const a of archetypes) {
        matchupWins[a] = {};
        for (const b of archetypes) matchupWins[a]![b] = { w: 0, total: 0 };
    }

    const t0 = Date.now();
    // Round-robin
    for (let i = 0; i < 100; i++) {
        for (let j = i + 1; j < 100; j++) {
            const p1 = cloneFighter(roster[i]!); const p2 = cloneFighter(roster[j]!);
            const r = simulateFight(p1, p2);
            totalFights++; totalTurns += r.turns;
            const a1 = roster[i]!.archetype; const a2 = roster[j]!.archetype;
            matchupWins[a1]![a2]!.total++; matchupWins[a2]![a1]!.total++;
            if (r.winner === 'p1') { wins[i]++; losses[j]++; matchupWins[a1]![a2]!.w++; }
            else if (r.winner === 'p2') { wins[j]++; losses[i]++; matchupWins[a2]![a1]!.w++; }
            else { draws[i]++; draws[j]++; drawCount++; }
            const t = r.turns;
            if (t <= 5) turnDist['1-5']!++;
            else if (t <= 10) turnDist['6-10']!++;
            else if (t <= 15) turnDist['11-15']!++;
            else if (t <= 20) turnDist['16-20']!++;
            else if (t <= 30) turnDist['21-30']!++;
            else if (t <= 45) turnDist['31-45']!++;
            else turnDist['46-60']!++;
        }
    }
    const elapsed = Date.now() - t0;

    console.log(`Fights:          ${totalFights}`);
    console.log(`Draws (HP-tied): ${drawCount} (${(100 * drawCount / totalFights).toFixed(1)}%)`);
    console.log(`Avg turns:       ${(totalTurns / totalFights).toFixed(1)}`);
    console.log(`Runtime:         ${elapsed} ms\n`);

    console.log('Turn distribution:');
    for (const [bucket, count] of Object.entries(turnDist)) {
        const bar = '█'.repeat(Math.floor(60 * count / totalFights));
        console.log(`  ${bucket.padStart(6)}: ${String(count).padStart(4)} ${bar}`);
    }

    // Win rate by archetype
    console.log('\nWin rate by archetype:');
    const archStats: Record<Archetype, { w: number; l: number; d: number }> = {} as Record<Archetype, { w: number; l: number; d: number }>;
    for (const a of archetypes) archStats[a] = { w: 0, l: 0, d: 0 };
    for (let i = 0; i < 100; i++) {
        const a = roster[i]!.archetype;
        archStats[a].w += wins[i]; archStats[a].l += losses[i]; archStats[a].d += draws[i];
    }
    for (const a of archetypes) {
        const s = archStats[a];
        const total = s.w + s.l + s.d;
        const rate = total > 0 ? (s.w / total * 100) : 0;
        const bar = '█'.repeat(Math.floor(rate / 2));
        console.log(`  ${a.padEnd(13)} ${rate.toFixed(1).padStart(5)}%  W ${String(s.w).padStart(4)}  L ${String(s.l).padStart(4)}  D ${String(s.d).padStart(3)}  ${bar}`);
    }

    // Matchup matrix
    console.log('\nMatchup win-rate matrix (rows = attacker archetype, cols = defender):');
    const pad = (s: string, n: number) => s.padEnd(n);
    const padR = (s: string, n: number) => s.padStart(n);
    let header = pad('ATK \\ DEF', 14);
    for (const a of archetypes) header += padR(a, 13);
    console.log(header);
    for (const a1 of archetypes) {
        let row = pad(a1, 14);
        for (const a2 of archetypes) {
            const m = matchupWins[a1]![a2]!;
            const rate = m.total > 0 ? (m.w / m.total * 100) : 0;
            row += padR(`${rate.toFixed(0)}% (${m.total})`, 13);
        }
        console.log(row);
    }

    console.log('\n  Diagonal entries (mirror matches) should be ~50%.');
    console.log('  Off-diagonal asymmetries show which archetype counters which.\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
scenarioA();
scenarioB();
scenarioC();
