/*
 * SectorSkyForecast — everything the sector plate says about the sky, from one
 * live reading: the sky overhead, what it does in a fight, and what is coming.
 *
 * WHY THIS OWNS THE READING RATHER THAN TAKING IT AS A PROP
 * --------------------------------------------------------
 * Weather used to rotate once per real day, so a value derived when the player
 * walked into a sector stayed true for the whole session. It now turns three
 * times per in-world day (shared/sector-weather) — every 40 real minutes — and
 * neither App nor WorldMap re-renders on a timer, so a sky captured at entry
 * goes stale where the player can see it. Worse, a countdown rendered beside a
 * stale name is a plate that contradicts itself: "Clear Skies · Rainstorm in 0m".
 *
 * So the name, the combat effect and the countdown all come from ONE reading
 * on the shared app clock. They cannot drift between the profile and sector HUD.
 *
 * Each consumer is a small leaf, so the shared clock does not repaint the whole map.
 *
 * $0: pure computation, no assets, no network, no storage.
 */
import { sectorSkyLine, type SectorSkyLine } from "../lib/sector-forecast";
import { weatherEffects } from "../data/world";
import type { Biome } from "../types/core";
import { useSharedNow } from "../lib/use-shared-now";
import { serverClockOffsetMs } from "../lib/server-clock";
import { isWorldNight } from "../../../shared/world-phase";

/**
 * `kicker` — "Rainstorm · Thunderstorm in 18m" (the plate's sky line).
 * `name`   — the sky's name alone (the scene title, which has no room for more).
 * `effect` — the combat-modifier sentence, as the <p> the plate already styles.
 */
type Variant = "kicker" | "name" | "effect";

export function SectorSkyForecast({
    sector,
    biome,
    variant = "kicker",
}: {
    sector: number;
    biome: Biome;
    variant?: Variant;
}) {
    // Every weather plate subscribes to the same clock store. The profile rail,
    // mobile sheet and sector HUD therefore derive the same window on the same
    // render tick, including a clock correction from the server.
    const now = useSharedNow() + serverClockOffsetMs();
    const line = sectorSkyLine(sector, biome, now);
    const entry = weatherEffects[line.now];
    const night = isWorldNight(now);

    if (variant === "effect") {
        return <p>{entry?.effect ?? ""}{night ? `${entry?.effect ? " " : ""}Night: some wild pets only come out now, and night ninjas hunt the roads.` : ""}</p>;
    }
    if (variant === "name") return <>{entry?.name ?? "Weather unavailable"}</>;

    return (
        <>
            <span className="sector-sky-current">{entry?.name ?? "Weather unavailable"}</span>
            <SkyChange line={line} />
        </>
    );
}

/**
 * The "…turning to Thunderstorm in 18m" clause. Split out so the sky's own name
 * renders from the same shared reading as the name above.
 */
function SkyChange({ line }: { line: SectorSkyLine }) {
    // A clan holding the sector stamps the sky and it holds until they change it
    // or lose the ground. There is no schedule to count down to, and inventing
    // one would promise a change that is never coming.
    if (line.stamped) return <span className="sector-sky-forecast is-stamped">held by the clan</span>;
    // The chain deliberately holds a front for several windows; a settled spell
    // is a true answer, not a missing one.
    if (!line.next) return <span className="sector-sky-forecast">settled</span>;
    return <span className="sector-sky-forecast">{line.nextName} in {line.inLabel}</span>;
}
