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
// entry is a 40AP utility pair. Move stays on the two movement jutsu.
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
    "starter-tai-wind-1": ["Move", "Reflect"],
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
    "starter-gen-wind-3": ["Move", "Decrease Damage Given"],
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
    "starter-nin-wind-4": ["Increase Generals", "Overclock"],
    "starter-nin-lightning-4": ["Increase Generals", "Increase Damage Given"],
    "starter-nin-fire-4": ["Increase Generals", "Lifesteal"],
    "starter-nin-water-4": ["Increase Generals", "Increase Heal"],
    "starter-tai-earth-4": ["Increase Generals", "Shield"],
    "starter-tai-wind-4": ["Increase Generals", "Reflect"],
    "starter-tai-lightning-4": ["Increase Generals", "Overclock"],
    "starter-tai-fire-4": ["Increase Generals", "Increase Damage Given"],
    "starter-tai-water-4": ["Increase Generals", "Absorb"],
    "starter-gen-earth-4": ["Increase Generals", "Absorb"],
    "starter-gen-wind-4": ["Increase Generals", "Debuff Prevent"],
    "starter-gen-lightning-4": ["Increase Generals", "Reflect"],
    "starter-gen-fire-4": ["Increase Generals", "Increase Damage Given"],
    "starter-gen-water-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-buki-earth-4": ["Increase Generals", "Decrease Damage Taken"],
    "starter-buki-wind-4": ["Increase Generals", "Increase Damage Given"],
    "starter-buki-lightning-4": ["Increase Generals", "Lifesteal"],
    "starter-buki-fire-4": ["Increase Generals", "Overclock"],
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
    "starter-nin-earth-1": { battle: "Jagged stone needles erupt from the earth in a punishing volley.", desc: "Hardened earth chakra is compressed into needle-thin spikes that punch through armor." },
    "starter-nin-earth-2": { battle: "Heavy mud surges up and hardens around the target, locking them in place.", desc: "A coffin of wet earth seals around the enemy and crushes inward as it dries." },
    "starter-nin-earth-3": { battle: "A cloud of iron-laced sand detonates outward in a grinding burst.", desc: "Magnetized iron sand scours flesh and leaves lingering, bleeding wounds." },
    "starter-nin-wind-1": { battle: "A palm-thrust compresses the air into a concussive vacuum wave.", desc: "A blast of pressurized wind that knocks the enemy back off their footing." },
    "starter-nin-wind-2": { battle: "Whirling blades of wind carve through the air toward the target.", desc: "Spinning wind chakra sharpens into cutting edges that build the user's momentum." },
    "starter-nin-wind-3": { battle: "A net of howling wind wraps tight, smothering the enemy's strength.", desc: "Lashing gusts bind the target and sap the force from their attacks." },
    "starter-nin-lightning-1": { battle: "A crackling fang of lightning snaps forward and bites deep.", desc: "Concentrated lightning chakra shaped into a fang that pierces in a single strike." },
    "starter-nin-lightning-2": { battle: "A lance of pure lightning spears forward on a deafening thunderclap.", desc: "A focused bolt that strikes faster than the eye can track." },
    "starter-nin-lightning-3": { battle: "Sparks dance across the enemy's nerves, sealing their bloodline away.", desc: "A precise jolt that scrambles chakra pathways and locks the enemy's kekkei genkai." },
    "starter-nin-fire-1": { battle: "A spitting ember bursts on impact and sets the target alight.", desc: "A small fireball that clings and smolders, igniting the enemy for follow-up hits." },
    "starter-nin-fire-2": { battle: "A roaring arc of dragonfire sweeps across the battlefield.", desc: "A torrent of flame shaped like a rising dragon that leaves the enemy scorched and exposed." },
    "starter-nin-fire-3": { battle: "A choking cloud of burning ash bursts over the enemy.", desc: "Superheated ash sears the lungs and poisons the target with every breath." },
    "starter-nin-water-1": { battle: "A spear of compressed water lances forward with crushing force.", desc: "Water chakra hardened to a piercing point that drives clean through a guard." },
    "starter-nin-water-2": { battle: "A towering wave crashes down and traps the enemy in churning water.", desc: "A prison of crushing water that holds the target fast and staggers their next move." },
    "starter-nin-water-3": { battle: "A cool mist coils around the user, blunting the blows to come.", desc: "A flowing veil of mist that shrouds the user and softens the damage they take." },

    "starter-tai-earth-1": { battle: "A granite-hard elbow smashes into the target at close range.", desc: "The forearm is sheathed in stone chakra for a brutal, bone-jarring strike." },
    "starter-tai-earth-2": { battle: "A crushing heel drops like a falling boulder onto the enemy.", desc: "A downward axe-kick weighted with earth chakra that builds the user's offense." },
    "starter-tai-earth-3": { battle: "A grounded strike shatters the enemy's guard and drives through it.", desc: "Planted feet and earth chakra lend a blow that pierces straight past defenses." },
    "starter-tai-wind-1": { battle: "The user blurs forward on a tempest step and repositions in an instant.", desc: "A wind-assisted dash that carries the user to open ground in the blink of an eye." },
    "starter-tai-wind-2": { battle: "A rising flurry of wind-fast strikes batters the enemy upward.", desc: "A gale-quick combination that leaves the target reeling and easier to hit." },
    "starter-tai-wind-3": { battle: "A spiraling backfist rides a gust and knocks the enemy away.", desc: "A spinning strike trailing wind chakra that shoves the target back." },
    "starter-tai-lightning-1": { battle: "A chain of lightning-fast jabs crackles into the target.", desc: "Rapid electrified jabs that pile on before the enemy can react." },
    "starter-tai-lightning-2": { battle: "A thunder-charged knee slams up with stunning force.", desc: "A lightning-fast knee that rattles the enemy and steals their next breath." },
    "starter-tai-lightning-3": { battle: "The user vanishes in a flash and snaps back into a counter stance.", desc: "A lightning-quick repositioning that turns the enemy's own blows against them." },
    "starter-tai-fire-1": { battle: "A fist wreathed in flame slams home and sets the target burning.", desc: "Fire chakra coats the knuckles, igniting the enemy on contact." },
    "starter-tai-fire-2": { battle: "A blazing axe-kick falls like a meteor onto the enemy.", desc: "A flaming overhead kick that lands with reckless, recoiling force." },
    "starter-tai-fire-3": { battle: "The user rushes in trailing cinders that sear the enemy raw.", desc: "A burning charge that leaves smoldering wounds in its wake." },
    "starter-tai-water-1": { battle: "A flowing palm lands soft and draws the enemy's vitality into the user.", desc: "A water-smooth blow that heals the user for part of the harm it deals." },
    "starter-tai-water-2": { battle: "The user rides a surge of water and hurls the enemy with a shoulder throw.", desc: "A tidal-powered throw that slams the target down and weakens their strikes." },
    "starter-tai-water-3": { battle: "The user settles into a rippling guard, deflecting what comes.", desc: "A flowing defensive stance that raises a shield and wards off interference." },

    "starter-gen-earth-1": { battle: "The ground seems to twist as a stone mirage clouds the enemy's sight.", desc: "An earth-bound illusion that throws off the target's aim and shields the user's mind." },
    "starter-gen-earth-2": { battle: "Phantom earth swallows the enemy's senses and buries their memory.", desc: "An illusion that entombs the mind and seals away the enemy's bloodline." },
    "starter-gen-earth-3": { battle: "Figures of dust rise and dance, poisoning the enemy's perception.", desc: "Illusory dust puppets that worm into the mind and sicken the target over time." },
    "starter-gen-wind-1": { battle: "A whispering wind carries doubt that leaves the enemy exposed.", desc: "Voices on the breeze unsettle the target, so every blow against them lands harder." },
    "starter-gen-wind-2": { battle: "A cyclone of hollow voices spins around the user, quickening them.", desc: "A disorienting whirl of sound that sharpens the user's own tempo." },
    "starter-gen-wind-3": { battle: "The user drifts aside like a feather, fading from the enemy's reach.", desc: "A weightless illusion-step that repositions the user and blunts incoming harm." },
    "starter-gen-lightning-1": { battle: "A blinding flash overloads the enemy's senses for an instant.", desc: "A burst of illusory light that sears straight into the mind." },
    "starter-gen-lightning-2": { battle: "The world freezes into a phantom stage and locks the enemy still.", desc: "An elaborate illusion that traps the target and steals their next action." },
    "starter-gen-lightning-3": { battle: "A mirrored dream turns the enemy's own malice back upon them.", desc: "An illusion that reflects the target's curses and debuffs onto themselves." },
    "starter-gen-fire-1": { battle: "Ghostly lantern-light flares, igniting the enemy's deepest fear.", desc: "A fiery vision of dread that leaves the target burning and rattled." },
    "starter-gen-fire-2": { battle: "Phantom flames roar up around the enemy, all too real to their mind.", desc: "An illusion of all-consuming fire that stokes the user's own offense." },
    "starter-gen-fire-3": { battle: "Ash settles over the enemy's thoughts, smothering their will.", desc: "A grey haze that locks the mind and blocks the enemy from gaining new buffs." },
    "starter-gen-water-1": { battle: "The enemy sees themselves drowning and feels their strength leave them.", desc: "A watery illusion that drains the target's chakra and resolve." },
    "starter-gen-water-2": { battle: "A calm moonlit tide washes over the user, easing every blow.", desc: "A serene illusion that lowers the damage the user takes." },
    "starter-gen-water-3": { battle: "A clinging mist tangles the enemy's memory and holds their binds fast.", desc: "An illusory fog that prevents the target from clearing what afflicts them." },

    "starter-buki-earth-1": { battle: "A volley of stone kunai rains down to pin the enemy in place.", desc: "Thrown blades of packed earth that hem the target in and blunt their assault." },
    "starter-buki-earth-2": { battle: "An adamant chain whips out and hauls the enemy off balance.", desc: "A weighted chain of hardened links that drags the target where the user wants them." },
    "starter-buki-earth-3": { battle: "A razor edge of obsidian slashes clean through the enemy's defense.", desc: "A blade of volcanic glass honed to pierce armor and guard alike." },
    "starter-buki-wind-1": { battle: "A line of windmill shuriken spins out and carves the target.", desc: "Spinning fūma shuriken that score deep, bleeding cuts." },
    "starter-buki-wind-2": { battle: "A fan of airborne blades fans out and presses the enemy.", desc: "Thrown blades caught on the wind that build the user's advantage." },
    "starter-buki-wind-3": { battle: "Needles ride a crosswind and slip past the enemy's guard.", desc: "Wind-guided senbon that harry the target while the user braces against harm." },
    "starter-buki-lightning-1": { battle: "Electrified senbon streak into the target with a sharp crack.", desc: "Needles charged with lightning that strike fast and true." },
    "starter-buki-lightning-2": { battle: "A web of charged wire snaps taut and jolts the enemy stiff.", desc: "A hidden lightning-wire snare that stuns whoever trips it." },
    "starter-buki-lightning-3": { battle: "A thrown blade curves back on a magnetic pull, slashing twice.", desc: "A magnetized blade that returns to the user and throws reflected harm aside." },
    "starter-buki-fire-1": { battle: "A flicker of motion plants an explosive tag that bursts into flame.", desc: "A tagged charge that detonates and leaves the target alight." },
    "starter-buki-fire-2": { battle: "Flame races down a hidden wire and detonates against the enemy.", desc: "A burning trap-wire that goes off in a searing blast, leaving the target exposed." },
    "starter-buki-fire-3": { battle: "A red-hot blade spins through the air and sears on contact.", desc: "A heated throwing blade that burns and poisons the wound it opens." },
    "starter-buki-water-1": { battle: "A spray of needles scatters through the mist into the enemy.", desc: "Concealing mist hides a spread of senbon that drains the target." },
    "starter-buki-water-2": { battle: "A water-wreathed chain slashes across the enemy in a torrent.", desc: "A surging chain-blade that cuts deep and siphons vitality back to the user." },
    "starter-buki-water-3": { battle: "The user weaves a hidden current that lashes back at attackers.", desc: "A deceptive guarding current that punishes and drains those who strike it." },

    // ── Increase Generals utility set flavor ──
    "starter-nin-earth-4": { battle: "The user roots their chakra deep into the earth, steeling every attribute.", desc: "A grounding rite that hardens the user's core stats and blunts the blows to come." },
    "starter-nin-wind-4": { battle: "The user breathes with the wind, sharpening body and mind in one gust.", desc: "A soaring focus that lifts every attribute and quickens the user's actions." },
    "starter-nin-lightning-4": { battle: "Lightning courses through the user's coils, electrifying every attribute.", desc: "A charged focus that surges the user's core stats and sharpens their strikes." },
    "starter-nin-fire-4": { battle: "The user stokes an inner ember, warming strength, speed, wit and will.", desc: "A kindling rite that raises every attribute and draws life from the wounds it opens." },
    "starter-nin-water-4": { battle: "The user draws a cleansing tide inward, renewing every attribute.", desc: "A flowing rite that lifts the user's core stats and deepens their recovery." },
    "starter-tai-earth-4": { battle: "The user sets their stance like bedrock, tempering every attribute.", desc: "A hardening drill that raises the user's core stats and shields the body." },
    "starter-tai-wind-4": { battle: "The user exhales and rises light as wind, keen in every attribute.", desc: "An awakening step that lifts every attribute and turns blows back on the attacker." },
    "starter-tai-lightning-4": { battle: "A thunderous pulse floods the user's muscles, spiking every attribute.", desc: "An overdrive surge that raises the user's core stats and quickens their actions." },
    "starter-tai-fire-4": { battle: "The user's spirit blazes up, firing strength, speed, wit and will.", desc: "A burning focus that lifts every attribute and sharpens the user's strikes." },
    "starter-tai-water-4": { battle: "The user settles into a flowing calm, balancing every attribute.", desc: "A harmonizing form that raises the user's core stats and turns damage into healing." },
    "starter-gen-earth-4": { battle: "The user sinks into a stone-still trance, fortifying every attribute.", desc: "A grounded meditation that raises the user's core stats and drinks in incoming harm." },
    "starter-gen-wind-4": { battle: "A whispering calm clears the user's mind, honing every attribute.", desc: "A serene focus that lifts every attribute and wards the mind against debuffs." },
    "starter-gen-lightning-4": { battle: "The user's thoughts crackle like a storm, charging every attribute.", desc: "A charged focus that raises the user's core stats and reflects harm back." },
    "starter-gen-fire-4": { battle: "The user conjures an inner flame that burns strength, speed, wit and will higher.", desc: "A blazing vision that lifts every attribute and sharpens the user's strikes." },
    "starter-gen-water-4": { battle: "The user's mind stills like deep water, steadying every attribute.", desc: "A tranquil focus that raises the user's core stats and softens the blows they take." },
    "starter-buki-earth-4": { battle: "The user plants an adamant stance, tempering every attribute.", desc: "A weapon drill that raises the user's core stats and blunts incoming blows." },
    "starter-buki-wind-4": { battle: "The user's blade sings on the wind, quickening every attribute.", desc: "A swift attunement that lifts every attribute and sharpens the user's strikes." },
    "starter-buki-lightning-4": { battle: "The user's grip crackles with charge, keying up every attribute.", desc: "A charged focus that raises the user's core stats and draws life on every hit." },
    "starter-buki-fire-4": { battle: "The user tempers themselves in an inner forge, hardening every attribute.", desc: "A forge-hot rite that lifts every attribute and quickens the user's actions." },
    "starter-buki-water-4": { battle: "The user's edge ripples like water, refining every attribute.", desc: "A flowing ritual that raises the user's core stats and deepens their recovery." },
};

