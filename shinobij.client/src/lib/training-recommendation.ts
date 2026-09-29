import type { Character } from "../types/character";
import type { SavedBloodline, Stats } from "../types/combat";
import { statCapForLevel } from "../constants/game";
import { getCharacterBloodlines } from "./bloodline";
import { formatStatName } from "./stats";

// These general stats enter BOTH getOffense and getDefense for the discipline.
// The first is a stable beginner recommendation, not a claim of a unique optimum.
const PATHS = {
    Ninjutsu: ["willpower", "speed", "ninjutsuOffense", "ninjutsuDefense"],
    Taijutsu: ["strength", "speed", "taijutsuOffense", "taijutsuDefense"],
    Genjutsu: ["intelligence", "willpower", "genjutsuOffense", "genjutsuDefense"],
    Bukijutsu: ["intelligence", "strength", "bukijutsuOffense", "bukijutsuDefense"],
} as const satisfies Record<string, readonly (keyof Stats)[]>;
type Discipline = keyof typeof PATHS;
const isDiscipline = (value: string): value is Discipline => Object.hasOwn(PATHS, value);

/** Shared by the stat tile, Academy companion, and journey hint. */
export function trainingRecommendation(character: Pick<Character, "bloodline" | "equippedBloodlineId" | "specialty" | "level" | "stats">, savedBloodlines: SavedBloodline[] = []) {
    const bloodline = getCharacterBloodlines(character, savedBloodlines)[0];
    const damageJutsus = bloodline?.jutsus.filter(j => j.effectPower > 0 && j.isUtility !== true
        && (j.isUtility === false || j.ap !== 40)) ?? [];
    const candidates = damageJutsus.length ? damageJutsus : bloodline?.jutsus ?? [];
    const counts = new Map<Discipline, number>();
    for (const jutsu of candidates) if (isDiscipline(jutsu.type)) counts.set(jutsu.type, (counts.get(jutsu.type) ?? 0) + 1);
    const specialty = isDiscipline(character.specialty ?? "") ? character.specialty as Discipline : "Ninjutsu";
    const discipline = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!)
        || Number(b === specialty) - Number(a === specialty) || a.localeCompare(b))[0] ?? specialty;
    const path = PATHS[discipline];
    const cap = statCapForLevel(character.level);
    const stat: keyof Stats = path.find(key => (character.stats?.[key] ?? 10) < cap) ?? path[0];
    const label = formatStatName(stat);
    const capped = (character.stats?.[stat] ?? 10) >= cap;
    const source = counts.size > 0 && bloodline ? bloodline.name : `${discipline} specialty`;
    const basis = counts.size > 0 && bloodline
        ? `Your ${bloodline.name} bloodline ${counts.size > 1 ? "leans toward" : "uses"} ${discipline} offense.`
        : `This starting plan follows ${discipline} offense${isDiscipline(character.specialty ?? "") ? ", your specialty" : " as a general fallback"}.`;
    const generalStats = [path[0], path[1]];
    const generalNames = generalStats.map(formatStatName);
    const availableGenerals = generalStats.filter(key => (character.stats?.[key] ?? 10) < cap);
    const generalExplanation = `Its supporting general stats are ${generalNames.join(" and ")}.`;
    const benefit = capped ? "These stats are at your rank cap; training gains go to your unspent stat pool."
        : stat === path[2] ? `${label} strengthens your ${discipline} hits.`
            : stat === path[3] ? `${label} improves your defense against ${discipline}.`
                : `${label} strengthens your ${discipline} hits and defense against ${discipline}.`;
    const reason = `${basis} ${generalExplanation} ${benefit}`;
    const advice = availableGenerals.length === 2
        ? `I'd start with ${generalNames.join(" or ")}. Both general stats strengthen your ${discipline} attack and defense.`
        : `${generalExplanation} I'd start with ${label}. ${benefit}`;
    return { stat, label, discipline, source, reason, capped,
        generalStats,
        companionLine: `${basis} ${advice} Try 15m; we can explore while it runs.`,
        supportingStats: path.map(formatStatName).join(", "),
    };
}
