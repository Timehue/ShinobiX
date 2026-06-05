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

import { tagPower } from "./combat-math";
import { tagMatchesName } from "./tags";
import { scaleJutsuByLevel, scaleJutsuTagsForDisplay } from "./jutsu-scaling";
import { JUTSU_MAX_LEVEL, STUN_AP_PENALTY } from "../constants/game";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { JutsuType } from "../types/core";

export function jutsuEffectInfo(jutsu: Jutsu, tag: JutsuTag, lensDiscipline?: JutsuType) {
    const pct = tagPower(tag);
    const effectPower = jutsu.effectPower;
    const percentLabel = tag.percent > 0 ? `${tag.percent}%` : "Static";
    // Display-only lens (Profile discipline dropdown). For tags that key off
    // the player's OWN outgoing damage, name the chosen discipline so it's
    // clear what's being modified (e.g. "Taijutsu damage given"). Trailing
    // space so `${disc}damage` reads naturally with or without a lens. Tags
    // that describe the enemy's damage or incoming damage stay neutral.
    const disc = lensDiscipline && lensDiscipline !== "Any" ? `${lensDiscipline} ` : "";

    if (tag.name === "Damage") return { summary: `Deals damage at ${effectPower}% effect power.`, rule: "Uses the jutsu offense type against the target's matching defense, then applies weather, terrain, bloodline, armor, and status modifiers.", duration: "Instant", value: `${effectPower}% EP` };
    if (tag.name === "Heal") return { summary: `Restores 750 HP to the user.`, rule: "Sets direct damage to 0 and heals the caster for a flat 750 HP.", duration: "Instant", value: "750 HP" };
    if (tag.name === "Shield") return { summary: `Adds 750 shield to the user — always succeeds.`, rule: "Shield absorbs incoming damage before HP. Pierce can bypass shield. Cannot be blocked by Buff Prevent.", duration: "Until broken", value: "750" };
    if (tag.name === "Barrier") return { summary: "Erects an impassable wall tile one step toward the enemy on the battlefield.", rule: "Places a barrier tile that blocks movement for both fighters for 2 rounds. Cannot be bypassed.", duration: "2 rounds", value: "Wall tile" };
    if (tag.name === "Increase Damage Given") return { summary: `Increases your ${disc}damage given by ${pct}% for 2 rounds.`, rule: "Adds a positive status to the caster that boosts outgoing damage for 2 rounds.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Decrease Damage Given") return { summary: `Makes the target deal ${pct}% less damage.`, rule: "Adds a negative status to the target that lowers outgoing damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Increase Damage Taken") return { summary: `Makes the target take ${pct}% more ${disc}damage from you.`, rule: "Adds a negative status to the target that raises incoming damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Decrease Damage Taken") return { summary: `Makes the user take ${pct}% less ${disc}damage.`, rule: "Adds a positive status to the caster that lowers incoming damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Absorb") return { summary: `Converts ${pct}% of incoming damage into healing.`, rule: "Adds a positive status to the caster. Buff Prevent can block it.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Siphon") return { summary: `Heals the user for ${pct}% of the ${disc}damage dealt.`, rule: "Triggers after damage. Instant heal based on final damage.", duration: "Instant after hit", value: `${pct}%` };
    if (tag.name === "Lifesteal") return { summary: `Applies a 2-round status: your next 2 attacks heal you for ${pct}% of the ${disc}damage dealt.`, rule: "Adds a positive status to the caster. Each attack heals based on final damage.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Reflect") return { summary: `Reflects ${pct}% damage back at attackers.`, rule: "Adds a positive status to the caster. Buff Prevent can block it.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Recoil") return { summary: `Applies ${pct}% recoil to the target.`, rule: "The target suffers capped recoil damage when they attack.", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Wound") return { summary: `Makes the target bleed for a portion of the ${disc}damage dealt over 2 rounds.`, rule: "Applies a damage-over-time status based on capped post-damage.", duration: "2 rounds", value: `${pct}%` };
    if (tagMatchesName(tag.name, "Ignition")) return { summary: `Ignites the target for 2 rounds — your next 2 hits on them deal an extra ${pct}% ${disc}damage.`, rule: "Adds a negative status to the enemy. Each time they are attacked while ignited, the attacker's damage is boosted by this percent (e.g. 30% ignition turns a 1000 hit into 1300).", duration: "2 rounds", value: `${pct}%` };
    if (tag.name === "Stun") return { summary: `Removes ${STUN_AP_PENALTY} AP from the target's next turn.`, rule: "Always applies unless Stun Prevent or Debuff Prevent blocks it. It does not skip the target's turn.", duration: "Next turn", value: `-${STUN_AP_PENALTY} AP` };
    if (tag.name === "Bloodline Seal" || tag.name === "Seal") return { summary: "Seals the target's bloodline and suppresses their bloodline damage bonus.", rule: "Always applies unless Debuff Prevent blocks it. While sealed, the target's bloodline multiplier is treated as 1.0 in the combat damage formula.", duration: "2 rounds", value: "No bloodline bonus" };
    if (tag.name === "Elemental Seal") return { summary: "Seals elemental jutsu.", rule: "Always applies unless Debuff Prevent blocks it. Prevents elemental jutsu use while active for 1 round.", duration: "1 round", value: "Always" };
    if (tag.name === "Move") return { summary: "Moves the user on the battlefield.", rule: "Always lets the user choose an open tile within the jutsu range.", duration: "Instant", value: "Always" };
    if (tag.name === "Push") return { summary: "Pushes the target away from the user based on jutsu range.", rule: "Moves the enemy away by the jutsu's range value in tiles.", duration: "Instant", value: "Range tiles" };
    if (tag.name === "Pull") return { summary: "Pulls the target toward the user based on jutsu range.", rule: "Moves the enemy toward the user by the jutsu's range value in tiles.", duration: "Instant", value: "Range tiles" };
    if (tag.name === "Buff Prevent") return { summary: "Blocks positive effects on the target.", rule: "Applies a negative status to the target unless Debuff Prevent blocks it. Prevents new positive effects like Shield, Reflect, Absorb, and similar buffs.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Debuff Prevent") return { summary: "Protects the caster from debuffs for 2 rounds.", rule: "Adds a positive status to the caster. Prevents new debuffs like Stun, Bloodline Seal, Poison, Drain from being applied to them.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Cleanse Prevent") return { summary: "Prevents the target from cleansing debuffs.", rule: "Applies a negative status to the target unless Debuff Prevent blocks it. Cleanse attempts are blocked while active.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Clear Prevent") return { summary: "Prevents clear effects.", rule: "Always stops positive effects from being cleared while active.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Stun Prevent") return { summary: "Prevents stun.", rule: "Always protects against incoming Stun.", duration: "2 rounds", value: "Always" };
    if (tag.name === "Poison") return { summary: `Poisons the target — deals ${pct}% of their max chakra as damage each round.`, rule: "Applies a 2-round negative status that deals damage based on the target's chakra pool.", duration: "2 rounds", value: `${pct}% chakra` };
    if (tag.name === "Drain") return { summary: "Drains the target's HP and chakra each round — 50–300, scaling with mastery.", rule: "Applies a 2-round negative status that reduces the target's HP and chakra each round (not stamina); the amount scales with the caster's mastery, from 50 up to 300.", duration: "2 rounds", value: "50–300/round" };
    if (tag.name === "Pierce") return { summary: "True damage — up to 900, scaled by offense + mastery.", rule: "Ignores armor, shields, damage reduction, damage buffs, and damage debuffs. Pierce jutsus must be 60 AP, and you can equip at most one Pierce jutsu in a loadout. At max stats the cap of 900 is always reached.", duration: "Instant", value: "≤900" };
    if (tag.name === "Copy") return { summary: "Copies enemy positive effects.", rule: "Always copies active positive statuses from the target to the user.", duration: "Up to 2 rounds", value: "Always" };
    if (tag.name === "Mirror") return { summary: "Mirrors negative effects back to the enemy.", rule: "Always transfers the user's non-damage-over-time negative statuses to the target.", duration: "Up to 2 rounds", value: "Always" };
    if (tagMatchesName(tag.name, "Lag")) return { summary: "Increases enemy AP costs.", rule: "Always adds a negative status that makes enemy actions cost more AP for 1 round.", duration: "1 round", value: "Always" };
    if (tagMatchesName(tag.name, "Overclock")) return { summary: "Reduces the user's AP costs.", rule: "Always adds a positive status that makes the user's actions cost less AP for 1 round.", duration: "1 round", value: "Always" };
    if (tag.name === "Increase Heal") return { summary: `Increases healing by ${pct}%.`, rule: "Always adds a positive status that boosts future healing and lifesteal by this amount.", duration: "2 rounds", value: `${pct}%` };
    return { summary: tag.name || "Unnamed effect", rule: "Custom effect tag.", duration: "Varies", value: percentLabel };
}

export function jutsuDisplayAtLevel(jutsu: Jutsu, masteryLevel = JUTSU_MAX_LEVEL): Jutsu {
    const scaled = scaleJutsuByLevel(jutsu, masteryLevel);
    return scaleJutsuTagsForDisplay({ ...jutsu, effectPower: scaled.scaledEffectPower }, masteryLevel);
}

export function describeJutsuEffects(jutsu: Jutsu, masteryLevel = JUTSU_MAX_LEVEL, lensDiscipline?: JutsuType) {
    const displayJutsu = jutsuDisplayAtLevel(jutsu, masteryLevel);
    const descriptions = displayJutsu.tags
        .filter((tag) => tag.name)
        .map((tag) => jutsuEffectInfo(displayJutsu, tag, lensDiscipline).summary);

    return descriptions.length ? descriptions.join(" ") : "No special effects.";
}
