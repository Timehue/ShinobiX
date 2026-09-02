/*
 * Jutsu effect descriptions + level-aware display helpers.
 *
 *   • jutsuEffectInfo      — per-tag summary/rule/duration/value copy used by
 *                            the jutsu cards, tag picker and combat inspect UI
 *   • jutsuDisplayAtLevel  — a jutsu scaled (EP + tag percents) to a mastery lvl
 *   • describeJutsuEffects — one-line plain summary of a jutsu's tags
 *
 * Pure functions depending only on lib/tags, lib/combat-math, lib/jutsu-scaling,
 * constants/game and the type modules. Extracted from App.tsx (jutsu cluster).
 */

import { tagMatchesName } from "./tags";
import { loneDisciplineBonusFromPotency, loneGeneralBonusFromPotency } from "./stat-effect-potency";
import { scaleJutsuByLevel, scaleJutsuTagsForDisplay } from "./jutsu-scaling";
import { JUTSU_MAX_LEVEL, STUN_AP_PENALTY, COMBAT_RESOURCES_V2 } from "../constants/game";
import { TEMPO_AP_SWING } from "./combat-action-display";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { JutsuType } from "../types/core";

export function jutsuEffectInfo(jutsu: Jutsu, tag: JutsuTag, lensDiscipline?: JutsuType) {
    const pct = tag.percent > 0 ? tag.percent : 30;
    const effectPower = jutsu.effectPower;
    const percentLabel = tag.percent > 0 ? `${tag.percent}%` : "Static";
    const recurringGroundZone = jutsu.target === "EMPTY_GROUND"
        && (jutsu.method === "INSTANT_EFFECT" || jutsu.method === "AOE_SPIRAL");
    const nextRound = (rounds: number) => `Starts next round · ${rounds} round${rounds === 1 ? "" : "s"}`;
    const zoneOrNextRound = (rounds: number) => recurringGroundZone
        ? "On catch / target turn"
        : nextRound(rounds);
    // Display-only lens (Profile discipline dropdown). For tags that key off
    // the player's OWN outgoing damage, name the chosen discipline so it's
    // clear what's being modified (e.g. "Taijutsu damage given"). Trailing
    // space so `${disc}damage` reads naturally with or without a lens. Tags
    // that describe the enemy's damage or incoming damage stay neutral.
    const disc = lensDiscipline && lensDiscipline !== "Any" ? `${lensDiscipline} ` : "";

    if (tag.name === "Damage") return { summary: `Deals damage at ${effectPower}% effect power.`, rule: "Uses the jutsu offense type against the target's matching defense, then applies weather, terrain, bloodline, armor, and status modifiers.", duration: "Instant", value: `${effectPower}% EP` };
    if (tag.name === "Heal") return { summary: "Immediately restores up to 750 HP to the user, scaling with mastery.", rule: "Resolves on cast. A damaging jutsu keeps its hit and heals on top; a 40 AP utility still deals no direct damage. Existing Increase Heal can raise the result above 750. Buff Prevent does not block direct healing.", duration: "Instant", value: "Up to 750 HP" };
    if (tag.name === "Shield") return { summary: "Immediately adds up to 750 shield to the user, scaling with mastery.", rule: "Shield absorbs incoming damage before HP. The total shield pool is capped at one max-HP bar or 5,000, whichever is lower. Pierce bypasses it without consuming it. Buff Prevent does not block direct shielding.", duration: "Instant · until broken", value: "Up to 750" };
    if (tag.name === "Barrier") return { summary: "Queues an impassable wall tile one step toward the enemy.", rule: "The wall becomes active at the start of the next combat round and blocks movement for both fighters for 2 complete rounds.", duration: nextRound(2), value: "Wall tile" };
    if (tag.name === "Increase Damage Given") return { summary: `Increases your damage given by ${pct}% with all offenses for 2 rounds.`, rule: "Queues one positive stack on the caster. Repeated copies trigger independently and feed the shared damage-amplifier pool with diminishing returns; it cannot strengthen the cast that applies it.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Decrease Damage Given") return { summary: `Makes the target deal ${pct}% less damage with all offenses.`, rule: recurringGroundZone ? "A caught target is affected for its current/upcoming turn, and the zone refreshes the effect at the start of each target turn spent inside it." : "Queues a negative status for the next combat round that lowers all outgoing damage, regardless of offense type.", duration: zoneOrNextRound(2), value: `${pct}%` };
    if (tag.name === "Increase Damage Taken") return { summary: `Makes the target take ${pct}% more damage from you with all offenses.`, rule: "Queues a negative status for the next combat round. It raises damage from all offense types but cannot amplify the cast that applies it.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Decrease Damage Taken") return { summary: `Makes the user take ${pct}% less damage from all offenses.`, rule: "Queues a positive status for the next combat round that lowers incoming damage from every offense type.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Absorb") return { summary: `Converts ${pct}% of incoming post-shield damage into healing.`, rule: "Queues a positive status for the next combat round. Buff Prevent can block it; Pierce bypasses it. Stacked Absorb is capped at 60% of the final hit.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Siphon") return { summary: `Heals the user for ${pct}% of the ${disc}damage dealt.`, rule: "Triggers after damage. Instant heal based on final damage.", duration: "Instant after hit", value: `${pct}%` };
    if (tag.name === "Lifesteal") return { summary: `During the next 2 rounds, every damaging attack heals you for ${pct}% of the ${disc}damage dealt.`, rule: "Queues a positive status on the caster. It can trigger on multiple attacks per round; stacked Lifesteal is capped at 60% of final damage.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Reflect") return { summary: `Reflects ${pct}% of post-shield damage back at attackers.`, rule: "Queues a positive status for the next combat round. Buff Prevent can block it; Pierce bypasses it. Stacked Reflect is capped at 60% of the final hit.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Recoil") return { summary: `Applies ${pct}% recoil to the target.`, rule: recurringGroundZone ? "A caught target suffers recoil on attacks made during that turn; the zone refreshes it at each target-turn start spent inside." : "Queues a negative status for the next combat round. The target then suffers capped self-damage whenever their attack deals damage.", duration: zoneOrNextRound(2), value: `${pct}%` };
    if (tag.name === "Wound") return { summary: `Seeds a bleed from this hit; it starts on the target's turn next round and ticks for 2 rounds.`, rule: `Each start-of-turn tick is based on capped post-shield ${disc}damage from the applying hit. Wound supports at most 2 concurrent stacks.`, duration: nextRound(2), value: `${pct}%` };
    if (tagMatchesName(tag.name, "Ignition")) return { summary: `Ignites the target so every hit during the next 2 rounds gains up to ${pct}% ${disc}damage.`, rule: "Queues a stackable negative status. It joins Increase Damage Given and Increase Damage Taken in the shared diminishing-returns amplification pool; it cannot amplify the cast that applies it.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Stun") return { summary: `Removes ${STUN_AP_PENALTY} AP from the target's turn in the next combat round.`, rule: "Queues the penalty unless Stun Prevent or Debuff Prevent blocks it. It does not skip the turn, and it cannot reduce AP during the cast round.", duration: "Target turn next round", value: `-${STUN_AP_PENALTY} AP` };
    if (tag.name === "Bloodline Seal" || tag.name === "Seal") return { summary: "Seals the target's bloodline and suppresses its combat bonuses.", rule: "Queues a debuff unless Debuff Prevent blocks it. While active, the bloodline multiplier is 1.0 and Increase Generals/Discipline bonuses are suppressed; it does not prevent jutsu use.", duration: nextRound(2), value: "No bloodline bonus" };
    if (tag.name === "Elemental Seal") return { summary: "Prevents Fire, Water, Earth, Wind, and Lightning jutsu use during the next combat round.", rule: "Queues a 1-round debuff unless Debuff Prevent blocks it. None and special/custom elements remain usable.", duration: nextRound(1), value: "Five basic elements" };
    if (tag.name === "Move") return { summary: "Moves the user on the battlefield.", rule: "Always lets the user choose an open tile within the jutsu range.", duration: "Instant", value: "Always" };
    if (tag.name === "Push") return { summary: "Immediately pushes the target away from the user, up to the jutsu's range.", rule: "Moves one tile at a time and stops early at the board edge, an occupied tile, or a Barrier. Debuff Prevent blocks it.", duration: "Instant", value: "Up to range tiles" };
    if (tag.name === "Pull") return { summary: "Immediately pulls the target toward the user, up to the jutsu's range.", rule: "Moves one tile at a time and stops early at the user, an occupied tile, or a Barrier. Debuff Prevent blocks it.", duration: "Instant", value: "Up to range tiles" };
    if (tag.name === "Buff Prevent") return { summary: "Blocks new positive status effects on the target.", rule: "Queues a debuff unless Debuff Prevent blocks it. It stops statuses such as Reflect, Absorb, Lifesteal, damage/stat buffs, Copy, and Overclock; direct Heal, Shield, Barrier, Debuff Prevent, and Stun Prevent still resolve.", duration: nextRound(2), value: "Always" };
    if (tag.name === "Debuff Prevent") return { summary: "Protects the caster from new debuffs.", rule: "Queues an unconditional positive ward. Once active it blocks Stun, seals, damage debuffs, DoTs, displacement, Mirror, and other new negative statuses; it does not remove existing debuffs.", duration: nextRound(2), value: "Always" };
    if (tag.name === "Cleanse Prevent") return { summary: "Prevents the target from cleansing debuffs.", rule: "Queues a negative status unless Debuff Prevent blocks it. Cleanse attempts are blocked once it becomes active.", duration: nextRound(2), value: "Always" };
    if (tag.name === "Clear Prevent") return { summary: "Prevents the caster's positive statuses from being cleared.", rule: "Queues a positive status for the next combat round. Buff Prevent can stop it; once active it blocks the opponent's Clear action.", duration: nextRound(2), value: "Always" };
    if (tag.name === "Stun Prevent") return { summary: "Prevents incoming Stun.", rule: "Queues an unconditional positive ward for the next combat round; it does not remove a Stun that already resolved.", duration: nextRound(2), value: "Always" };
    // Poison's combat fallback is 6% (see api/pvp/move.ts + Arena PvE), NOT tagPower's
    // generic 30 — use the same default so an unset-percent Poison tooltip matches what
    // combat actually applies. Under combatResourcesV2 poison feeds on EXERTION (on-spend),
    // not a per-round chakra-pool tick, so the copy branches on the flag.
    if (tag.name === "Poison") {
        const poisonPct = tag.percent > 0 ? tag.percent : 6;
        return COMBAT_RESOURCES_V2
            ? { summary: `Poisons the target — while active, every jutsu they cast saps HP scaled by the chakra/stamina spent (at ${poisonPct}% potency).`, rule: recurringGroundZone ? "A caught target can be poisoned for its upcoming turn, and each target-turn start inside the zone refreshes the 2-round poison. A refreshed Poison can remain after the zone expires or the target leaves it; not casting a jutsu avoids the damage." : "Queues a 2-round debuff for the next combat round. Bigger chakra/stamina spends cause bigger HP damage; not casting a jutsu avoids it.", duration: zoneOrNextRound(2), value: `${poisonPct}% of spend` }
            : { summary: `Poisons the target — deals ${poisonPct}% of their max chakra as damage each round.`, rule: "Applies a 2-round negative status that deals damage based on the target's chakra pool.", duration: "2 rounds", value: `${poisonPct}% chakra` };
    }
    if (tag.name === "Drain") return { summary: "Drains the target's HP and chakra at the start of their turns — 50–300, scaling with mastery.", rule: "Queues a 2-round negative status for the next combat round. Each tick removes equal HP and chakra (not stamina) and is partially mitigated by the target's armor/damage reduction.", duration: nextRound(2), value: "50–300/turn" };
    if (tag.name === "Pierce") return { summary: "True damage — up to 900, scaled by offense + mastery.", rule: "Ignores armor, shields, damage reduction, damage buffs, and damage debuffs. Pierce jutsus must be 60 AP, and you can equip at most one Pierce jutsu in a loadout. At max stats the cap of 900 is always reached.", duration: "Instant", value: "≤900" };
    if (tag.name === "Copy") return { summary: "Copies all of the enemy's currently active positive statuses except Absorb and Lifesteal.", rule: "Snapshots active enemy buffs when cast, then gives each eligible buff to the user for a fresh 2 rounds starting next combat round. Pending enemy buffs are not included, and an active Buff Prevent on the user blocks Copy.", duration: "Starts next round · fresh 2 rounds", value: "Always" };
    if (tag.name === "Mirror") return { summary: "Copies all of the user's currently active negative statuses onto the enemy.", rule: "Snapshots every active debuff on the user when cast, including Wound, Ignition, Poison, and Drain, then gives each one to the enemy for a fresh 2 rounds starting next combat round. The originals stay on the user, pending debuffs are not included, and an active Debuff Prevent on the enemy blocks Mirror.", duration: "Starts next round · fresh 2 rounds", value: "Always" };
    if (tagMatchesName(tag.name, "Lag")) return { summary: `Every action the target takes next round costs ${TEMPO_AP_SWING} more AP.`, rule: "Queues a 1-round negative status unless Debuff Prevent blocks it. The amount is flat and does not scale with mastery. It raises each action's AP cost, not the target's base AP pool, and a second Lag does not stack.", duration: nextRound(1), value: `+${TEMPO_AP_SWING} AP per action` };
    if (tagMatchesName(tag.name, "Overclock")) return { summary: `Every action the user takes next round costs ${TEMPO_AP_SWING} less AP.`, rule: "Queues a 1-round positive status. The amount is flat and does not scale with mastery. Buff Prevent can block it, it cannot discount another action during the cast round, no action drops below 1 AP, and a second Overclock does not stack.", duration: nextRound(1), value: `−${TEMPO_AP_SWING} AP per action` };
    if (tag.name === "Increase Heal") return { summary: `Increases future healing by ${pct}%.`, rule: "Queues a positive status that boosts later Heal, Lifesteal, and Siphon results. It cannot boost healing from the cast that applies it.", duration: nextRound(2), value: `${pct}%` };
    if (tag.name === "Increase Generals") {
        const flatBonus = loneGeneralBonusFromPotency(pct);
        return {
            summary: `Applies ${pct}% potency to strength, speed, intelligence, and willpower (+${flatBonus} to each as a lone stack).`,
            rule: `Queues a stackable positive status. Potency feeds a diminishing-returns pool and becomes a flat general-stat bonus; it is not a literal ${pct}% multiplier. Because generals feed offense and defense, it raises damage dealt and lowers damage taken. Buff Prevent blocks it, Clear removes it, and Bloodline Seal suppresses it.`,
            duration: nextRound(2),
            value: `${pct}% potency · +${flatBonus} each`,
        };
    }
    if (tag.name === "Increase Discipline") {
        const discipline = ["Taijutsu", "Bukijutsu", "Genjutsu", "Ninjutsu"].includes(jutsu.type) ? jutsu.type : null;
        const flatBonus = discipline ? loneDisciplineBonusFromPotency(pct) : 0;
        return {
            summary: discipline
                ? `Applies ${pct}% potency to ${discipline} offense (+${flatBonus} as a lone stack).`
                : `Applies ${pct}% potency to this jutsu's discipline; an Any-style cast cannot create the buff.`,
            rule: `Queues a stackable positive status locked to Taijutsu, Bukijutsu, Genjutsu, or Ninjutsu. Potency feeds a diminishing-returns pool and becomes a flat offense bonus; it is not a literal ${pct}% multiplier. Only that style's offense rises. Buff Prevent blocks it, Clear removes it, and Bloodline Seal suppresses it.`,
            duration: nextRound(2),
            value: discipline ? `${pct}% potency · +${flatBonus} ${discipline}` : `${pct}% potency`,
        };
    }
    return { summary: tag.name || "Unnamed effect", rule: "Custom effect tag.", duration: "Varies", value: percentLabel };
}

