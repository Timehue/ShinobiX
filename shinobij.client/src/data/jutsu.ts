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

// Additive global options: attacks keep their offense; utilities are shared by element.
const globalOffenseTypes: Record<string, JutsuType> = { nin: "Ninjutsu", gen: "Genjutsu", tai: "Taijutsu", buki: "Bukijutsu" };
const globalAttackOptions: Array<[string, JutsuElement, string, string, string, string]> = [
    ["nin","Earth","Bedrock Fang","Siphon","Siltbreaker Pulse","Decrease Damage Given"],
    ["gen","Earth","Splintered Horizon","Wound","Gravel Echo","Recoil"],
    ["tai","Earth","Quarry Fist","Siphon","Crushing Mantle","Decrease Damage Given"],
    ["buki","Earth","Jade Edge Draw","Siphon","Gravelhook Strike","Drain"],
    ["nin","Wind","Vacuum Needle","Wound","Hollow Gale Lance","Drain"],
    ["gen","Wind","Bitter Breath Mirage","Poison","Howling Echo","Recoil"],
    ["tai","Wind","Shearing Heel","Wound","Pressure Point Gale","Ignition"],
    ["buki","Wind","Returning Gale Edge","Siphon","Venomwind Senbon","Poison"],
    ["nin","Lightning","Stormfeed Spear","Siphon","Backlash Bolt","Recoil"],
    ["gen","Lightning","Fractured Flash","Wound","Borrowed Spark","Siphon"],
    ["tai","Lightning","Static Meridian Strike","Poison","Damping Knuckle","Decrease Damage Given"],
    ["buki","Lightning","Arcsteel Sever","Wound","Conductor's Mark","Ignition"],
    ["nin","Fire","Cinderfang Lance","Wound","Emberdraw Bolt","Siphon"],
    ["gen","Fire","Searing Memory","Wound","Choking Lantern","Poison"],
    ["tai","Fire","Furnace Palm","Siphon","Toxic Ember Kick","Poison"],
    ["buki","Fire","Coalhook Slash","Siphon","Backdraft Edge","Recoil"],
    ["nin","Water","Undertow Fang","Siphon","Crushing Current","Decrease Damage Given"],
    ["gen","Water","Shattered Reflection","Wound","Reversing Tide Vision","Recoil"],
    ["tai","Water","Riptide Knuckle","Wound","Undercurrent Heel","Ignition"],
    ["buki","Water","Coral Edge Thrust","Wound","Wakebrand Kunai","Ignition"],
];
const globalJutsuExpansion: Array<{ id: string; name: string; type: JutsuType; element: JutsuElement; tags: string[]; battle?: string }> = [
    ...globalAttackOptions.flatMap(([style, element, name5, tag5, name6, tag6]) =>
        [[name5, tag5], [name6, tag6]].map(([name, tag], index) => ({
            id: `starter-${style}-${element.toLowerCase()}-${index + 5}`, name, type: globalOffenseTypes[style], element, tags: [tag],
        }))),
    {"id":"starter-any-earth-1","name":"Mineral Venom Mantle","type":"Any","element":"Earth","tags":["Poison","Reflect"],"battle":"A mineral mantle poisons the target's chakra flow and prepares the user to reflect incoming damage."},
    {"id":"starter-any-wind-1","name":"Second Wind Circulation","type":"Any","element":"Wind","tags":["Lifesteal","Increase Heal"],"battle":"A circulating wind prepares the user to recover more HP and steal life through later attacks."},
    {"id":"starter-any-lightning-1","name":"Static Guard Lattice","type":"Any","element":"Lightning","tags":["Shield","Decrease Damage Taken"],"battle":"A static lattice shields the user and prepares them to withstand incoming damage."},
    {"id":"starter-any-fire-1","name":"Smothering Cinder Veil","type":"Any","element":"Fire","tags":["Drain","Decrease Damage Given"],"battle":"A smothering veil of cinders weakens the target's attacks and drains their HP and chakra."},
    {"id":"starter-any-water-1","name":"Brineguard Veil","type":"Any","element":"Water","tags":["Poison","Shield"],"battle":"A briny veil shields the user and poisons the target's chakra flow."},
];


