import { petCombatFamily, type PetCombatFamily } from "./pet-combat-family";
import type { PetCombatModelProfile } from "./pet-3d-models";

export type PetSignatureEntrance = "stalk" | "vault" | "descent" | "quake" | "phase" | "coil";
export type PetSignatureVictory = "prowl" | "salute" | "soar" | "roar" | "spiral" | "monolith";
export type PetSignatureMotif = "fang" | "feather" | "crest" | "shard" | "wave" | "spark" | "rune" | "crescent";

/**
 * A compact art-direction sheet for one pet. Values are stable for a species,
 * but deliberately continuous rather than three presets: every production pet
 * receives its own cadence, weight transfer, asymmetry, entrance, celebration,
 * aura arrangement, projectile hand and impact punctuation.
 */
export type PetSignaturePerformance = Readonly<{
    key: string;
    seed: number;
    family: PetCombatFamily;
    entrance: PetSignatureEntrance;
    victory: PetSignatureVictory;
    motif: PetSignatureMotif;
    asymmetry: -1 | 1;
    phase: number;
    cadence: number;
    agility: number;
    weight: number;
    stance: number;
    breath: number;
    idleRate: number;
    anticipation: number;
    strikeDrive: number;
    dodgeLift: number;
    dodgeRoll: number;
    recoil: number;
    entranceLift: number;
    entranceTwist: number;
    landingWeight: number;
    victoryLift: number;
    victoryTwist: number;
    aura: number;
    orbitCount: 2 | 3 | 4 | 5;
    orbitSpeed: number;
    orbitRadius: number;
    accent: string;
    highlight: string;
    impactScale: number;
    impactRays: 6 | 7 | 8 | 9;
    impactTwist: number;
    trailLanes: 3 | 4 | 5 | 6;
    trailSpread: number;
    projectileScale: number;
}>;

const FAMILY_DIRECTION: Readonly<Record<PetCombatFamily, Readonly<{
    entrance: PetSignatureEntrance;
    victory: PetSignatureVictory;
    motif: PetSignatureMotif;
    weight: number;
    agility: number;
    strike: number;
}>>> = Object.freeze({
    pouncer: { entrance: "stalk", victory: "prowl", motif: "fang", weight: 0.91, agility: 1.15, strike: 1.12 },
    "pack-hunter": { entrance: "phase", victory: "roar", motif: "fang", weight: 1, agility: 1.08, strike: 1.08 },
    charger: { entrance: "vault", victory: "roar", motif: "crest", weight: 1.2, agility: 0.94, strike: 1.2 },
    "burrow-grappler": { entrance: "quake", victory: "monolith", motif: "shard", weight: 1.16, agility: 0.9, strike: 1.08 },
    armored: { entrance: "quake", victory: "monolith", motif: "shard", weight: 1.35, agility: 0.78, strike: 1.18 },
    avian: { entrance: "descent", victory: "soar", motif: "feather", weight: 0.72, agility: 1.28, strike: 1.05 },
    serpentine: { entrance: "coil", victory: "spiral", motif: "crescent", weight: 0.92, agility: 1.06, strike: 1.1 },
    amphibious: { entrance: "vault", victory: "salute", motif: "wave", weight: 1.02, agility: 1.02, strike: 0.98 },
    hopper: { entrance: "vault", victory: "salute", motif: "crescent", weight: 0.7, agility: 1.34, strike: 1.04 },
    reptilian: { entrance: "stalk", victory: "prowl", motif: "fang", weight: 0.94, agility: 1.08, strike: 1.12 },
    rodent: { entrance: "phase", victory: "salute", motif: "spark", weight: 0.64, agility: 1.3, strike: 0.94 },
    primate: { entrance: "vault", victory: "salute", motif: "rune", weight: 1.05, agility: 1.02, strike: 1.15 },
    aquatic: { entrance: "coil", victory: "spiral", motif: "wave", weight: 0.9, agility: 1.02, strike: 1.02 },
    dragon: { entrance: "descent", victory: "roar", motif: "rune", weight: 1.34, agility: 0.92, strike: 1.3 },
    skirmisher: { entrance: "phase", victory: "salute", motif: "spark", weight: 0.94, agility: 1.08, strike: 1 },
});