export function jutsuDisplayAtLevel(jutsu: Jutsu, masteryLevel = JUTSU_MAX_LEVEL): Jutsu {
    const scaled = scaleJutsuByLevel(jutsu, masteryLevel);
    return scaleJutsuTagsForDisplay({ ...jutsu, effectPower: scaled.scaledEffectPower }, masteryLevel);
}

export function describeJutsuEffects(jutsu: Jutsu, masteryLevel = JUTSU_MAX_LEVEL, lensDiscipline?: JutsuType) {
    const displayJutsu = jutsuDisplayAtLevel(jutsu, masteryLevel);
    const grouped = displayJutsu.tags
        .filter((tag) => tag.name)
        .reduce<Array<{ summary: string; count: number }>>((result, tag) => {
            const summary = jutsuEffectInfo(displayJutsu, tag, lensDiscipline).summary;
            const existing = result.find((entry) => entry.summary === summary);
            if (existing) existing.count += 1;
            else result.push({ summary, count: 1 });
            return result;
        }, []);
    const descriptions = grouped.map(({ summary, count }) => count > 1 ? `${summary} Triggers ${count} times per cast.` : summary);

    return descriptions.length ? descriptions.join(" ") : "No special effects.";
}

/**
 * Short + long targeting copy for a jutsu's delivery method / target. Every jutsu
 * returns a label (never null) so the targeting line always shows and players can
 * tell single-target, self, all-enemy and the various AOE jutsu apart at a glance —
 * AOE_BURST in particular looks identical to a normal single-target nuke on a card
 * (same OPPONENT target, no ground tile). Descriptions mirror api/towers/_engine.ts
 * (jutsuAreaRadius) and the ground-zone resolution in api/pvp/move.ts.
 */