const globalExpansionEffectText: Record<string, string> = {
    "Siphon": "Immediately heals you for part of the damage dealt.",
    "Wound": "Starting next round, the target bleeds at the end of their turns for 2 rounds.",
    "Recoil": "Starting next round, the target takes recoil damage when their attacks deal damage, for 2 rounds.",
    "Poison": "Starting next round, applies Poison for 2 rounds. Poison damages HP when the target spends chakra or stamina on a jutsu.",
    "Drain": "Starting next round, drains the target's HP and chakra at the end of their turns for 2 rounds.",
    "Ignition": "Starting next round, Ignition strengthens hits against the target for 2 rounds.",
    "Decrease Damage Given": "Starting next round, reduces the target's damage dealt for 2 rounds.",
    "Reflect": "Starting next round, reflects part of incoming damage for 2 rounds.",
    "Lifesteal": "Starting next round, your damaging attacks restore HP for 2 rounds.",
    "Increase Heal": "Starting next round, increases your healing for 2 rounds.",
    "Shield": "Grants a shield immediately.",
    "Decrease Damage Taken": "Starting next round, reduces your damage taken for 2 rounds."
};

const globalExpansionFlavor = Object.fromEntries(globalJutsuExpansion.map(({ id, name, type, tags, battle }) => [id, {
    battle: battle ?? `${name} strikes the target.`,
    desc: [type === "Any" ? "Deals no direct damage." : "Deals damage.", ...tags.map(tag => globalExpansionEffectText[tag])].join(" "),
}]));

