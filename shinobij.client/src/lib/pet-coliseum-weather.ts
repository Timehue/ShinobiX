/**
 * Render-only battlefield weather for the Pet Coliseum.
 *
 * A move must actually describe arena-scale weather and must be an offensive
 * technique. This deliberately excludes names such as "Storm Aegis" and
 * "Stormrider Lunge": they keep their elemental VFX without pretending that a
 * shield or a range shift changed the sky. The result is presentation metadata
 * only and never feeds back into duel authority or elemental balance.
 */

export type PetColiseumWeatherKind =
    | "thunderstorm"
    | "gale"
    | "downpour"
    | "firestorm"
    | "blizzard"
    | "eclipse";

export type PetColiseumWeather = Readonly<{
    kind: PetColiseumWeatherKind;
    label: string;
    color: string;
    fog: string;
    particle: string;
}>;

const WEATHER: Readonly<Record<PetColiseumWeatherKind, PetColiseumWeather>> = Object.freeze({
    thunderstorm: Object.freeze({ kind: "thunderstorm", label: "Thunderfront", color: "#8f7cff", fog: "#171426", particle: "#b9d9ff" }),
    gale: Object.freeze({ kind: "gale", label: "Tempest Winds", color: "#56d9c0", fog: "#102725", particle: "#d7fff4" }),
    downpour: Object.freeze({ kind: "downpour", label: "Monsoon", color: "#2bbce1", fog: "#102638", particle: "#a8efff" }),
    firestorm: Object.freeze({ kind: "firestorm", label: "Ashfall", color: "#ff6a24", fog: "#32140d", particle: "#ffd176" }),
    blizzard: Object.freeze({ kind: "blizzard", label: "Whiteout", color: "#a9ddff", fog: "#d8efff", particle: "#f4fbff" }),
    eclipse: Object.freeze({ kind: "eclipse", label: "Eclipse", color: "#9d7cff", fog: "#120d20", particle: "#dfd2ff" }),
});

const NON_OFFENSIVE_KINDS = new Set(["absorb", "barrier", "buff", "haste", "heal", "move", "shield"]);

/** Resolve a named technique into a persistent battlefield weather state. */
export function petColiseumWeatherForMove(
    move?: string | null,
    moveKind?: string | null,
): PetColiseumWeather | null {
    const name = String(move ?? "").trim().toLowerCase();
    if (!name || NON_OFFENSIVE_KINDS.has(String(moveKind ?? "").toLowerCase())) return null;

    // More specific compound weather wins before the generic storm/tempest gate.
    if (/\b(firestorm|flame storm|emberstorm|cinderstorm|ashfall|inferno storm)\b/.test(name)) return WEATHER.firestorm;
    if (/\b(blizzard|whiteout|snowstorm|ice storm|hailstorm|frost storm)\b/.test(name)) return WEATHER.blizzard;
    if (/\b(eclipse|black sun|moonfall|sunfall)\b/.test(name)) return WEATHER.eclipse;
    if (/\b(monsoon|downpour|rainstorm|cloudburst|typhoon|deluge)\b/.test(name)) return WEATHER.downpour;
    if (/\b(tornado|cyclone|hurricane|gale|whirlwind)\b/.test(name)) return WEATHER.gale;
    if (/\b(thunderstorm|tempest|storm|thunderfront|worldstorm)\b/.test(name)) return WEATHER.thunderstorm;
    return null;
}

/** Arena weather owns a full phrase, not a one-frame hit accent. */
export function petColiseumWeatherDurationTicks(ticksPerSecond: number): number {
    return Math.max(1, Math.round(Math.max(1, ticksPerSecond) * 8.5));
}