export function jutsuTargetingLabel(jutsu: Jutsu): { short: string; detail: string } {
    switch (jutsu.method) {
        case "AOE_BURST":
            return {
                short: "AOE Burst",
                detail: "Hits the target and every enemy in the ring of tiles touching it for full damage. The splash only matters against multiple foes (e.g. Battle Towers); one-on-one it lands as a normal single-target hit.",
            };
        case "AOE_SPIRAL":
            return {
                short: "AOE Spiral",
                detail: "The user dashes onto a chosen tile and creates a persistent 2-round radius-2 ground zone on landing.",
            };
        case "AOE_CIRCLE":
            return {
                short: "AOE Circle",
                detail: "The user moves to a chosen tile, then the surrounding ring takes the jutsu's direct hit. It does not create a persistent zone.",
            };
        case "INSTANT_EFFECT":
            return {
                short: "AOE Ground",
                detail: "Creates a persistent 2-round zone on a chosen tile and its surrounding ring.",
            };
        case "ALL":
            return {
                short: "All Enemies",
                detail: "Reaches every enemy at once.",
            };
        case "SINGLE":
        default:
            return jutsu.target === "SELF"
                ? { short: "Self", detail: "Affects only the user." }
                : { short: "Single Target", detail: "Affects a single target — no area splash." };
    }
}