// Flat-value or binary tags carry no percent; every other starter tag uses the
// uniform 30% creator value (which displays as 20% at mastery 0).
function nonBloodlineTagPercent(name: string): number {
    if (name === "Move" || name === "Shield" || name === "Drain") return 0;
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

export const starterJutsus: Jutsu[] = [
    // All jutsus: stored EP=28 (base). PvP/PvE scales +0.2 per mastery level ? EP 38 at mastery 50. Tags stored at 30% ? displays as 20% at mastery 0 via effectiveTagPercent.
    makeJutsu("starter-nin-earth-1", "Stone Needle Volley", "Ninjutsu", 60, 4, 28, 1, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-2", "Mud Coffin Bind", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-3", "Iron Sand Burst", "Ninjutsu", 40, 3, 27, 2, 125, 125, [{ name: "Wound", percent: 18 }], "Earth"),
    makeJutsu("starter-nin-wind-1", "Vacuum Palm Wave", "Ninjutsu", 40, 5, 20, 1, 125, 125, [{ name: "Push", percent: 0 }], "Wind"),
    makeJutsu("starter-nin-wind-2", "Cyclone Cutter", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 18 }], "Wind"),
    makeJutsu("starter-nin-wind-3", "Gale Net Snare", "Ninjutsu", 40, 4, 18, 2, 125, 125, [{ name: "Decrease Damage Given", percent: 20 }], "Wind"),
    makeJutsu("starter-nin-lightning-1", "Static Fang", "Ninjutsu", 40, 4, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-nin-lightning-2", "Thunderclap Lance", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Pierce", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-lightning-3", "Nerve Spark Seal", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Bloodline Seal", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-fire-1", "Cinder Shot", "Ninjutsu", 40, 4, 25, 1, 125, 125, [{ name: "Ignition", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-2", "Blazing Dragon Arc", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-3", "Ash Cloud Breaker", "Ninjutsu", 40, 3, 23, 2, 125, 125, [{ name: "Poison", percent: 15 }], "Fire"),
    makeJutsu("starter-nin-water-1", "Tide Spear", "Ninjutsu", 40, 4, 33, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Water"),
    makeJutsu("starter-nin-water-2", "Crashing Wave Prison", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Water"),
    makeJutsu("starter-nin-water-3", "Mist Veil Flow", "Ninjutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Decrease Damage Taken", percent: 18 }], "Water"),

    makeJutsu("starter-tai-earth-1", "Granite Elbow", "Taijutsu", 40, 1, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-tai-earth-2", "Boulder Heel Drop", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Earth"),
    makeJutsu("starter-tai-earth-3", "Rooted Guard Break", "Taijutsu", 60, 1, 26, 2, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-tai-wind-1", "Tempest Step Kick", "Taijutsu", 40, 2, 20, 1, 125, 125, [{ name: "Move", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-wind-2", "Rising Gale Combo", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-tai-wind-3", "Spiral Backfist", "Taijutsu", 40, 1, 21, 1, 125, 125, [{ name: "Push", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-lightning-1", "Spark Jab Chain", "Taijutsu", 40, 1, 33, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-tai-lightning-2", "Raikou Knee Strike", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-tai-lightning-3", "Flash Step Counter", "Taijutsu", 40, 1, 0, 3, 125, 125, [{ name: "Reflect", percent: 22 }], "Lightning"),
    makeJutsu("starter-tai-fire-1", "Burning Knuckle", "Taijutsu", 40, 1, 25, 1, 125, 125, [{ name: "Ignition", percent: 16 }], "Fire"),
    makeJutsu("starter-tai-fire-2", "Meteor Axe Kick", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Recoil", percent: 10 }], "Fire"),
    makeJutsu("starter-tai-fire-3", "Cinder Rush", "Taijutsu", 40, 2, 26, 1, 125, 125, [{ name: "Wound", percent: 14 }], "Fire"),
    makeJutsu("starter-tai-water-1", "Flowing Palm", "Taijutsu", 40, 1, 28, 1, 125, 125, [{ name: "Lifesteal", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-2", "Tidal Shoulder Throw", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Decrease Damage Given", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-3", "Ripple Guard Form", "Taijutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-gen-earth-1", "Stone Eye Mirage", "Genjutsu", 40, 4, 18, 2, 125, 125, [{ name: "Decrease Damage Given", percent: 18 }], "Earth"),
    makeJutsu("starter-gen-earth-2", "Buried Memory Field", "Genjutsu", 60, 4, 30, 3, 250, 250, [{ name: "Bloodline Seal", percent: 0 }], "Earth"),
    makeJutsu("starter-gen-earth-3", "Dust Puppet Vision", "Genjutsu", 40, 3, 24, 1, 125, 125, [{ name: "Poison", percent: 14 }], "Earth"),
    makeJutsu("starter-gen-wind-1", "Whispering Gale", "Genjutsu", 40, 5, 21, 1, 125, 125, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-wind-2", "Hollow Voice Cyclone", "Genjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Overclock", percent: 0 }], "Wind"),
    makeJutsu("starter-gen-wind-3", "Feather Step Illusion", "Genjutsu", 40, 0, 0, 2, 125, 125, [{ name: "Move", percent: 0 }, { name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-lightning-1", "Neural Flash", "Genjutsu", 40, 4, 32, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-gen-lightning-2", "Paralysis Theater", "Genjutsu", 60, 4, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-gen-lightning-3", "Mirror Spark Dream", "Genjutsu", 40, 0, 0, 3, 125, 125, [{ name: "Mirror", percent: 22 }], "Lightning"),
    makeJutsu("starter-gen-fire-1", "Lantern Fear", "Genjutsu", 40, 4, 24, 1, 125, 125, [{ name: "Ignition", percent: 14 }], "Fire"),
    makeJutsu("starter-gen-fire-2", "Inferno Hallucination", "Genjutsu", 60, 4, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Fire"),
    makeJutsu("starter-gen-fire-3", "Ashen Mind Lock", "Genjutsu", 40, 3, 18, 2, 125, 125, [{ name: "Buff Prevent", percent: 0 }], "Fire"),
    makeJutsu("starter-gen-water-1", "Drowning Reflection", "Genjutsu", 40, 4, 23, 1, 125, 125, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-gen-water-2", "Moonlit Tide Dream", "Genjutsu", 60, 4, 30, 2, 250, 250, [{ name: "Decrease Damage Taken", percent: 20 }], "Water"),
    makeJutsu("starter-gen-water-3", "Mist Memory Snare", "Genjutsu", 40, 4, 20, 2, 125, 125, [{ name: "Clear Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-buki-earth-1", "Stone Kunai Rain", "Bukijutsu", 40, 4, 32, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-buki-earth-2", "Adamant Chain Pull", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Push", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-earth-3", "Obsidian Edge", "Bukijutsu", 60, 2, 26, 1, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-wind-1", "Windmill Shuriken Line", "Bukijutsu", 40, 5, 27, 1, 125, 125, [{ name: "Wound", percent: 14 }], "Wind"),
    makeJutsu("starter-buki-wind-2", "Aerial Blade Fan", "Bukijutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-wind-3", "Crosswind Needle", "Bukijutsu", 40, 5, 22, 1, 125, 125, [{ name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-lightning-1", "Charged Senbon", "Bukijutsu", 40, 5, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-buki-lightning-2", "Thunder Wire Trap", "Bukijutsu", 60, 4, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-buki-lightning-3", "Magnet Blade Return", "Bukijutsu", 40, 4, 22, 2, 125, 125, [{ name: "Reflect", percent: 20 }], "Lightning"),
    makeJutsu("starter-buki-fire-1", "Explosive Tag Flicker", "Bukijutsu", 40, 4, 25, 1, 125, 125, [{ name: "Ignition", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-2", "Flame Wire Detonation", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-3", "Searing Blade Toss", "Bukijutsu", 40, 3, 23, 1, 125, 125, [{ name: "Poison", percent: 14 }], "Fire"),
    makeJutsu("starter-buki-water-1", "Mist Needle Spread", "Bukijutsu", 40, 5, 24, 1, 125, 125, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-buki-water-2", "Torrent Chain Slash", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Siphon", percent: 16 }], "Water"),
    makeJutsu("starter-buki-water-3", "Hidden Current Guard", "Bukijutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),

    // Increase Generals utility set — 40-AP self-buff, one per discipline × element.
    // The second tag is added by rebalanceNonBloodlineJutsu from nonBloodlineTagTable.
    makeJutsu("starter-nin-earth-4", "Bedrock Chakra Focus", "Ninjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Earth"),
    makeJutsu("starter-nin-wind-4", "Galewind Attunement", "Ninjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Wind"),
    makeJutsu("starter-nin-lightning-4", "Voltaic Surge Focus", "Ninjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Lightning"),
    makeJutsu("starter-nin-fire-4", "Emberheart Kindling", "Ninjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Fire"),
    makeJutsu("starter-nin-water-4", "Tidal Renewal Rite", "Ninjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Water"),
    makeJutsu("starter-tai-earth-4", "Ironbody Conditioning", "Taijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Earth"),
    makeJutsu("starter-tai-wind-4", "Windstep Awakening", "Taijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Wind"),
    makeJutsu("starter-tai-lightning-4", "Thunderpulse Overdrive", "Taijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Lightning"),
    makeJutsu("starter-tai-fire-4", "Blazing Spirit Focus", "Taijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Fire"),
    makeJutsu("starter-tai-water-4", "Flowing Chi Harmony", "Taijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Water"),
    makeJutsu("starter-gen-earth-4", "Stoneheart Meditation", "Genjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Earth"),
    makeJutsu("starter-gen-wind-4", "Whispering Calm", "Genjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Wind"),
    makeJutsu("starter-gen-lightning-4", "Stormmind Focus", "Genjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Lightning"),
    makeJutsu("starter-gen-fire-4", "Inner Flame Vision", "Genjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Fire"),
    makeJutsu("starter-gen-water-4", "Still Water Mind", "Genjutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Water"),
    makeJutsu("starter-buki-earth-4", "Adamant Stance Drill", "Bukijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Earth"),
    makeJutsu("starter-buki-wind-4", "Swiftblade Attunement", "Bukijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Wind"),
    makeJutsu("starter-buki-lightning-4", "Charged Grip Focus", "Bukijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Lightning"),
    makeJutsu("starter-buki-fire-4", "Forgeheart Temper", "Bukijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Fire"),
    makeJutsu("starter-buki-water-4", "Rippling Edge Ritual", "Bukijutsu", 40, 4, 0, 7, 125, 125, [{ name: "Increase Generals", percent: 30 }], "Water"),

    // AOE Burst set — 60-AP OPPONENT-targeted damage jutsu, one per discipline × element.
    // method AOE_BURST: full damage to the target + every enemy in the 6 touching hexes (no
    // movement, no ground tile). Defined via normalizeJutsu (makeJutsu can't set a method)
    // and NOT listed in nonBloodlineTagTable, so rebalanceNonBloodlineJutsu passes them
    // through unchanged. Each carries ONE combat tag (like the other 60-AP damage jutsu),
    // which applies to the primary AND every splashed enemy via applyAoeSplash.
    normalizeJutsu({ id: "starter-nin-earth-aoe", name: "Seismic Shatter", type: "Ninjutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "The ground erupts beneath the enemy in a shattering seismic burst.", description: "An earthquake nova that fractures the ground around the target and everyone beside them." }),
    normalizeJutsu({ id: "starter-nin-wind-aoe", name: "Vacuum Detonation", type: "Ninjutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 16 }], battleDescription: "A compressed sphere of air implodes and detonates in a concussive burst.", description: "A vacuum blast that ruptures outward, catching the target and all who stand close." }),
    normalizeJutsu({ id: "starter-nin-lightning-aoe", name: "Forked Lightning Nova", type: "Ninjutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 16 }], battleDescription: "Lightning splits into a dozen forks and erupts across the battlefield.", description: "A branching bolt that arcs from the target to every foe touching them." }),
    normalizeJutsu({ id: "starter-nin-fire-aoe", name: "Great Fireball Burst", type: "Ninjutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 16 }], battleDescription: "A massive fireball detonates on impact, engulfing the enemy and their surroundings.", description: "A roaring fireball that bursts into a ring of flame around the target." }),
    normalizeJutsu({ id: "starter-nin-water-aoe", name: "Tidal Crash", type: "Ninjutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Drain", percent: 0 }], battleDescription: "A towering wave crashes down and floods the ground in a violent burst.", description: "A crushing tide that slams the target and washes over everyone nearby." }),
    normalizeJutsu({ id: "starter-tai-earth-aoe", name: "Fault Line Stomp", type: "Taijutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Recoil", percent: 12 }], battleDescription: "A thunderous stomp splits the earth in a shockwave of stone.", description: "A ground-shattering stomp that ruptures the earth around the target and their allies." }),
    normalizeJutsu({ id: "starter-tai-wind-aoe", name: "Whirlwind Sweep", type: "Taijutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 16 }], battleDescription: "The user spins into a whirlwind that batters everyone in reach.", description: "A cyclonic sweep that lashes the target and every foe beside them." }),
    normalizeJutsu({ id: "starter-tai-lightning-aoe", name: "Thunderclap Shockwave", type: "Taijutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 16 }], battleDescription: "A lightning-charged clap unleashes a shockwave across the field.", description: "A thunderous burst that jolts the target and all who stand close." }),
    normalizeJutsu({ id: "starter-tai-fire-aoe", name: "Blazing Spin Kick", type: "Taijutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 16 }], battleDescription: "A blazing spin kick trails fire in a scorching arc.", description: "A whirling fire kick that sears the target and the ground around them." }),
    normalizeJutsu({ id: "starter-tai-water-aoe", name: "Surging Wave Palm", type: "Taijutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Siphon", percent: 16 }], battleDescription: "A surge of water bursts from the user's palm in a crashing arc.", description: "A tidal palm strike that hurls a wave over the target and their neighbors." }),
    normalizeJutsu({ id: "starter-gen-earth-aoe", name: "Crumbling World Illusion", type: "Genjutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Poison", percent: 14 }], battleDescription: "The world seems to crumble as the earth swallows the enemy's mind.", description: "An illusion of collapsing ground that buries the target and all who share their fate." }),
    normalizeJutsu({ id: "starter-gen-wind-aoe", name: "Screaming Void", type: "Genjutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Decrease Damage Given", percent: 16 }], battleDescription: "A howling void tears open, screaming through the enemy's senses.", description: "A shrieking wind illusion that ruptures the minds of the target and those beside them." }),
    normalizeJutsu({ id: "starter-gen-lightning-aoe", name: "Blinding Flash Field", type: "Genjutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 16 }], battleDescription: "A blinding sheet of light detonates across the battlefield.", description: "A searing flash illusion that overloads the target and every foe near them." }),
    normalizeJutsu({ id: "starter-gen-fire-aoe", name: "Hellfire Mirage", type: "Genjutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 14 }], battleDescription: "Phantom hellfire erupts and consumes the enemy's world.", description: "An illusion of all-consuming fire that engulfs the target and their surroundings." }),
    normalizeJutsu({ id: "starter-gen-water-aoe", name: "Drowning Delusion", type: "Genjutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Drain", percent: 0 }], battleDescription: "A crushing tide of illusion drags the enemy under.", description: "A drowning nightmare that floods the minds of the target and those close by." }),
    normalizeJutsu({ id: "starter-buki-earth-aoe", name: "Stone Shrapnel Burst", type: "Bukijutsu", element: "Earth", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "A packed charge bursts into a hail of stone shrapnel.", description: "An exploding stone charge that peppers the target and everyone around them." }),
    normalizeJutsu({ id: "starter-buki-wind-aoe", name: "Fan Blade Storm", type: "Bukijutsu", element: "Wind", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Wound", percent: 14 }], battleDescription: "A storm of wind-borne blades fans out across the field.", description: "A spread of spinning blades on the wind that shreds the target and their neighbors." }),
    normalizeJutsu({ id: "starter-buki-lightning-aoe", name: "Charged Shuriken Spread", type: "Bukijutsu", element: "Lightning", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Increase Damage Taken", percent: 16 }], battleDescription: "A fan of charged shuriken scatters and crackles on impact.", description: "A spread of electrified shuriken that arcs into the target and all beside them." }),
    normalizeJutsu({ id: "starter-buki-fire-aoe", name: "Explosive Tag Barrage", type: "Bukijutsu", element: "Fire", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Ignition", percent: 16 }], battleDescription: "A barrage of explosive tags detonates in a chain of blasts.", description: "A volley of explosive tags that erupts around the target and their surroundings." }),
    normalizeJutsu({ id: "starter-buki-water-aoe", name: "Mist Blade Torrent", type: "Bukijutsu", element: "Water", ap: 60, range: 4, effectPower: 36, cooldown: 7, chakraCost: 250, staminaCost: 250, target: "OPPONENT", method: "AOE_BURST", tags: [{ name: "Poison", percent: 14 }], battleDescription: "A torrent of mist-wreathed blades sweeps across the enemy.", description: "A surging spread of water blades that slices the target and everyone nearby." }),

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

function makeStarterBloodlineDamageJutsu(id: string, name: string, type: JutsuType, element: string, secondaryTag: JutsuTag): Jutsu {
    return makeJutsu(id, name, type, 60, 4, 30, 7, 100, 100, [secondaryTag], element as JutsuElement);
}

function makeStarterBloodlineUtilityJutsu(id: string, name: string, type: JutsuType, element: string, tags: JutsuTag[]): Jutsu {
    return makeJutsu(id, name, type, 40, 4, 0, 7, 100, 100, tags, element as JutsuElement);
}

export const starterSavedBloodlines: SavedBloodline[] = [
    {
        id: "starter-bloodline-ashen-eyes",
        name: "Ashen Eyes",
        rank: "A Rank" as Rank,
        specialElement: "Blood",
        lore: "A cursed kekkei genkai born from a clan that broke a forbidden pact with blood spirits. Those awakened by the Ashen Eyes see the world through a veil of crimson — perceiving every living being as a tapestry of veins and chakra pathways. The afflicted can shatter hallucinations directly into their opponent's bloodstream, weaponizing the very sight of life itself. Ancient texts warn that prolonged use slowly turns the user's own eyes the color of ash and bone.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("ashen-eyes-blood-gaze", "Blood Gaze Rupture", "Genjutsu", "Blood", { name: "Wound", percent: 30 }),
            makeStarterBloodlineDamageJutsu("ashen-eyes-crimson-hall", "Crimson Hallucination", "Genjutsu", "Blood", { name: "Increase Damage Taken", percent: 35 }),
            makeStarterBloodlineDamageJutsu("ashen-eyes-vein-mirror", "Vein Mirror Nightmare", "Genjutsu", "Blood", { name: "Poison", percent: 30 }),
            makeStarterBloodlineUtilityJutsu("ashen-eyes-hematoma-veil", "Hematoma Veil", "Genjutsu", "Blood", [{ name: "Increase Damage Taken", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-inferno-cataclysm",
        name: "Inferno Cataclysm",
        rank: "A Rank" as Rank,
        specialElement: "Lava",
        lore: "Forged in the volcanic rifts of the Ember Wastes, the Inferno Cataclysm lineage merges fire and earth chakra at the cellular level. The wielder's body temperature runs far above human limits — surface veins glow faintly orange in darkness. In battle, they can compress molten rock and superheated gas into devastating projectiles or coffin-like formations that entomb the enemy in cooling lava. Survivors of their attacks are found encased in obsidian, preserved like dark statues.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-lava-burst", "Lava Burst Coffin", "Ninjutsu", "Lava", { name: "Ignition", percent: 30 }),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-molten-rain", "Molten Rainfall", "Ninjutsu", "Lava", { name: "Increase Damage Given", percent: 35 }),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-crater-lance", "Crater Lance", "Ninjutsu", "Lava", { name: "Wound", percent: 30 }),
            makeStarterBloodlineUtilityJutsu("inferno-cataclysm-obsidian-afterglow", "Obsidian Afterglow", "Ninjutsu", "Lava", [{ name: "Ignition", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-shadow-lotus",
        name: "Shadow Lotus",
        rank: "A Rank" as Rank,
        specialElement: "Shadow",
        lore: "Descended from a sect of bukijutsu assassins who trained in perpetual darkness for generations, the Shadow Lotus bloodline channels shadow-natured chakra through weapons and thrown implements. Their techniques bloom like deadly flowers from the dark — blades that trail shadow-ribbons, senbon that multiply in dim light, and wires that vanish entirely in low visibility. Their clan temple has no lanterns. They say the darkness learned to fear them first.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("shadow-lotus-umbra-senbon", "Umbra Senbon Bloom", "Bukijutsu", "Shadow", { name: "Poison", percent: 30 }),
            makeStarterBloodlineDamageJutsu("shadow-lotus-night-petal", "Night Petal Cutter", "Bukijutsu", "Shadow", { name: "Decrease Damage Taken", percent: 35 }),
            makeStarterBloodlineDamageJutsu("shadow-lotus-eclipse-wire", "Eclipse Wire Blossom", "Bukijutsu", "Shadow", { name: "Absorb", percent: 35 }),
            makeStarterBloodlineUtilityJutsu("shadow-lotus-black-petal-guard", "Black Petal Guard", "Bukijutsu", "Shadow", [{ name: "Decrease Damage Taken", percent: 30 }, { name: "Absorb", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-iron-fang",
        name: "Iron Fang",
        rank: "A Rank" as Rank,
        specialElement: "Iron",
        lore: "A taijutsu bloodline born from miners who fused raw metallic chakra into their fighting style over ten generations. Iron Fang users can coat their limbs in magnetized iron-dense chakra, turning every punch and kick into a shattering impact that tears armor and breaks weapons. Their fists leave cracked stone. Some high-level users develop iron-grey patches on their knuckles, shins, and forearms — natural battle plating grown from within. The clan motto: 'The mountain doesn't dodge. It endures. Then it falls on you.'",
        jutsus: [
            makeStarterBloodlineDamageJutsu("iron-fang-ferrous-crash", "Ferrous Fang Crash", "Taijutsu", "Iron", { name: "Wound", percent: 30 }),
            makeStarterBloodlineDamageJutsu("iron-fang-steel-maw", "Steel Maw Breaker", "Taijutsu", "Iron", { name: "Increase Damage Given", percent: 35 }),
            makeStarterBloodlineDamageJutsu("iron-fang-magnet-knuckle", "Magnet Knuckle Rend", "Taijutsu", "Iron", { name: "Decrease Damage Taken", percent: 35 }),
            makeStarterBloodlineUtilityJutsu("iron-fang-anvil-breath", "Anvil Breath Guard", "Taijutsu", "Iron", [{ name: "Increase Damage Given", percent: 30 }, { name: "Decrease Damage Taken", percent: 30 }]),
        ],
        totalPoints: 9,
    },
].map((bloodline) => ({ ...bloodline, totalPoints: bloodlinePoints(bloodline.jutsus) }));

export const jutsuTargets: JutsuTarget[] = ["OPPONENT", "SELF", "OTHER_USER", "CHARACTER", "EMPTY_GROUND"];
export const jutsuMethods: JutsuMethod[] = ["SINGLE", "ALL", "AOE_CIRCLE", "INSTANT_EFFECT", "AOE_SPIRAL", "AOE_BURST"];
export const bloodlineJutsuMethods: JutsuMethod[] = ["SINGLE", "AOE_CIRCLE", "INSTANT_EFFECT", "AOE_SPIRAL", "AOE_BURST"];
export const instantEffectGroundTags = ["Decrease Damage Given", "Recoil", "Poison"];
export const fortyApBlockedBloodlineTags = ["Pierce", "Siphon", "Mirror", "Copy", "Wound"];