const ELEMENT_HUE: Readonly<Record<string, number>> = Object.freeze({
    Fire: 18,
    Water: 196,
    Wind: 158,
    Lightning: 52,
    Earth: 36,
    Shadow: 276,
    None: 218,
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const rounded = (value: number): number => Number(value.toFixed(4));

export function petSignatureHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function unit(key: string, salt: string): number {
    return petSignatureHash(`${key}:${salt}`) / 0xffffffff;
}

function centered(key: string, salt: string): number {
    return unit(key, salt) * 2 - 1;
}

function rarityPower(rarity: string): number {
    if (/mythic/i.test(rarity)) return 1;
    if (/legendary/i.test(rarity)) return 0.72;
    if (/rare|epic/i.test(rarity)) return 0.38;
    return 0.12;
}

function elementTuning(element: string): Readonly<{ pace: number; weight: number; air: number; strike: number; aura: number }> {
    if (element === "Fire") return { pace: 1.03, weight: 0.96, air: 1.04, strike: 1.08, aura: 1.08 };
    if (element === "Water") return { pace: 0.98, weight: 1, air: 1.02, strike: 1, aura: 1.04 };
    if (element === "Wind") return { pace: 1.06, weight: 0.9, air: 1.15, strike: 1.02, aura: 1.02 };
    if (element === "Lightning") return { pace: 1.1, weight: 0.92, air: 1.08, strike: 1.05, aura: 1.12 };
    if (element === "Earth") return { pace: 0.91, weight: 1.16, air: 0.86, strike: 1.1, aura: 0.96 };
    if (element === "Shadow") return { pace: 1.02, weight: 0.94, air: 1.07, strike: 1.08, aura: 1.1 };
    return { pace: 1, weight: 1, air: 1, strike: 1, aura: 1 };
}

function canonicalPetKey(id: string, name: string): string {
    const stableId = id.replace(/^showdown-ai-\d+-/u, "").replace(/-\d{10,}$/u, "");
    return `${stableId || "pet"}:${name.trim().toLowerCase() || "unknown"}`;
}

/** Pure, replay-stable art direction for one pet identity. */
export function petSignaturePerformance({
    id,
    name,
    element = "None",
    rarity = "standard",
    profile = "quadruped",
}: {
    id: string;
    name: string;
    element?: string;
    rarity?: string;
    profile?: PetCombatModelProfile;
}): PetSignaturePerformance {
    const key = canonicalPetKey(id, name);
    const family = petCombatFamily({ name, profile });
    const direction = FAMILY_DIRECTION[family];
    const tier = rarityPower(rarity);
    const elemental = elementTuning(element);
    const asymmetry = unit(key, "hand") < 0.5 ? -1 : 1;
    const hue = (ELEMENT_HUE[element] ?? ELEMENT_HUE.None) + Math.round(centered(key, "hue") * 12);
    const saturation = Math.round(78 + unit(key, "saturation") * 17);
    const light = Math.round(58 + unit(key, "light") * 10);
    const highlightLight = Math.min(92, light + 19);
    const accent = `hsl(${hue} ${saturation}% ${light}%)`;
    const highlight = `hsl(${hue + Math.round(centered(key, "highlight") * 8)} ${Math.min(100, saturation + 4)}% ${highlightLight}%)`;
    const orbitCount = clamp(2 + Math.floor(unit(key, "orbit-count") * 3.999 + tier * 0.4), 2, 5) as 2 | 3 | 4 | 5;
    const impactRays = clamp(6 + Math.floor(unit(key, "impact-rays") * 3.999), 6, 9) as 6 | 7 | 8 | 9;
    const trailLanes = clamp(3 + Math.floor(unit(key, "trail-lanes") * 3.999), 3, 6) as 3 | 4 | 5 | 6;

    return Object.freeze({
        key,
        seed: petSignatureHash(key),
        family,
        entrance: direction.entrance,
        victory: direction.victory,
        motif: direction.motif,
        asymmetry,
        phase: rounded(unit(key, "phase") * Math.PI * 2),
        cadence: rounded(clamp(elemental.pace * (0.94 + unit(key, "cadence") * 0.12), 0.84, 1.18)),
        agility: rounded(clamp(direction.agility * elemental.air * (0.94 + unit(key, "agility") * 0.12), 0.68, 1.46)),
        weight: rounded(clamp(direction.weight * elemental.weight * (0.94 + unit(key, "weight") * 0.13), 0.58, 1.58)),
        stance: rounded(centered(key, "stance") * (family === "armored" || family === "dragon" ? 0.045 : 0.07)),
        breath: rounded(0.82 + unit(key, "breath") * 0.46),
        idleRate: rounded(0.86 + unit(key, "idle-rate") * 0.34),
        anticipation: rounded(0.84 + unit(key, "anticipation") * 0.36 + tier * 0.08),
        strikeDrive: rounded(clamp(direction.strike * elemental.strike * (0.92 + unit(key, "strike") * 0.16), 0.78, 1.48)),
        dodgeLift: rounded(clamp(elemental.air * (0.84 + unit(key, "dodge-lift") * 0.34), 0.72, 1.42)),
        dodgeRoll: rounded(centered(key, "dodge-roll") * 0.11 + asymmetry * 0.12),
        recoil: rounded(clamp((1.35 - direction.weight * 0.28) * (0.9 + unit(key, "recoil") * 0.18), 0.62, 1.24)),
        entranceLift: rounded(clamp(elemental.air * (0.88 + unit(key, "entrance-lift") * 0.3 + tier * 0.08), 0.76, 1.42)),
        entranceTwist: rounded((0.055 + unit(key, "entrance-twist") * 0.12) * asymmetry),
        landingWeight: rounded(clamp(direction.weight * (0.86 + unit(key, "landing") * 0.24), 0.62, 1.5)),
        victoryLift: rounded(clamp(elemental.air * (0.86 + unit(key, "victory-lift") * 0.3 + tier * 0.12), 0.76, 1.5)),
        victoryTwist: rounded((0.05 + unit(key, "victory-twist") * 0.17) * asymmetry),
        aura: rounded(clamp(elemental.aura * (0.72 + tier * 0.34 + unit(key, "aura") * 0.18), 0.68, 1.36)),
        orbitCount,
        orbitSpeed: rounded((0.38 + unit(key, "orbit-speed") * 0.72) * asymmetry),
        orbitRadius: rounded(0.78 + unit(key, "orbit-radius") * 0.34),
        accent,
        highlight,
        impactScale: rounded(clamp(direction.strike * (0.9 + tier * 0.16 + unit(key, "impact-scale") * 0.16), 0.86, 1.48)),
        impactRays,
        impactTwist: rounded(centered(key, "impact-twist") * 0.38),
        trailLanes,
        trailSpread: rounded(0.74 + unit(key, "trail-spread") * 0.46),
        projectileScale: rounded(clamp(elemental.strike * (0.88 + tier * 0.14 + unit(key, "projectile") * 0.2), 0.82, 1.42)),
    });
}
