/*
 * Starter jutsu + bloodline content catalog.
 *
 *   • starterBloodlines / starterBloodlineOffense — the four starter bloodline
 *     names + their offense discipline
 *   • nonBloodlineTagTable + rebalanceNonBloodlineJutsu — the balanced tag
 *     loadout applied to every starter (non-bloodline) jutsu
 *   • starterJutsus — the full built-in starter jutsu catalog
 *   • starterSavedBloodlines — the four built-in admin bloodlines
 *
 * Built via the lib/jutsu builders; pure content otherwise. Extracted from
 * App.tsx (jutsu cluster, data layer).
 */

import { makeJutsu, normalizeJutsu } from "../lib/jutsu";
import { bloodlinePoints } from "../lib/jutsu-points";
import type { Jutsu, JutsuTag, SavedBloodline } from "../types/combat";
import type { JutsuType, JutsuElement, Rank, JutsuTarget, JutsuMethod } from "../types/core";

// Jutsu taxonomy dropdown options (moved from App.tsx; re-exported there for the
// "../App" import site in components/JutsuDropdownList).
export const specialties: JutsuType[] = ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu", "Any"];
export const jutsuElements: JutsuElement[] = ["Earth", "Wind", "Lightning", "Fire", "Water", "None"];

export const starterBloodlines = ["Ashen Eyes", "Inferno Cataclysm", "Shadow Lotus", "Iron Fang"];

export const starterBloodlineOffense: Record<string, JutsuType> = {
    "Ashen Eyes": "Genjutsu",
    "Inferno Cataclysm": "Ninjutsu",
    "Shadow Lotus": "Bukijutsu",
    "Iron Fang": "Taijutsu",
};

// ── Non-bloodline (starter) balance table ────────────────────────────────
// Variant suffix → AP tier: a 1-tag entry is the 60AP damage variant; a 2-tag
// entry is a 40AP utility pair. These pairs avoid Move and Debuff Prevent;
// the 20AP universal Flicker retains its separate Move role.
const nonBloodlineTagTable: Record<string, string[]> = {
    "starter-nin-earth-1": ["Shield", "Increase Damage Taken"],
    "starter-nin-earth-2": ["Ignition"],
    "starter-nin-earth-3": ["Lifesteal", "Recoil"],
    "starter-nin-wind-1": ["Increase Heal", "Increase Damage Given"],
    "starter-nin-wind-2": ["Recoil"],
    "starter-nin-wind-3": ["Increase Damage Taken", "Poison"],
    "starter-nin-lightning-1": ["Lifesteal", "Increase Damage Given"],
    "starter-nin-lightning-2": ["Wound"],
    "starter-nin-lightning-3": ["Drain", "Poison"],
    "starter-nin-fire-1": ["Shield", "Lifesteal"],
    "starter-nin-fire-2": ["Poison"],
    "starter-nin-fire-3": ["Reflect", "Increase Damage Given"],
    "starter-nin-water-1": ["Lifesteal", "Increase Damage Taken"],
    "starter-nin-water-2": ["Wound"],
    "starter-nin-water-3": ["Recoil", "Ignition"],

    "starter-tai-earth-1": ["Increase Damage Taken", "Ignition"],
    "starter-tai-earth-2": ["Poison"],
    "starter-tai-earth-3": ["Reflect", "Absorb"],
    "starter-tai-wind-1": ["Increase Damage Taken", "Reflect"],
    "starter-tai-wind-2": ["Lifesteal"],
    "starter-tai-wind-3": ["Drain", "Poison"],
    "starter-tai-lightning-1": ["Shield", "Increase Damage Given"],
    "starter-tai-lightning-2": ["Reflect"],
    "starter-tai-lightning-3": ["Lifesteal", "Increase Damage Taken"],
    "starter-tai-fire-1": ["Decrease Damage Taken", "Decrease Damage Given"],
    "starter-tai-fire-2": ["Drain"],
    "starter-tai-fire-3": ["Ignition", "Recoil"],
    "starter-tai-water-1": ["Increase Heal", "Lifesteal"],
    "starter-tai-water-2": ["Increase Damage Given"],
    "starter-tai-water-3": ["Reflect", "Absorb"],

    "starter-gen-earth-1": ["Increase Damage Given", "Decrease Damage Taken"],
    "starter-gen-earth-2": ["Siphon"],
    "starter-gen-earth-3": ["Decrease Damage Given", "Drain"],
    "starter-gen-wind-1": ["Shield", "Absorb"],
    "starter-gen-wind-2": ["Siphon"],
    "starter-gen-wind-3": ["Decrease Damage Given", "Absorb"],
    "starter-gen-lightning-1": ["Absorb", "Drain"],
    "starter-gen-lightning-2": ["Decrease Damage Given"],
    "starter-gen-lightning-3": ["Recoil", "Ignition"],
    "starter-gen-fire-1": ["Increase Heal", "Decrease Damage Taken"],
    "starter-gen-fire-2": ["Siphon"],
    "starter-gen-fire-3": ["Reflect", "Increase Damage Taken"],
    "starter-gen-water-1": ["Increase Damage Given", "Drain"],
    "starter-gen-water-2": ["Poison"],
    "starter-gen-water-3": ["Decrease Damage Given", "Absorb"],

    "starter-buki-earth-1": ["Increase Heal", "Decrease Damage Given"],
    "starter-buki-earth-2": ["Wound"],
    "starter-buki-earth-3": ["Decrease Damage Taken", "Increase Damage Given"],
    "starter-buki-wind-1": ["Ignition", "Recoil"],
    "starter-buki-wind-2": ["Wound"],
    "starter-buki-wind-3": ["Decrease Damage Taken", "Reflect"],
    "starter-buki-lightning-1": ["Increase Heal", "Absorb"],
    "starter-buki-lightning-2": ["Siphon"],
    "starter-buki-lightning-3": ["Decrease Damage Taken", "Decrease Damage Given"],
    "starter-buki-fire-1": ["Poison", "Increase Damage Taken"],
    "starter-buki-fire-2": ["Wound"],
    "starter-buki-fire-3": ["Ignition", "Absorb"],
    "starter-buki-water-1": ["Shield", "Decrease Damage Taken"],
    "starter-buki-water-2": ["Siphon"],
    "starter-buki-water-3": ["Recoil", "Drain"],

    // ── Increase Generals utility set ────────────────────────────────────────
    // One 40-AP self-buff per offense discipline × element (20 total). Each pairs
    // Increase Generals (raises str/spd/int/wil → lifts offense AND defense) with a
    // second self-buff, matching the 2-tag → 40-AP utility convention. Buff-Prevent
    // gated, Clear-able, Bloodline-Seal-suppressed (see api/pvp/move.ts generalsBonus).
    "starter-nin-earth-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-nin-wind-4": ["Increase Generals", "Reflect"],
    "starter-nin-lightning-4": ["Increase Generals", "Increase Damage Given"],
    "starter-nin-fire-4": ["Increase Generals", "Lifesteal"],
    "starter-nin-water-4": ["Increase Generals", "Increase Heal"],
    "starter-tai-earth-4": ["Increase Generals", "Shield"],
    "starter-tai-wind-4": ["Increase Generals", "Reflect"],
    "starter-tai-lightning-4": ["Increase Generals", "Increase Damage Given"],
    "starter-tai-fire-4": ["Increase Generals", "Increase Damage Given"],
    "starter-tai-water-4": ["Increase Generals", "Absorb"],
    "starter-gen-earth-4": ["Increase Generals", "Absorb"],
    "starter-gen-wind-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-gen-lightning-4": ["Increase Generals", "Reflect"],
    "starter-gen-fire-4": ["Increase Generals", "Increase Damage Given"],
    "starter-gen-water-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-buki-earth-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-buki-wind-4": ["Increase Generals", "Increase Damage Given"],
    "starter-buki-lightning-4": ["Increase Generals", "Lifesteal"],
    "starter-buki-fire-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-buki-water-4": ["Increase Generals", "Increase Heal"],
};

