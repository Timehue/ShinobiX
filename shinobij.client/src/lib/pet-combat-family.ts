import type { PetCombatModelProfile } from "./pet-3d-models";

export type PetCombatFamily =
    | "pouncer"
    | "pack-hunter"
    | "charger"
    | "burrow-grappler"
    | "armored"
    | "avian"
    | "serpentine"
    | "amphibious"
    | "hopper"
    | "reptilian"
    | "rodent"
    | "primate"
    | "aquatic"
    | "dragon"
    | "skirmisher";

export type PetCombatFamilyPresentation = Readonly<{
    family: PetCombatFamily;
    label: string;
    tell: string;
    motif: string;
}>;

const FAMILY_PRESENTATION: Readonly<Record<PetCombatFamily, Omit<PetCombatFamilyPresentation, "family">>> = Object.freeze({
    pouncer: { label: "Pouncer", tell: "stalk · coil · leap", motif: "⌁" },
    "pack-hunter": { label: "Pack Hunter", tell: "circle · feint · intercept", motif: "◇" },
    charger: { label: "Charger", tell: "display · brace · drive", motif: "➤" },
    "burrow-grappler": { label: "Grappler", tell: "dig · slip · launch", motif: "⤒" },
    armored: { label: "Bulwark", tell: "withdraw · absorb · counter", motif: "⬢" },
    avian: { label: "Sky Hunter", tell: "flare · rise · dive", motif: "⌃" },
    serpentine: { label: "Coil Hunter", tell: "coil · sway · surge", motif: "∿" },
    amphibious: { label: "Wave Rider", tell: "roll · slide · sweep", motif: "≋" },
    hopper: { label: "Spring Fighter", tell: "listen · load · bound", motif: "↟" },
    reptilian: { label: "Snap Hunter", tell: "freeze · flick · snap", motif: "⟢" },
    rodent: { label: "Scrapper", tell: "scurry · juke · swarm", motif: "»" },
    primate: { label: "Technical Brawler", tell: "measure · climb · combo", motif: "✊" },
    aquatic: { label: "Undertow Hunter", tell: "drift · coil · engulf", motif: "≋" },
    dragon: { label: "Apex Wyrm", tell: "loom · gather · overrun", motif: "◆" },
    skirmisher: { label: "Skirmisher", tell: "probe · evade · combo", motif: "✦" },
});

const PACK_HUNTER = /\b(wolf|direwolf|hound|jackal|coyote|hyena|raiju|fenrir)\b/i;
const POUNCER = /\b(fox|kitsune|cat|lynx|ocelot|tiger|lion|panther|leopard|caracal|serval|ferret|weasel|mink|marten|mongoose|polecat|stoat|cub)\b/i;
const CHARGER = /\b(boar|deer|stag|ram|bull|rhino|tapir|bison|yak|buffalo|elk|ibex|goat|oryx|kirin|pegasus)\b/i;
const BURROW_GRAPPLER = /\b(mole|badger|wombat|aardvark|porcupine|hedgehog|marmot|armadillo|pangolin)\b/i;
const ARMORED = /\b(turtle|tortoise|beetle|crab|golem|gargoyle|treant|titan|colossus|behemoth|bear)\b/i;
const AMPHIBIOUS = /\b(selkie|seal|otter|frog|toad|newt|axolotl|salamander|capybara|penguin)\b/i;
const HOPPER = /\b(rabbit|hare|jerboa)\b/i;
const REPTILIAN = /\b(lizard|gecko|skink|chameleon|iguana)\b/i;
const RODENT = /\b(rat|mouse|vole|shrew|pup|meerkat)\b/i;
const PRIMATE = /\b(monkey|ape|gorilla|baboon|macaque|raijin)\b/i;
const AQUATIC = /\b(minnow|eel|kraken|octopus|squid|fish|shark|ray)\b/i;
const DRAGON = /\b(dragon|drake|wyvern|ryujin|leviathan|wyrm)\b/i;
const SERPENTINE = /\b(snake|viper|serpent|cobra|python|anaconda)\b/i;
const SKY_HUNTER = /\b(hawk|crow|owl|crane|gull|bat|moth|heron|finch|swift|swallow|magpie|sparrow|shrike|quail|raven|falcon|kestrel|cormorant|harrier|osprey|tern|plover|albatross|buzzard|phoenix|garuda|roc|suzaku|duck|chick)\b/i;

/**
 * Presentation-only animal vocabulary layered over the certified locomotion
 * profile. Explicit species words win; the approved model profile is the safe
 * fallback for fantasy creatures and future roster additions.
 */
export function petCombatFamily(pet: {
    name?: string | null;
    profile?: PetCombatModelProfile | null;
}): PetCombatFamily {
    const name = String(pet.name ?? "");
    // Named hybrids and mythic creatures are resolved before shared body words
    // such as "turtle" or "lion" can force them into a less expressive family.
    if (/\bturtle duck\b/i.test(name)) return "avian";
    if (DRAGON.test(name)) return "dragon";
    if (SERPENTINE.test(name)) return "serpentine";
    if (SKY_HUNTER.test(name)) return "avian";
    if (PACK_HUNTER.test(name)) return "pack-hunter";
    if (POUNCER.test(name)) return "pouncer";
    if (CHARGER.test(name)) return "charger";
    if (BURROW_GRAPPLER.test(name)) return "burrow-grappler";
    if (ARMORED.test(name)) return "armored";
    if (AMPHIBIOUS.test(name)) return "amphibious";
    if (HOPPER.test(name)) return "hopper";
    if (REPTILIAN.test(name)) return "reptilian";
    if (RODENT.test(name)) return "rodent";
    if (PRIMATE.test(name)) return "primate";
    if (AQUATIC.test(name)) return "aquatic";
    if (pet.profile === "avian") return "avian";
    if (pet.profile === "serpentine") return "serpentine";
    if (pet.profile === "heavy") return "armored";
    if (pet.profile === "quadruped") return "pouncer";
    return "skirmisher";
}

export function petCombatFamilyPresentation(pet: {
    name?: string | null;
    profile?: PetCombatModelProfile | null;
}): PetCombatFamilyPresentation {
    const family = petCombatFamily(pet);
    return { family, ...FAMILY_PRESENTATION[family] };
}
