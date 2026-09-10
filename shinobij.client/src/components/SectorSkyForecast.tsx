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
 * taken on this component's own tick. They cannot disagree, because there is
 * nothing for them to disagree with.
 *
 * The tick lives here rather than in the screen deliberately. WorldMap could
 * re-derive the sky for its whole subtree in one line, but that means
 * re-rendering the entire world map on a timer, and this screen's render cost is
 * already a known sore spot. A leaf that repaints a span a minute is not.
 *
 * `fallback` is the sky the caller already had (the plate's own prop): rendered
 * for the single frame before the mount effect runs, so first paint is exactly
 * what it was before this component existed — no flash, no layout shift.
 *
 * $0: pure computation, no assets, no network, no storage.
 */
import { useEffect, useState } from "react";
import { FORECAST_REFRESH_MS, sectorSkyLine, type SectorSkyLine } from "../lib/sector-forecast";
import { weatherEffects } from "../data/world";
import type { Biome, WeatherType } from "../types/core";

/**
 * `kicker` — "Rainstorm · Thunderstorm in 18m" (the plate's sky line).
 * `name`   — the sky's name alone (the scene title, which has no room for more).
 * `effect` — the combat-modifier sentence, as the <p> the plate already styles.
 */
type Variant = "kicker" | "name" | "effect";

export function SectorSkyForecast({
    sector,
    biome,
    fallback,
    variant = "kicker",
}: {
    sector: number;
    biome: Biome;
    fallback?: WeatherType;
    variant?: Variant;
}) {
    // Never read the clock during render (react-hooks purity): the mount effect
    // fills this in on its first pass, one frame later. The reading is stamped
    // with the place it was taken, so walking into a new sector falls back to
    // this render's own `fallback` prop rather than naming the sector just left
    // for the frame before the effect re-runs.
    const [reading, setReading] = useState<{ place: string; line: SectorSkyLine } | null>(null);
    const place = `${sector}:${biome}`;

    useEffect(() => {
        const here = `${sector}:${biome}`;
        let timer = 0;
        const apply = () => setReading({ place: here, line: sectorSkyLine(sector, biome) });
        apply();
        const start = () => { if (!timer) timer = window.setInterval(apply, FORECAST_REFRESH_MS); };
        const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };
        start();
        // A backgrounded tab must not hold a timer, and must not come back showing
        // the sky it left on — re-read before repainting.
        const onVis = () => { if (document.hidden) stop(); else { apply(); start(); } };
        document.addEventListener("visibilitychange", onVis);
        return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    }, [sector, biome]);

    const line = reading && reading.place === place ? reading.line : null;
    const weather: WeatherType | undefined = line ? line.now : fallback;
    const entry = weather ? weatherEffects[weather] : undefined;

    if (variant === "effect") return <p>{entry?.effect ?? ""}</p>;
    if (variant === "name") return <>{entry?.name ?? ""}</>;

    return (
        <>
            {entry?.name ?? ""}
            {line && <SkyChange line={line} />}
        </>
    );
}

/**
 * The "…turning to Thunderstorm in 18m" clause. Split out so the sky's own name
 * renders on the very first frame from `fallback` while the clause waits for a
 * real reading — a countdown is the one thing that must never be guessed.
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