// ── Non-bloodline (starter) flavor text ──────────────────────────────────
// Self-contained battle-log + card flavor for every built-in starter jutsu.
// `battle` shows in the battle log (PvE head line + the PvP "uses X:" line);
// `desc` shows on the jutsu inspect card. Token-free on purpose — the log/card
// render these verbatim with no %user/%target substitution, so prose must read
// naturally on its own. Bloodline jutsu are intentionally absent: players write
// their own bloodline flavor in the Bloodline Maker.
const nonBloodlineFlavor: Record<string, { battle: string; desc: string }> = {
    "starter-nin-earth-1": { battle: "Stone needles form a shield around the user and mark the target for later attacks.", desc: "Grants a shield immediately. Starting next round, the target takes more damage for 2 rounds. Deals no direct damage." },
    "starter-nin-earth-2": { battle: "Heavy mud strikes the target and leaves them vulnerable to follow-up hits.", desc: "Deals damage and applies Ignition. Starting next round, hits against the target deal more damage for 2 rounds. It does not stop movement." },
    "starter-nin-earth-3": { battle: "Iron sand prepares the user to steal life and makes the target hurt themselves when attacking.", desc: "Starting next round, your damaging attacks restore HP, and the target takes recoil damage when their attacks deal damage. Both effects last 2 rounds. Deals no direct damage." },
    "starter-nin-wind-1": { battle: "The user draws in a steady wind to strengthen later attacks and healing.", desc: "Starting next round, increases your damage dealt and healing for 2 rounds. Deals no direct damage and does not push the target." },
    "starter-nin-wind-2": { battle: "Cutting winds strike the target and leave their attacks painfully unstable.", desc: "Deals damage. Starting next round, the target takes recoil damage whenever their attacks deal damage, for 2 rounds." },
    "starter-nin-wind-3": { battle: "A net of wind leaves the target vulnerable and poisons their chakra flow.", desc: "Starting next round, the target takes more damage and suffers Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. Deals no direct damage." },
    "starter-nin-lightning-1": { battle: "Lightning gathers around the user, preparing stronger attacks that restore HP.", desc: "Starting next round, increases your damage dealt and lets damaging attacks restore HP for 2 rounds. Deals no direct damage and does not bypass shields." },
    "starter-nin-lightning-2": { battle: "A lightning lance strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound. The bleed starts next round and damages the target at the end of their turn for 2 rounds." },
    "starter-nin-lightning-3": { battle: "A precise jolt poisons the target and disrupts their HP and chakra.", desc: "Starting next round, drains HP and chakra at the end of the target's turns and applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. It does not seal bloodlines. Deals no direct damage." },
    "starter-nin-fire-1": { battle: "Embers form a shield and prepare the user to recover HP from later attacks.", desc: "Grants a shield immediately. Starting next round, your damaging attacks restore HP for 2 rounds. Deals no direct damage and does not apply Ignition." },
    "starter-nin-fire-2": { battle: "Dragon-shaped flames strike the target and poison their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina." },
    "starter-nin-fire-3": { battle: "A swirling ash cloud prepares stronger attacks and reflects incoming damage.", desc: "Starting next round, increases your damage dealt and reflects part of incoming damage for 2 rounds. Deals no direct damage and does not apply Poison." },
    "starter-nin-water-1": { battle: "Water chakra marks the target for stronger hits and prepares the user to recover HP.", desc: "Starting next round, the target takes more damage and your damaging attacks restore HP for 2 rounds. Deals no direct damage and does not bypass shields." },
    "starter-nin-water-2": { battle: "A crashing wave strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound. The bleed starts next round and lasts 2 rounds. It does not stun or hold the target in place." },
    "starter-nin-water-3": { battle: "Mist clings to the target, making later hits stronger and their own attacks painful.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. Hits against them deal more damage, and their damaging attacks cause self-damage. Deals no direct damage." },

    "starter-tai-earth-1": { battle: "Stone chakra marks the target for heavier follow-up hits.", desc: "Starting next round, applies Ignition and Increase Damage Taken to the target for 2 rounds. Both strengthen later hits against them. Deals no direct damage." },
    "starter-tai-earth-2": { battle: "An earth-weighted kick strikes the target and poisons their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina." },
    "starter-tai-earth-3": { battle: "The user braces behind stone chakra to reflect damage and recover HP when hit.", desc: "Starting next round, reflects part of incoming damage and converts part into healing for 2 rounds. Deals no direct damage and does not bypass defenses." },
    "starter-tai-wind-1": { battle: "A feint marks the target for stronger hits as a reflecting gust gathers around the user.", desc: "Starting next round, the target takes more damage and you reflect part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-tai-wind-2": { battle: "A rising combination strikes the target and prepares the user to recover HP from later attacks.", desc: "Deals damage. Starting next round, your damaging attacks restore HP for 2 rounds; the opening hit does not gain Lifesteal from this cast." },
    "starter-tai-wind-3": { battle: "Spiraling wind disrupts the target's HP and chakra and poisons their chakra flow.", desc: "Starting next round, drains the target's HP and chakra at turn end and applies Poison for 2 rounds. Poison damages HP when a jutsu spends resources. Deals no direct damage and does not push the target." },
    "starter-tai-lightning-1": { battle: "Lightning forms a shield around the user and prepares stronger attacks.", desc: "Grants a shield immediately. Starting next round, increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-tai-lightning-2": { battle: "A lightning-charged knee strikes as a reflecting aura gathers around the user.", desc: "Deals damage. Starting next round, reflects part of incoming damage for 2 rounds. It does not stun the target." },
    "starter-tai-lightning-3": { battle: "A counter stance marks the target for stronger hits and prepares the user to steal life.", desc: "Starting next round, the target takes more damage and your damaging attacks restore HP for 2 rounds. Deals no direct damage and does not move the user." },
    "starter-tai-fire-1": { battle: "A controlled flame stance weakens the target's attacks and protects the user.", desc: "Starting next round, reduces the target's damage dealt and your damage taken for 2 rounds. Deals no direct damage and does not apply Ignition." },
    "starter-tai-fire-2": { battle: "A flaming kick strikes the target and disrupts their HP and chakra.", desc: "Deals damage. Starting next round, drains equal HP and chakra from the target at the end of their turns for 2 rounds. It does not apply Recoil." },
    "starter-tai-fire-3": { battle: "Cinders cling to the target, strengthening later hits and punishing their attacks.", desc: "Starting next round, applies Ignition and Recoil for 2 rounds. Hits against the target deal more damage, and their damaging attacks cause self-damage. Deals no direct damage and does not move the user." },
    "starter-tai-water-1": { battle: "The user settles into a flowing stance that strengthens later healing and life-stealing attacks.", desc: "Starting next round, increases your healing and lets damaging attacks restore HP for 2 rounds. Deals no direct damage and does not heal immediately." },
    "starter-tai-water-2": { battle: "A water-powered shoulder strike hits the target and prepares stronger follow-up attacks.", desc: "Deals damage. Starting next round, increases your damage dealt for 2 rounds. It does not move the target or weaken their attacks." },
    "starter-tai-water-3": { battle: "The user takes a rippling stance that reflects damage and converts some into healing.", desc: "Starting next round, reflects part of incoming damage and converts part into healing for 2 rounds. Deals no direct damage; it does not grant a shield or prevent debuffs." },

    "starter-gen-earth-1": { battle: "A stone mirage steadies the user's offense and defense.", desc: "Starting next round, increases your damage dealt and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-gen-earth-2": { battle: "An illusion of crushing earth harms the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt. It does not seal the target's bloodline." },
    "starter-gen-earth-3": { battle: "Illusory dust weakens the target's attacks and disrupts their HP and chakra.", desc: "Starting next round, reduces the target's damage dealt and drains HP and chakra at the end of their turns for 2 rounds. Deals no direct damage and does not apply Poison." },
    "starter-gen-wind-1": { battle: "A whispering wind forms a shield and prepares the user to recover HP when hit.", desc: "Grants a shield immediately. Starting next round, converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-wind-2": { battle: "A cyclone of voices harms the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-gen-wind-3": { battle: "A light-footed illusion weakens the target's attacks and prepares the user to recover HP when hit.", desc: "Starting next round, reduces the target's damage dealt and converts part of incoming damage into healing for 2 rounds. Deals no direct damage and does not move the user." },
    "starter-gen-lightning-1": { battle: "Illusory light disrupts the target's HP and chakra and prepares the user to recover HP when hit.", desc: "Starting next round, drains the target's HP and chakra at turn end and converts part of your incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-lightning-2": { battle: "A phantom stage disrupts the target's attacks.", desc: "Deals damage. Starting next round, reduces the target's damage dealt for 2 rounds. It does not stun them or remove an action." },
    "starter-gen-lightning-3": { battle: "A mirrored illusion makes later hits stronger and the target's attacks painful.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. It does not copy or reflect debuffs. Deals no direct damage." },
    "starter-gen-fire-1": { battle: "Ghostly lanterns steady the user and strengthen later healing.", desc: "Starting next round, increases your healing and reduces your damage taken for 2 rounds. Deals no direct damage and does not apply Ignition." },
    "starter-gen-fire-2": { battle: "Phantom flames harm the target and restore HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-gen-fire-3": { battle: "An ash-grey illusion leaves the target vulnerable as a reflecting veil gathers around the user.", desc: "Starting next round, the target takes more damage and you reflect part of incoming damage for 2 rounds. Deals no direct damage and does not block buffs." },
    "starter-gen-water-1": { battle: "A drowning illusion drains the target while preparing stronger attacks for the user.", desc: "Starting next round, increases your damage dealt and drains the target's HP and chakra at the end of their turns for 2 rounds. Deals no direct damage." },
    "starter-gen-water-2": { battle: "A moonlit nightmare harms the target and poisons their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina. It does not reduce incoming damage." },
    "starter-gen-water-3": { battle: "Illusory mist weakens the target's attacks and prepares the user to recover HP when hit.", desc: "Starting next round, reduces the target's damage dealt and converts part of incoming damage into healing for 2 rounds. Deals no direct damage and does not prevent Cleanse." },

    "starter-buki-earth-1": { battle: "Stone kunai disrupt the target's offense as the user prepares stronger healing.", desc: "Starting next round, reduces the target's damage dealt and increases your healing for 2 rounds. Deals no direct damage and does not pin the target in place." },
    "starter-buki-earth-2": { battle: "An adamant chain strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound for 2 rounds, starting next round. It does not pull or move the target." },
    "starter-buki-earth-3": { battle: "The user coats their weapon in obsidian chakra to strengthen offense and defense.", desc: "Starting next round, increases your damage dealt and reduces your damage taken for 2 rounds. Deals no direct damage and does not bypass shields or armor." },
    "starter-buki-wind-1": { battle: "Windmill shuriken mark the target for stronger hits and painful recoil.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. Deals no direct damage and does not apply Wound." },
    "starter-buki-wind-2": { battle: "A fan of blades strikes the target and opens bleeding wounds.", desc: "Deals damage and applies Wound for 2 rounds, starting next round." },
    "starter-buki-wind-3": { battle: "A crosswind gathers around the user to reduce and reflect incoming damage.", desc: "Starting next round, reduces your damage taken and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-buki-lightning-1": { battle: "Charged needles prepare the user for stronger healing and recovery when hit.", desc: "Starting next round, increases your healing and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-buki-lightning-2": { battle: "Charged wire strikes the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt. It does not stun the target or place a ground trap." },
    "starter-buki-lightning-3": { battle: "A magnetized blade disrupts the target's offense as the user braces for incoming attacks.", desc: "Starting next round, reduces the target's damage dealt and your damage taken for 2 rounds. Deals no direct damage and does not reflect damage." },
    "starter-buki-fire-1": { battle: "An explosive seal marks the target for stronger hits and poisons their chakra flow.", desc: "Starting next round, the target takes more damage and suffers Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. Deals no direct damage and does not move the user." },
    "starter-buki-fire-2": { battle: "Burning wire detonates against the target and opens a bleeding wound.", desc: "Deals damage and applies Wound for 2 rounds, starting next round." },
    "starter-buki-fire-3": { battle: "A heated blade marks the target for stronger hits as a protective aura gathers around the user.", desc: "Starting next round, applies Ignition to the target and converts part of your incoming damage into healing for 2 rounds. Deals no direct damage and does not apply Poison." },
    "starter-buki-water-1": { battle: "Mist and needles form a protective screen around the user.", desc: "Grants a shield immediately. Starting next round, reduces your damage taken for 2 rounds. Deals no direct damage and does not drain the target." },
    "starter-buki-water-2": { battle: "A water-wreathed chain strikes the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-buki-water-3": { battle: "A hidden current disrupts the target's HP and chakra and makes their attacks painful.", desc: "Starting next round, drains the target's HP and chakra at turn end and applies Recoil for 2 rounds. Deals no direct damage; Recoil hurts the target when their attacks deal damage." },

    // ── Increase Generals utility set flavor ──
    "starter-nin-earth-4": { battle: "The user roots their chakra deep into the earth, steeling every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-nin-wind-4": { battle: "The user breathes with the wind, sharpening body and mind in one gust.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-nin-lightning-4": { battle: "Lightning courses through the user's coils, electrifying every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-nin-fire-4": { battle: "The user stokes an inner ember, warming strength, speed, wit and will.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and lets your damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-nin-water-4": { battle: "The user draws a cleansing tide inward, renewing every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your healing for 2 rounds. Deals no direct damage." },
    "starter-tai-earth-4": { battle: "The user sets their stance like bedrock, tempering every attribute.", desc: "Grants a shield immediately. Starting next round, raises your strength, speed, intelligence, and willpower for 2 rounds. Deals no direct damage." },
    "starter-tai-wind-4": { battle: "The user exhales and rises light as wind, keen in every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-tai-lightning-4": { battle: "A thunderous pulse floods the user's muscles, spiking every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-tai-fire-4": { battle: "The user's spirit blazes up, firing strength, speed, wit and will.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-tai-water-4": { battle: "The user settles into a flowing calm, balancing every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-earth-4": { battle: "The user sinks into a stone-still trance, fortifying every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-wind-4": { battle: "A whispering calm hones every attribute and steadies the user against incoming blows.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-gen-lightning-4": { battle: "The user's thoughts crackle like a storm, charging every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-gen-fire-4": { battle: "The user conjures an inner flame that burns strength, speed, wit and will higher.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-gen-water-4": { battle: "The user's mind stills like deep water, steadying every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-buki-earth-4": { battle: "The user plants an adamant stance, tempering every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-buki-wind-4": { battle: "The user's blade sings on the wind, quickening every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-buki-lightning-4": { battle: "The user's grip crackles with charge, keying up every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and lets your damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-buki-fire-4": { battle: "The user tempers themselves in an inner forge, hardening every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-buki-water-4": { battle: "The user's edge ripples like water, refining every attribute.", desc: "Starting next round, raises your strength, speed, intelligence, and willpower and increases your healing for 2 rounds. Deals no direct damage." },
};

// Flat-value or binary tags carry no percent; every other starter tag uses the
// uniform 30% creator value (which displays as 20% at mastery 0) — except Poison,
// whose percent is a potency on its own lower scale (HP lost per cast = spend ×
// potency × 12). At the uniform 30 every starter poison hit at the old bloodline
// tier, ~13% of max HP per 60-AP cast; 10 is the basic Poison ceiling
// (POISON_CAP_BY_RANK in api/combat-core/formulas.ts).
function nonBloodlineTagPercent(name: string): number {
    if (name === "Move" || name === "Shield" || name === "Drain") return 0;
    if (name === "Poison") return 10;
    return 30;
}

export function rebalanceNonBloodlineJutsu(jutsu: Jutsu): Jutsu {
    const normalized = normalizeJutsu(jutsu);
    const tagNames = nonBloodlineTagTable[normalized.id];
    if (!tagNames) return normalized; // Flicker + any off-table jutsu untouched
    const ap = tagNames.length === 1 ? 60 : 40; // 1 tag = 60AP damage, 2 = 40AP utility
    const tags = tagNames.map((name) => ({ name, percent: nonBloodlineTagPercent(name) }));
    const isMove = tagNames.includes("Move");
    const flavor = nonBloodlineFlavor[normalized.id];

    return normalizeJutsu({
        ...normalized,
        ap,
        range: isMove ? normalized.range : 4,
        // Whispering Calm now has only caster buffs, so its targeting must match.
        target: normalized.id === "starter-gen-wind-4" ? "SELF" : normalized.target,
        cooldown: 7,
        effectPower: ap === 60 ? 36 : 0,
        chakraCost: ap === 60 ? 250 : 125,
        staminaCost: ap === 60 ? 250 : 125,
        tags,
        // Attach the built-in flavor (battle-log line + card description). Off-table
        // jutsu keep normalizeJutsu's generic default.
        ...(flavor ? { battleDescription: flavor.battle, description: flavor.desc } : {}),
    });
}

// NOTE: for every id listed in `nonBloodlineTagTable` above, the TABLE owns the
// tags — and also the AP, range, cooldown, effect power and resource costs, all
// rewritten by `rebalanceNonBloodlineJutsu` below. Only id / name / type /
// element survive from these constructor calls, so the tag argument is `[]`
// rather than a value that reads authoritative and is discarded. It used to
// carry real-looking tags that disagreed with the table on 78 of 80 entries
// ("Mud Coffin Bind" declared Stun and cast Ignition), which is how a stale
// Overclock on Hollow Voice Cyclone survived unnoticed. The off-table entries
// below (the AOE_BURST set and Flicker) use normalizeJutsu directly and their
// tags ARE live.
export const starterJutsus: Jutsu[] = [
    // All jutsus: stored EP=28 (base). PvP/PvE scales +0.2 per mastery level ? EP 38 at mastery 50. Tags stored at 30% ? displays as 20% at mastery 0 via effectiveTagPercent.
    makeJutsu("starter-nin-earth-1", "Stone Needle Volley", "Ninjutsu", 60, 4, 28, 1, 125, 125, [], "Earth"),
    makeJutsu("starter-nin-earth-2", "Mud Coffin Bind", "Ninjutsu", 60, 3, 30, 3, 250, 250, [], "Earth"),
    makeJutsu("starter-nin-earth-3", "Iron Sand Burst", "Ninjutsu", 40, 3, 27, 2, 125, 125, [], "Earth"),
    makeJutsu("starter-nin-wind-1", "Vacuum Palm Wave", "Ninjutsu", 40, 5, 20, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-nin-wind-2", "Cyclone Cutter", "Ninjutsu", 60, 5, 30, 2, 250, 250, [], "Wind"),
    makeJutsu("starter-nin-wind-3", "Gale Net Snare", "Ninjutsu", 40, 4, 18, 2, 125, 125, [], "Wind"),
    makeJutsu("starter-nin-lightning-1", "Static Fang", "Ninjutsu", 40, 4, 35, 1, 125, 125, [], "Lightning"),
    makeJutsu("starter-nin-lightning-2", "Thunderclap Lance", "Ninjutsu", 60, 5, 30, 2, 250, 250, [], "Lightning"),
    makeJutsu("starter-nin-lightning-3", "Nerve Spark Seal", "Ninjutsu", 60, 3, 30, 3, 250, 250, [], "Lightning"),
    makeJutsu("starter-nin-fire-1", "Cinder Shot", "Ninjutsu", 40, 4, 25, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-nin-fire-2", "Blazing Dragon Arc", "Ninjutsu", 60, 5, 30, 2, 250, 250, [], "Fire"),
    makeJutsu("starter-nin-fire-3", "Ash Cloud Breaker", "Ninjutsu", 40, 3, 23, 2, 125, 125, [], "Fire"),
    makeJutsu("starter-nin-water-1", "Tide Spear", "Ninjutsu", 40, 4, 33, 1, 125, 125, [], "Water"),
    makeJutsu("starter-nin-water-2", "Crashing Wave Prison", "Ninjutsu", 60, 3, 30, 3, 250, 250, [], "Water"),
    makeJutsu("starter-nin-water-3", "Mist Veil Flow", "Ninjutsu", 40, 0, 0, 2, 125, 125, [], "Water"),

    makeJutsu("starter-tai-earth-1", "Granite Elbow", "Taijutsu", 40, 1, 35, 1, 125, 125, [], "Earth"),
    makeJutsu("starter-tai-earth-2", "Boulder Heel Drop", "Taijutsu", 60, 1, 30, 2, 250, 250, [], "Earth"),
    makeJutsu("starter-tai-earth-3", "Rooted Guard Break", "Taijutsu", 60, 1, 26, 2, 125, 125, [], "Earth"),
    makeJutsu("starter-tai-wind-1", "Tempest Step Kick", "Taijutsu", 40, 2, 20, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-tai-wind-2", "Rising Gale Combo", "Taijutsu", 60, 1, 30, 2, 250, 250, [], "Wind"),
    makeJutsu("starter-tai-wind-3", "Spiral Backfist", "Taijutsu", 40, 1, 21, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-tai-lightning-1", "Spark Jab Chain", "Taijutsu", 40, 1, 33, 1, 125, 125, [], "Lightning"),
    makeJutsu("starter-tai-lightning-2", "Raikou Knee Strike", "Taijutsu", 60, 1, 30, 2, 250, 250, [], "Lightning"),
    makeJutsu("starter-tai-lightning-3", "Flash Step Counter", "Taijutsu", 40, 1, 0, 3, 125, 125, [], "Lightning"),
    makeJutsu("starter-tai-fire-1", "Burning Knuckle", "Taijutsu", 40, 1, 25, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-tai-fire-2", "Meteor Axe Kick", "Taijutsu", 60, 1, 30, 2, 250, 250, [], "Fire"),
    makeJutsu("starter-tai-fire-3", "Cinder Rush", "Taijutsu", 40, 2, 26, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-tai-water-1", "Flowing Palm", "Taijutsu", 40, 1, 28, 1, 125, 125, [], "Water"),
    makeJutsu("starter-tai-water-2", "Tidal Shoulder Throw", "Taijutsu", 60, 1, 30, 2, 250, 250, [], "Water"),
    makeJutsu("starter-tai-water-3", "Ripple Guard Form", "Taijutsu", 40, 0, 0, 2, 125, 125, [], "Water"),

    makeJutsu("starter-gen-earth-1", "Stone Eye Mirage", "Genjutsu", 40, 4, 18, 2, 125, 125, [], "Earth"),
    makeJutsu("starter-gen-earth-2", "Buried Memory Field", "Genjutsu", 60, 4, 30, 3, 250, 250, [], "Earth"),
    makeJutsu("starter-gen-earth-3", "Dust Puppet Vision", "Genjutsu", 40, 3, 24, 1, 125, 125, [], "Earth"),
    makeJutsu("starter-gen-wind-1", "Whispering Gale", "Genjutsu", 40, 5, 21, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-gen-wind-2", "Hollow Voice Cyclone", "Genjutsu", 60, 5, 30, 2, 250, 250, [], "Wind"),
    makeJutsu("starter-gen-wind-3", "Feather Step Illusion", "Genjutsu", 40, 0, 0, 2, 125, 125, [], "Wind"),
    makeJutsu("starter-gen-lightning-1", "Neural Flash", "Genjutsu", 40, 4, 32, 1, 125, 125, [], "Lightning"),
    makeJutsu("starter-gen-lightning-2", "Paralysis Theater", "Genjutsu", 60, 4, 30, 3, 250, 250, [], "Lightning"),
    makeJutsu("starter-gen-lightning-3", "Mirror Spark Dream", "Genjutsu", 40, 0, 0, 3, 125, 125, [], "Lightning"),
    makeJutsu("starter-gen-fire-1", "Lantern Fear", "Genjutsu", 40, 4, 24, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-gen-fire-2", "Inferno Hallucination", "Genjutsu", 60, 4, 30, 2, 250, 250, [], "Fire"),
    makeJutsu("starter-gen-fire-3", "Ashen Mind Lock", "Genjutsu", 40, 3, 18, 2, 125, 125, [], "Fire"),
    makeJutsu("starter-gen-water-1", "Drowning Reflection", "Genjutsu", 40, 4, 23, 1, 125, 125, [], "Water"),
    makeJutsu("starter-gen-water-2", "Moonlit Tide Dream", "Genjutsu", 60, 4, 30, 2, 250, 250, [], "Water"),
    makeJutsu("starter-gen-water-3", "Mist Memory Snare", "Genjutsu", 40, 4, 20, 2, 125, 125, [], "Water"),

    makeJutsu("starter-buki-earth-1", "Stone Kunai Rain", "Bukijutsu", 40, 4, 32, 1, 125, 125, [], "Earth"),
    makeJutsu("starter-buki-earth-2", "Adamant Chain Pull", "Bukijutsu", 60, 4, 30, 2, 250, 250, [], "Earth"),
    makeJutsu("starter-buki-earth-3", "Obsidian Edge", "Bukijutsu", 60, 2, 26, 1, 125, 125, [], "Earth"),
    makeJutsu("starter-buki-wind-1", "Windmill Shuriken Line", "Bukijutsu", 40, 5, 27, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-buki-wind-2", "Aerial Blade Fan", "Bukijutsu", 60, 5, 30, 2, 250, 250, [], "Wind"),
    makeJutsu("starter-buki-wind-3", "Crosswind Needle", "Bukijutsu", 40, 5, 22, 1, 125, 125, [], "Wind"),
    makeJutsu("starter-buki-lightning-1", "Charged Senbon", "Bukijutsu", 40, 5, 35, 1, 125, 125, [], "Lightning"),
    makeJutsu("starter-buki-lightning-2", "Thunder Wire Trap", "Bukijutsu", 60, 4, 30, 3, 250, 250, [], "Lightning"),
    makeJutsu("starter-buki-lightning-3", "Magnet Blade Return", "Bukijutsu", 40, 4, 22, 2, 125, 125, [], "Lightning"),
    makeJutsu("starter-buki-fire-1", "Explosive Tag Flicker", "Bukijutsu", 40, 4, 25, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-buki-fire-2", "Flame Wire Detonation", "Bukijutsu", 60, 4, 30, 2, 250, 250, [], "Fire"),
    makeJutsu("starter-buki-fire-3", "Searing Blade Toss", "Bukijutsu", 40, 3, 23, 1, 125, 125, [], "Fire"),
    makeJutsu("starter-buki-water-1", "Mist Needle Spread", "Bukijutsu", 40, 5, 24, 1, 125, 125, [], "Water"),
    makeJutsu("starter-buki-water-2", "Torrent Chain Slash", "Bukijutsu", 60, 4, 30, 2, 250, 250, [], "Water"),
    makeJutsu("starter-buki-water-3", "Hidden Current Guard", "Bukijutsu", 40, 0, 0, 2, 125, 125, [], "Water"),

    // Increase Generals utility set — 40-AP self-buff, one per discipline × element.
    // The second tag is added by rebalanceNonBloodlineJutsu from nonBloodlineTagTable.
    makeJutsu("starter-nin-earth-4", "Bedrock Chakra Focus", "Ninjutsu", 40, 4, 0, 7, 125, 125, [], "Earth"),
    makeJutsu("starter-nin-wind-4", "Galewind Attunement", "Ninjutsu", 40, 4, 0, 7, 125, 125, [], "Wind"),
    makeJutsu("starter-nin-lightning-4", "Voltaic Surge Focus", "Ninjutsu", 40, 4, 0, 7, 125, 125, [], "Lightning"),
    makeJutsu("starter-nin-fire-4", "Emberheart Kindling", "Ninjutsu", 40, 4, 0, 7, 125, 125, [], "Fire"),
    makeJutsu("starter-nin-water-4", "Tidal Renewal Rite", "Ninjutsu", 40, 4, 0, 7, 125, 125, [], "Water"),
    makeJutsu("starter-tai-earth-4", "Ironbody Conditioning", "Taijutsu", 40, 4, 0, 7, 125, 125, [], "Earth"),
    makeJutsu("starter-tai-wind-4", "Windstep Awakening", "Taijutsu", 40, 4, 0, 7, 125, 125, [], "Wind"),
    makeJutsu("starter-tai-lightning-4", "Thunderpulse Overdrive", "Taijutsu", 40, 4, 0, 7, 125, 125, [], "Lightning"),
    makeJutsu("starter-tai-fire-4", "Blazing Spirit Focus", "Taijutsu", 40, 4, 0, 7, 125, 125, [], "Fire"),
    makeJutsu("starter-tai-water-4", "Flowing Chi Harmony", "Taijutsu", 40, 4, 0, 7, 125, 125, [], "Water"),
    makeJutsu("starter-gen-earth-4", "Stoneheart Meditation", "Genjutsu", 40, 4, 0, 7, 125, 125, [], "Earth"),
    makeJutsu("starter-gen-wind-4", "Whispering Calm", "Genjutsu", 40, 4, 0, 7, 125, 125, [], "Wind"),
    makeJutsu("starter-gen-lightning-4", "Stormmind Focus", "Genjutsu", 40, 4, 0, 7, 125, 125, [], "Lightning"),
    makeJutsu("starter-gen-fire-4", "Inner Flame Vision", "Genjutsu", 40, 4, 0, 7, 125, 125, [], "Fire"),
    makeJutsu("starter-gen-water-4", "Still Water Mind", "Genjutsu", 40, 4, 0, 7, 125, 125, [], "Water"),
    makeJutsu("starter-buki-earth-4", "Adamant Stance Drill", "Bukijutsu", 40, 4, 0, 7, 125, 125, [], "Earth"),
    makeJutsu("starter-buki-wind-4", "Swiftblade Attunement", "Bukijutsu", 40, 4, 0, 7, 125, 125, [], "Wind"),
    makeJutsu("starter-buki-lightning-4", "Charged Grip Focus", "Bukijutsu", 40, 4, 0, 7, 125, 125, [], "Lightning"),
    makeJutsu("starter-buki-fire-4", "Forgeheart Temper", "Bukijutsu", 40, 4, 0, 7, 125, 125, [], "Fire"),
    makeJutsu("starter-buki-water-4", "Rippling Edge Ritual", "Bukijutsu", 40, 4, 0, 7, 125, 125, [], "Water"),

    // AOE Burst set — 60-AP OPPONENT-targeted damage jutsu, one per discipline × element.
    // method AOE_BURST: full damage to the target + every enemy in the 6 touching hexes (no
    // movement, no ground tile). Defined via normalizeJutsu (makeJutsu can't set a method)
    // and NOT listed in nonBloodlineTagTable, so rebalanceNonBloodlineJutsu passes them
    // through unchanged. Each carries ONE combat tag (like the other 60-AP damage jutsu),
    // which applies to the primary AND every splashed enemy via applyAoeSplash.
    normalizeJutsu({ id: "starter-nin-earth-aoe", name: "Seismic Shatter", type: "Ninjutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "The ground erupts beneath the enemy in a shattering seismic burst.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds." }),
    normalizeJutsu({ id: "starter-nin-wind-aoe", name: "Vacuum Detonation", type: "Ninjutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 25 }], battleDescription: "A compressed sphere of air implodes and detonates in a concussive burst.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-nin-lightning-aoe", name: "Forked Lightning Nova", type: "Ninjutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 25 }], battleDescription: "Lightning splits into a dozen forks and erupts across the battlefield.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-nin-fire-aoe", name: "Great Fireball Burst", type: "Ninjutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 25 }], battleDescription: "A massive fireball detonates on impact, engulfing the enemy and their surroundings.", description: "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds." }),
    normalizeJutsu({ id: "starter-nin-water-aoe", name: "Tidal Crash", type: "Ninjutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Drain", percent: 0 }], battleDescription: "A towering wave crashes down and floods the ground in a violent burst.", description: "Damages the target and adjacent enemies. Starting next round, drains their HP and chakra at the end of their turns for 2 rounds." }),
    normalizeJutsu({ id: "starter-tai-earth-aoe", name: "Fault Line Stomp", type: "Taijutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Recoil", percent: 12 }], battleDescription: "A thunderous stomp splits the earth in a shockwave of stone.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies take recoil damage when their attacks deal damage, for 2 rounds." }),
    normalizeJutsu({ id: "starter-tai-wind-aoe", name: "Whirlwind Sweep", type: "Taijutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 25 }], battleDescription: "The user spins into a whirlwind that batters everyone in reach.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-tai-lightning-aoe", name: "Thunderclap Shockwave", type: "Taijutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 25 }], battleDescription: "A lightning-charged clap unleashes a shockwave across the field.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-tai-fire-aoe", name: "Blazing Spin Kick", type: "Taijutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 25 }], battleDescription: "A blazing spin kick trails fire in a scorching arc.", description: "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds." }),
    normalizeJutsu({ id: "starter-tai-water-aoe", name: "Surging Wave Palm", type: "Taijutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Siphon", percent: 25 }], battleDescription: "A surge of water bursts from the user's palm in a crashing arc.", description: "Damages the target and adjacent enemies and immediately heals you for part of the damage dealt." }),
    normalizeJutsu({ id: "starter-gen-earth-aoe", name: "Crumbling World Illusion", type: "Genjutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Poison", percent: 5 }], battleDescription: "The world seems to crumble as the earth swallows the enemy's mind.", description: "Damages the target and adjacent enemies. Starting next round, applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina." }),
    normalizeJutsu({ id: "starter-gen-wind-aoe", name: "Screaming Void", type: "Genjutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 25 }], battleDescription: "A howling void tears open, screaming through the enemy's senses.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-gen-lightning-aoe", name: "Blinding Flash Field", type: "Genjutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 25 }], battleDescription: "A blinding sheet of light detonates across the battlefield.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-gen-fire-aoe", name: "Hellfire Mirage", type: "Genjutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 14 }], battleDescription: "Phantom hellfire erupts and consumes the enemy's world.", description: "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds." }),
    normalizeJutsu({ id: "starter-gen-water-aoe", name: "Drowning Delusion", type: "Genjutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Drain", percent: 0 }], battleDescription: "A crushing tide of illusion drags the enemy under.", description: "Damages the target and adjacent enemies. Starting next round, drains their HP and chakra at the end of their turns for 2 rounds." }),
    normalizeJutsu({ id: "starter-buki-earth-aoe", name: "Stone Shrapnel Burst", type: "Bukijutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "A packed charge bursts into a hail of stone shrapnel.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds." }),
    normalizeJutsu({ id: "starter-buki-wind-aoe", name: "Fan Blade Storm", type: "Bukijutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "A storm of wind-borne blades fans out across the field.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds." }),
    normalizeJutsu({ id: "starter-buki-lightning-aoe", name: "Charged Shuriken Spread", type: "Bukijutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 25 }], battleDescription: "A fan of charged shuriken scatters and crackles on impact.", description: "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds." }),
    normalizeJutsu({ id: "starter-buki-fire-aoe", name: "Explosive Tag Barrage", type: "Bukijutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 25 }], battleDescription: "A barrage of explosive tags detonates in a chain of blasts.", description: "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds." }),
    normalizeJutsu({ id: "starter-buki-water-aoe", name: "Mist Blade Torrent", type: "Bukijutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Poison", percent: 5 }], battleDescription: "A torrent of mist-wreathed blades sweeps across the enemy.", description: "Damages the target and adjacent enemies. Starting next round, applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina." }),

    // Universal jutsus — no element, available to all
    normalizeJutsu({
        id: "starter-universal-flicker",
        name: "Flicker",
        type: "Taijutsu",
        element: "None",
        ap: 20,
        range: 5,
        effectPower: 1,
        cooldown: 2,
        chakraCost: 25,
        staminaCost: 25,
        target: "EMPTY_GROUND",
        method: "SINGLE",
        tags: [{ name: "Move", percent: 0 }],
        battleDescription: "The user vanishes and reappears on a nearby open tile.",
        description: "A short-range body flicker that repositions the user in an instant.",
    }),
].map(rebalanceNonBloodlineJutsu);

function makeStarterBloodlineDamageJutsu(id: string, name: string, type: JutsuType, element: string, secondaryTag: JutsuTag, battleDescription: string, description: string): Jutsu {
    return { ...makeJutsu(id, name, type, 60, 4, 30, 7, 100, 100, [secondaryTag], element as JutsuElement), battleDescription, description };
}

function makeStarterBloodlineUtilityJutsu(id: string, name: string, type: JutsuType, element: string, tags: JutsuTag[], battleDescription: string, description: string): Jutsu {
    return { ...makeJutsu(id, name, type, 40, 4, 0, 7, 100, 100, tags, element as JutsuElement), battleDescription, description };
}

export const starterSavedBloodlines: SavedBloodline[] = [
    {
        id: "starter-bloodline-ashen-eyes",
        name: "Ashen Eyes",
        rank: "A Rank" as Rank,
        specialElement: "Blood",
        image: "/bloodline-ashen-eyes.webp",
        lore: "A cursed kekkei genkai born from a clan that broke a forbidden pact with blood spirits. Those awakened by the Ashen Eyes see the world through a veil of crimson — perceiving every living being as a tapestry of veins and chakra pathways. The afflicted can shatter hallucinations directly into their opponent's bloodstream, weaponizing the very sight of life itself. Ancient texts warn that prolonged use slowly turns the user's own eyes the color of ash and bone.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("ashen-eyes-blood-gaze", "Blood Gaze Rupture", "Genjutsu", "Blood", { name: "Wound", percent: 30 }, "Ashen Eyes rupture %target's chakra veins.", "Damages the target and applies Wound. The bleed starts next round and lasts 2 rounds."),
            makeStarterBloodlineDamageJutsu("ashen-eyes-crimson-hall", "Crimson Hallucination", "Genjutsu", "Blood", { name: "Increase Damage Taken", percent: 35 }, "%target wanders a blood-red nightmare.", "Damages the target. Starting next round, the target takes more damage for 2 rounds."),
            makeStarterBloodlineDamageJutsu("ashen-eyes-vein-mirror", "Vein Mirror Nightmare", "Genjutsu", "Blood", { name: "Poison", percent: 12 }, "A crimson illusion strikes %target and poisons their chakra flow.", "Damages the target and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina."),
            makeStarterBloodlineUtilityJutsu("ashen-eyes-hematoma-veil", "Hematoma Veil", "Genjutsu", "Blood", [{ name: "Increase Damage Taken", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }], "A bruised veil weakens %target's senses.", "Starting next round, the target takes more damage and deals less damage for 2 rounds. Deals no direct damage."),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-inferno-cataclysm",
        name: "Inferno Cataclysm",
        rank: "A Rank" as Rank,
        specialElement: "Lava",
        image: "/bloodline-inferno-cataclysm.webp",
        lore: "Forged in the volcanic rifts of the Ember Wastes, the Inferno Cataclysm lineage merges fire and earth chakra at the cellular level. The wielder's body temperature runs far above human limits — surface veins glow faintly orange in darkness. In battle, they can compress molten rock and superheated gas into devastating projectiles or coffin-like formations that entomb the enemy in cooling lava. Survivors of their attacks are found encased in obsidian, preserved like dark statues.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-lava-burst", "Lava Burst Coffin", "Ninjutsu", "Lava", { name: "Ignition", percent: 30 }, "Molten stone entombs %target.", "Damages the target and applies Ignition. Starting next round, hits against the target deal more damage for 2 rounds."),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-molten-rain", "Molten Rainfall", "Ninjutsu", "Lava", { name: "Increase Damage Given", percent: 35 }, "Glowing slag rains over %target.", "Damages the target. Starting next round, increases your damage dealt for 2 rounds."),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-crater-lance", "Crater Lance", "Ninjutsu", "Lava", { name: "Wound", percent: 30 }, "A lava lance tears through %target.", "Damages the target and applies Wound. The bleed starts next round and lasts 2 rounds."),
            makeStarterBloodlineUtilityJutsu("inferno-cataclysm-obsidian-afterglow", "Obsidian Afterglow", "Ninjutsu", "Lava", [{ name: "Ignition", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }], "Obsidian glare scorches %target.", "Starting next round, applies Ignition and reduces the target's damage dealt for 2 rounds. Ignition strengthens later hits against them. Deals no direct damage."),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-shadow-lotus",
        name: "Shadow Lotus",
        rank: "A Rank" as Rank,
        specialElement: "Shadow",
        image: "/bloodline-shadow-lotus-v2.webp",
        lore: "Descended from a sect of bukijutsu assassins who trained in perpetual darkness for generations, the Shadow Lotus bloodline channels shadow-natured chakra through weapons and thrown implements. Their techniques bloom like deadly flowers from the dark — blades that trail shadow-ribbons, senbon that multiply in dim light, and wires that vanish entirely in low visibility. Their clan temple has no lanterns. They say the darkness learned to fear them first.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("shadow-lotus-umbra-senbon", "Umbra Senbon Bloom", "Bukijutsu", "Shadow", { name: "Poison", percent: 12 }, "Shadow senbon poison %target.", "Damages the target and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina."),
            makeStarterBloodlineDamageJutsu("shadow-lotus-night-petal", "Night Petal Cutter", "Bukijutsu", "Shadow", { name: "Decrease Damage Taken", percent: 35 }, "A night-petal blade carves %target.", "Damages the target. Starting next round, reduces your damage taken for 2 rounds."),
            makeStarterBloodlineDamageJutsu("shadow-lotus-eclipse-wire", "Eclipse Wire Blossom", "Bukijutsu", "Shadow", { name: "Absorb", percent: 35 }, "Eclipse wire binds %target's force.", "Damages the target. Starting next round, converts part of your incoming damage into healing for 2 rounds."),
            makeStarterBloodlineUtilityJutsu("shadow-lotus-black-petal-guard", "Black Petal Guard", "Bukijutsu", "Shadow", [{ name: "Decrease Damage Taken", percent: 30 }, { name: "Absorb", percent: 30 }], "Black petals gather around %user to reduce damage and restore HP when hit.", "Starting next round, reduces your damage taken and converts part of incoming damage into healing for 2 rounds. Deals no direct damage."),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-iron-fang",
        name: "Iron Fang",
        rank: "A Rank" as Rank,
        specialElement: "Iron",
        image: "/bloodline-iron-fang.webp",
        lore: "A taijutsu bloodline born from miners who fused raw metallic chakra into their fighting style over ten generations. Iron Fang users can coat their limbs in magnetized iron-dense chakra, turning every punch and kick into a shattering impact that tears armor and breaks weapons. Their fists leave cracked stone. Some high-level users develop iron-grey patches on their knuckles, shins, and forearms — natural battle plating grown from within. The clan motto: 'The mountain doesn't dodge. It endures. Then it falls on you.'",
        jutsus: [
            makeStarterBloodlineDamageJutsu("iron-fang-ferrous-crash", "Ferrous Fang Crash", "Taijutsu", "Iron", { name: "Wound", percent: 30 }, "An iron fist shatters %target's stance.", "Damages the target and applies Wound. The bleed starts next round and lasts 2 rounds."),
            makeStarterBloodlineDamageJutsu("iron-fang-steel-maw", "Steel Maw Breaker", "Taijutsu", "Iron", { name: "Increase Damage Given", percent: 35 }, "Iron-chakra jaws clamp %target.", "Damages the target. Starting next round, increases your damage dealt for 2 rounds."),
            makeStarterBloodlineDamageJutsu("iron-fang-magnet-knuckle", "Magnet Knuckle Rend", "Taijutsu", "Iron", { name: "Decrease Damage Taken", percent: 35 }, "A magnetized knuckle rends %target.", "Damages the target. Starting next round, reduces your damage taken for 2 rounds."),
            makeStarterBloodlineUtilityJutsu("iron-fang-anvil-breath", "Anvil Breath Guard", "Taijutsu", "Iron", [{ name: "Increase Damage Given", percent: 30 }, { name: "Decrease Damage Taken", percent: 30 }], "Iron dust hardens around %user, strengthening offense and defense.", "Starting next round, increases your damage dealt and reduces your damage taken for 2 rounds. Deals no direct damage."),
        ],
        totalPoints: 9,
    },
].map((bloodline) => ({ ...bloodline, totalPoints: bloodlinePoints(bloodline.jutsus, bloodline.rank) }));

/**
 * Every id the game itself defines: the starter catalog plus the four built-in
 * bloodlines' techniques. Used to stop an ADMIN-authored copy of one of these
 * ids from overriding the real definition in client-side lists — see
 * `mergeDisplayJutsu` in lib/jutsu.ts for why that matters.
 */
export const builtInJutsuIds: ReadonlySet<string> = new Set([
    ...starterJutsus.map((jutsu) => jutsu.id),
    ...starterSavedBloodlines.flatMap((bloodline) => bloodline.jutsus.map((jutsu) => jutsu.id)),
]);

export const jutsuTargets: JutsuTarget[] = ["OPPONENT", "SELF", "OTHER_USER", "CHARACTER", "EMPTY_GROUND"];
export const jutsuMethods: JutsuMethod[] = ["SINGLE", "ALL", "AOE_CIRCLE", "INSTANT_EFFECT", "AOE_SPIRAL", "AOE_BURST"];
export const bloodlineJutsuMethods: JutsuMethod[] = ["SINGLE", "AOE_CIRCLE", "INSTANT_EFFECT", "AOE_SPIRAL", "AOE_BURST"];
export const instantEffectGroundTags = ["Decrease Damage Given", "Recoil", "Poison"];
export const fortyApBlockedBloodlineTags = ["Pierce", "Siphon", "Mirror", "Copy", "Wound"];