// ── Non-bloodline (starter) balance table ────────────────────────────────
// Variant suffix → AP tier: a 1-tag entry is the 60AP damage variant; a 2-tag
// entry is a 40AP utility pair. These pairs avoid Move and Debuff Prevent;
// the 20AP universal Flicker retains its separate Move role.
const nonBloodlineTagTable: Record<string, string[]> = {
    ...Object.fromEntries(globalJutsuExpansion.map(({ id, tags }) => [id, tags])),
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
    "starter-nin-earth-2": { battle: "Heavy mud strikes the target and leaves them vulnerable to follow-up hits.", desc: "Deals damage and applies Ignition. Starting next round, hits against the target deal more damage for 2 rounds." },
    "starter-nin-earth-3": { battle: "Iron sand prepares the user to steal life and makes the target hurt themselves when attacking.", desc: "Starting next round, your damaging attacks restore HP, and the target takes recoil damage when their attacks deal damage. Both effects last 2 rounds. Deals no direct damage." },
    "starter-nin-wind-1": { battle: "The user draws in a steady wind to strengthen later attacks and healing.", desc: "Starting next round, increases your damage dealt and healing for 2 rounds. Deals no direct damage." },
    "starter-nin-wind-2": { battle: "Cutting winds strike the target and leave their attacks painfully unstable.", desc: "Deals damage. Starting next round, the target takes recoil damage whenever their attacks deal damage, for 2 rounds." },
    "starter-nin-wind-3": { battle: "A net of wind leaves the target vulnerable and poisons their chakra flow.", desc: "Starting next round, the target takes more damage and suffers Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. Deals no direct damage." },
    "starter-nin-lightning-1": { battle: "Lightning gathers around the user, preparing stronger attacks that restore HP.", desc: "Starting next round, increases your damage dealt and lets damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-nin-lightning-2": { battle: "A lightning lance strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound. The bleed starts next round and damages the target at the end of their turn for 2 rounds." },
    "starter-nin-lightning-3": { battle: "A precise jolt poisons the target and disrupts their HP and chakra.", desc: "Starting next round, drains HP and chakra at the end of the target's turns and applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. Deals no direct damage." },
    "starter-nin-fire-1": { battle: "Embers form a shield and prepare the user to recover HP from later attacks.", desc: "Grants a shield immediately. Starting next round, your damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-nin-fire-2": { battle: "Dragon-shaped flames strike the target and poison their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina." },
    "starter-nin-fire-3": { battle: "A swirling ash cloud prepares stronger attacks and reflects incoming damage.", desc: "Starting next round, increases your damage dealt and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-nin-water-1": { battle: "Water chakra marks the target for stronger hits and prepares the user to recover HP.", desc: "Starting next round, the target takes more damage and your damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-nin-water-2": { battle: "A crashing wave strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound. The bleed starts next round and lasts 2 rounds." },
    "starter-nin-water-3": { battle: "Mist clings to the target, making later hits stronger and their own attacks painful.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. Hits against them deal more damage, and their damaging attacks cause self-damage. Deals no direct damage." },

    "starter-tai-earth-1": { battle: "Stone chakra marks the target for heavier follow-up hits.", desc: "Starting next round, applies Ignition and Increase Damage Taken to the target for 2 rounds. Both strengthen later hits against them. Deals no direct damage." },
    "starter-tai-earth-2": { battle: "An earth-weighted kick strikes the target and poisons their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina." },
    "starter-tai-earth-3": { battle: "The user braces behind stone chakra to reflect damage and recover HP when hit.", desc: "Starting next round, reflects part of incoming damage and converts part into healing for 2 rounds. Deals no direct damage." },
    "starter-tai-wind-1": { battle: "A feint marks the target for stronger hits as a reflecting gust gathers around the user.", desc: "Starting next round, the target takes more damage and you reflect part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-tai-wind-2": { battle: "A rising combination strikes the target and prepares the user to recover HP from later attacks.", desc: "Deals damage. Starting next round, your damaging attacks restore HP for 2 rounds." },
    "starter-tai-wind-3": { battle: "Spiraling wind disrupts the target's HP and chakra and poisons their chakra flow.", desc: "Starting next round, drains the target's HP and chakra at turn end and applies Poison for 2 rounds. Poison damages HP when a jutsu spends resources. Deals no direct damage." },
    "starter-tai-lightning-1": { battle: "Lightning forms a shield around the user and prepares stronger attacks.", desc: "Grants a shield immediately. Starting next round, increases your damage dealt for 2 rounds. Deals no direct damage." },
    "starter-tai-lightning-2": { battle: "A lightning-charged knee strikes as a reflecting aura gathers around the user.", desc: "Deals damage. Starting next round, reflects part of incoming damage for 2 rounds." },
    "starter-tai-lightning-3": { battle: "A counter stance marks the target for stronger hits and prepares the user to steal life.", desc: "Starting next round, the target takes more damage and your damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-tai-fire-1": { battle: "A controlled flame stance weakens the target's attacks and protects the user.", desc: "Starting next round, reduces the target's damage dealt and your damage taken for 2 rounds. Deals no direct damage." },
    "starter-tai-fire-2": { battle: "A flaming kick strikes the target and disrupts their HP and chakra.", desc: "Deals damage. Starting next round, drains equal HP and chakra from the target at the end of their turns for 2 rounds." },
    "starter-tai-fire-3": { battle: "Cinders cling to the target, strengthening later hits and punishing their attacks.", desc: "Starting next round, applies Ignition and Recoil for 2 rounds. Hits against the target deal more damage, and their damaging attacks cause self-damage. Deals no direct damage." },
    "starter-tai-water-1": { battle: "The user settles into a flowing stance that strengthens later healing and life-stealing attacks.", desc: "Starting next round, increases your healing and lets damaging attacks restore HP for 2 rounds. Deals no direct damage." },
    "starter-tai-water-2": { battle: "A water-powered shoulder strike hits the target and prepares stronger follow-up attacks.", desc: "Deals damage. Starting next round, increases your damage dealt for 2 rounds." },
    "starter-tai-water-3": { battle: "The user takes a rippling stance that reflects damage and converts some into healing.", desc: "Starting next round, reflects part of incoming damage and converts part into healing for 2 rounds. Deals no direct damage." },

    "starter-gen-earth-1": { battle: "A stone mirage steadies the user's offense and defense.", desc: "Starting next round, increases your damage dealt and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-gen-earth-2": { battle: "An illusion of crushing earth harms the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-gen-earth-3": { battle: "Illusory dust weakens the target's attacks and disrupts their HP and chakra.", desc: "Starting next round, reduces the target's damage dealt and drains HP and chakra at the end of their turns for 2 rounds. Deals no direct damage." },
    "starter-gen-wind-1": { battle: "A whispering wind forms a shield and prepares the user to recover HP when hit.", desc: "Grants a shield immediately. Starting next round, converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-wind-2": { battle: "A cyclone of voices harms the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-gen-wind-3": { battle: "A light-footed illusion weakens the target's attacks and prepares the user to recover HP when hit.", desc: "Starting next round, reduces the target's damage dealt and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-lightning-1": { battle: "Illusory light disrupts the target's HP and chakra and prepares the user to recover HP when hit.", desc: "Starting next round, drains the target's HP and chakra at turn end and converts part of your incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-gen-lightning-2": { battle: "A phantom stage disrupts the target's attacks.", desc: "Deals damage. Starting next round, reduces the target's damage dealt for 2 rounds." },
    "starter-gen-lightning-3": { battle: "A mirrored illusion makes later hits stronger and the target's attacks painful.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. Deals no direct damage." },
    "starter-gen-fire-1": { battle: "Ghostly lanterns steady the user and strengthen later healing.", desc: "Starting next round, increases your healing and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-gen-fire-2": { battle: "Phantom flames harm the target and restore HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-gen-fire-3": { battle: "An ash-grey illusion leaves the target vulnerable as a reflecting veil gathers around the user.", desc: "Starting next round, the target takes more damage and you reflect part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-gen-water-1": { battle: "A drowning illusion drains the target while preparing stronger attacks for the user.", desc: "Starting next round, increases your damage dealt and drains the target's HP and chakra at the end of their turns for 2 rounds. Deals no direct damage." },
    "starter-gen-water-2": { battle: "A moonlit nightmare harms the target and poisons their chakra flow.", desc: "Deals damage and applies Poison for 2 rounds, starting next round. Poison damages HP when a jutsu spends chakra or stamina." },
    "starter-gen-water-3": { battle: "Illusory mist weakens the target's attacks and prepares the user to recover HP when hit.", desc: "Starting next round, reduces the target's damage dealt and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },

    "starter-buki-earth-1": { battle: "Stone kunai disrupt the target's offense as the user prepares stronger healing.", desc: "Starting next round, reduces the target's damage dealt and increases your healing for 2 rounds. Deals no direct damage." },
    "starter-buki-earth-2": { battle: "An adamant chain strikes the target and opens a bleeding wound.", desc: "Deals damage and applies Wound for 2 rounds, starting next round." },
    "starter-buki-earth-3": { battle: "The user coats their weapon in obsidian chakra to strengthen offense and defense.", desc: "Starting next round, increases your damage dealt and reduces your damage taken for 2 rounds. Deals no direct damage." },
    "starter-buki-wind-1": { battle: "Windmill shuriken mark the target for stronger hits and painful recoil.", desc: "Starting next round, applies Ignition and Recoil to the target for 2 rounds. Deals no direct damage." },
    "starter-buki-wind-2": { battle: "A fan of blades strikes the target and opens bleeding wounds.", desc: "Deals damage and applies Wound for 2 rounds, starting next round." },
    "starter-buki-wind-3": { battle: "A crosswind gathers around the user to reduce and reflect incoming damage.", desc: "Starting next round, reduces your damage taken and reflects part of incoming damage for 2 rounds. Deals no direct damage." },
    "starter-buki-lightning-1": { battle: "Charged needles prepare the user for stronger healing and recovery when hit.", desc: "Starting next round, increases your healing and converts part of incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-buki-lightning-2": { battle: "Charged wire strikes the target and restores HP to the user.", desc: "Deals damage and immediately heals you for part of the damage dealt." },
    "starter-buki-lightning-3": { battle: "A magnetized blade disrupts the target's offense as the user braces for incoming attacks.", desc: "Starting next round, reduces the target's damage dealt and your damage taken for 2 rounds. Deals no direct damage." },
    "starter-buki-fire-1": { battle: "An explosive seal marks the target for stronger hits and poisons their chakra flow.", desc: "Starting next round, the target takes more damage and suffers Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina. Deals no direct damage." },
    "starter-buki-fire-2": { battle: "Burning wire detonates against the target and opens a bleeding wound.", desc: "Deals damage and applies Wound for 2 rounds, starting next round." },
    "starter-buki-fire-3": { battle: "A heated blade marks the target for stronger hits as a protective aura gathers around the user.", desc: "Starting next round, applies Ignition to the target and converts part of your incoming damage into healing for 2 rounds. Deals no direct damage." },
    "starter-buki-water-1": { battle: "Mist and needles form a protective screen around the user.", desc: "Grants a shield immediately. Starting next round, reduces your damage taken for 2 rounds. Deals no direct damage." },
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
    const flavor = nonBloodlineFlavor[normalized.id] ?? globalExpansionFlavor[normalized.id];

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
// The first three techniques precede the fourth utility tier in the starter order.
const globalStarterFamilies: Array<[string, JutsuElement, [string, string, string, string]]> = [
    ["nin","Earth",["Stone Needle Volley","Mud Coffin Bind","Iron Sand Burst","Bedrock Chakra Focus"]],
    ["nin","Wind",["Vacuum Palm Wave","Cyclone Cutter","Gale Net Snare","Galewind Attunement"]],
    ["nin","Lightning",["Static Fang","Thunderclap Lance","Nerve Spark Seal","Voltaic Surge Focus"]],
    ["nin","Fire",["Cinder Shot","Blazing Dragon Arc","Ash Cloud Breaker","Emberheart Kindling"]],
    ["nin","Water",["Tide Spear","Crashing Wave Prison","Mist Veil Flow","Tidal Renewal Rite"]],
    ["tai","Earth",["Granite Elbow","Boulder Heel Drop","Rooted Guard Break","Ironbody Conditioning"]],
    ["tai","Wind",["Tempest Step Kick","Rising Gale Combo","Spiral Backfist","Windstep Awakening"]],
    ["tai","Lightning",["Spark Jab Chain","Raikou Knee Strike","Flash Step Counter","Thunderpulse Overdrive"]],
    ["tai","Fire",["Burning Knuckle","Meteor Axe Kick","Cinder Rush","Blazing Spirit Focus"]],
    ["tai","Water",["Flowing Palm","Tidal Shoulder Throw","Ripple Guard Form","Flowing Chi Harmony"]],
    ["gen","Earth",["Stone Eye Mirage","Buried Memory Field","Dust Puppet Vision","Stoneheart Meditation"]],
    ["gen","Wind",["Whispering Gale","Hollow Voice Cyclone","Feather Step Illusion","Whispering Calm"]],
    ["gen","Lightning",["Neural Flash","Paralysis Theater","Mirror Spark Dream","Stormmind Focus"]],
    ["gen","Fire",["Lantern Fear","Inferno Hallucination","Ashen Mind Lock","Inner Flame Vision"]],
    ["gen","Water",["Drowning Reflection","Moonlit Tide Dream","Mist Memory Snare","Still Water Mind"]],
    ["buki","Earth",["Stone Kunai Rain","Adamant Chain Pull","Obsidian Edge","Adamant Stance Drill"]],
    ["buki","Wind",["Windmill Shuriken Line","Aerial Blade Fan","Crosswind Needle","Swiftblade Attunement"]],
    ["buki","Lightning",["Charged Senbon","Thunder Wire Trap","Magnet Blade Return","Charged Grip Focus"]],
    ["buki","Fire",["Explosive Tag Flicker","Flame Wire Detonation","Searing Blade Toss","Forgeheart Temper"]],
    ["buki","Water",["Mist Needle Spread","Torrent Chain Slash","Hidden Current Guard","Rippling Edge Ritual"]],
];

function makeGlobalJutsu(id: string, name: string, type: JutsuType, element: JutsuElement): Jutsu {
    // The table reapplies the final budget. Start at 60 AP so normalization
    // preserves an attack's offense before utilities become Any.
    return makeJutsu(id, name, type, 60, 4, 0, 7, 250, 250, [], element);
}

function makeGlobalAreaJutsu(id: string, name: string, type: JutsuType, element: JutsuElement, tag: JutsuTag, battleDescription: string, description: string): Jutsu {
    return normalizeJutsu({ id, name, type, element, ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [tag], battleDescription, description });
}

export const starterJutsus: Jutsu[] = [
    ...globalStarterFamilies.flatMap(([style, element, names]) => names.slice(0, 3).map((name, index) =>
        makeGlobalJutsu(`starter-${style}-${element.toLowerCase()}-${index + 1}`, name, globalOffenseTypes[style], element))),
    // Increase Generals utility set — 40-AP self-buff, one per discipline × element.
    // The second tag is added by rebalanceNonBloodlineJutsu from nonBloodlineTagTable.
    ...globalStarterFamilies.map(([style, element, names]) =>
        makeGlobalJutsu(`starter-${style}-${element.toLowerCase()}-4`, names[3], globalOffenseTypes[style], element)),

    // AOE Burst set — 60-AP OPPONENT-targeted damage jutsu, one per discipline × element.
    // method AOE_BURST: full damage to the target + every enemy in the 6 touching hexes (no
    // movement, no ground tile). The shared area builder uses normalizeJutsu
    // and NOT listed in nonBloodlineTagTable, so rebalanceNonBloodlineJutsu passes them
    // through unchanged. Each carries ONE combat tag (like the other 60-AP damage jutsu),
    // which applies to the primary AND every splashed enemy via applyAoeSplash.
    makeGlobalAreaJutsu("starter-nin-earth-aoe", "Seismic Shatter", "Ninjutsu", "Earth", { name: "Wound", percent: 14 }, "The ground erupts beneath the enemy in a shattering seismic burst.", "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds."),
    makeGlobalAreaJutsu("starter-nin-wind-aoe", "Vacuum Detonation", "Ninjutsu", "Wind", { name: "Decrease Damage Given", percent: 25 }, "A compressed sphere of air implodes and detonates in a concussive burst.", "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-nin-lightning-aoe", "Forked Lightning Nova", "Ninjutsu", "Lightning", { name: "Increase Damage Taken", percent: 25 }, "Lightning splits into a dozen forks and erupts across the battlefield.", "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-nin-fire-aoe", "Great Fireball Burst", "Ninjutsu", "Fire", { name: "Ignition", percent: 25 }, "A massive fireball detonates on impact, engulfing the enemy and their surroundings.", "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds."),
    makeGlobalAreaJutsu("starter-nin-water-aoe", "Tidal Crash", "Ninjutsu", "Water", { name: "Drain", percent: 0 }, "A towering wave crashes down and floods the ground in a violent burst.", "Damages the target and adjacent enemies. Starting next round, drains their HP and chakra at the end of their turns for 2 rounds."),
    makeGlobalAreaJutsu("starter-tai-earth-aoe", "Fault Line Stomp", "Taijutsu", "Earth", { name: "Recoil", percent: 12 }, "A thunderous stomp splits the earth in a shockwave of stone.", "Damages the target and adjacent enemies. Starting next round, affected enemies take recoil damage when their attacks deal damage, for 2 rounds."),
    makeGlobalAreaJutsu("starter-tai-wind-aoe", "Whirlwind Sweep", "Taijutsu", "Wind", { name: "Decrease Damage Given", percent: 25 }, "The user spins into a whirlwind that batters everyone in reach.", "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-tai-lightning-aoe", "Thunderclap Shockwave", "Taijutsu", "Lightning", { name: "Increase Damage Taken", percent: 25 }, "A lightning-charged clap unleashes a shockwave across the field.", "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-tai-fire-aoe", "Blazing Spin Kick", "Taijutsu", "Fire", { name: "Ignition", percent: 25 }, "A blazing spin kick trails fire in a scorching arc.", "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds."),
    makeGlobalAreaJutsu("starter-tai-water-aoe", "Surging Wave Palm", "Taijutsu", "Water", { name: "Siphon", percent: 25 }, "A surge of water bursts from the user's palm in a crashing arc.", "Damages the target and adjacent enemies and immediately heals you for part of the damage dealt."),
    makeGlobalAreaJutsu("starter-gen-earth-aoe", "Crumbling World Illusion", "Genjutsu", "Earth", { name: "Poison", percent: 5 }, "The world seems to crumble as the earth swallows the enemy's mind.", "Damages the target and adjacent enemies. Starting next round, applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina."),
    makeGlobalAreaJutsu("starter-gen-wind-aoe", "Screaming Void", "Genjutsu", "Wind", { name: "Decrease Damage Given", percent: 25 }, "A howling void tears open, screaming through the enemy's senses.", "Damages the target and adjacent enemies. Starting next round, affected enemies deal less damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-gen-lightning-aoe", "Blinding Flash Field", "Genjutsu", "Lightning", { name: "Increase Damage Taken", percent: 25 }, "A blinding sheet of light detonates across the battlefield.", "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-gen-fire-aoe", "Hellfire Mirage", "Genjutsu", "Fire", { name: "Ignition", percent: 25 }, "Phantom hellfire erupts and consumes the enemy's world.", "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds."),
    makeGlobalAreaJutsu("starter-gen-water-aoe", "Drowning Delusion", "Genjutsu", "Water", { name: "Drain", percent: 0 }, "A crushing tide of illusion drags the enemy under.", "Damages the target and adjacent enemies. Starting next round, drains their HP and chakra at the end of their turns for 2 rounds."),
    makeGlobalAreaJutsu("starter-buki-earth-aoe", "Stone Shrapnel Burst", "Bukijutsu", "Earth", { name: "Wound", percent: 14 }, "A packed charge bursts into a hail of stone shrapnel.", "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds."),
    makeGlobalAreaJutsu("starter-buki-wind-aoe", "Fan Blade Storm", "Bukijutsu", "Wind", { name: "Wound", percent: 14 }, "A storm of wind-borne blades fans out across the field.", "Damages the target and adjacent enemies. Starting next round, affected enemies bleed for 2 rounds."),
    makeGlobalAreaJutsu("starter-buki-lightning-aoe", "Charged Shuriken Spread", "Bukijutsu", "Lightning", { name: "Increase Damage Taken", percent: 25 }, "A fan of charged shuriken scatters and crackles on impact.", "Damages the target and adjacent enemies. Starting next round, affected enemies take more damage for 2 rounds."),
    makeGlobalAreaJutsu("starter-buki-fire-aoe", "Explosive Tag Barrage", "Bukijutsu", "Fire", { name: "Ignition", percent: 25 }, "A barrage of explosive tags detonates in a chain of blasts.", "Damages the target and adjacent enemies. Starting next round, Ignition strengthens hits against them for 2 rounds."),
    makeGlobalAreaJutsu("starter-buki-water-aoe", "Mist Blade Torrent", "Bukijutsu", "Water", { name: "Poison", percent: 5 }, "A torrent of mist-wreathed blades sweeps across the enemy.", "Damages the target and adjacent enemies. Starting next round, applies Poison for 2 rounds. Poison damages HP when a jutsu spends chakra or stamina."),

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
    ...globalJutsuExpansion.map(({ id, name, type, element }) => normalizeJutsu({
        id, name, type, element, ap: type === "Any" ? 40 : 60,
        target: id === "starter-any-wind-1" || id === "starter-any-lightning-1" ? "SELF" : "OPPONENT",
        image: `/jutsu/global/${id}.avif`,
    })),
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
