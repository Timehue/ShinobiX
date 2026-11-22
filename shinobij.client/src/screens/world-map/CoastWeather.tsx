import { resolveSectorWeather } from "../../../../shared/sector-weather";
import { weatherEffects } from "../../data/world";
import { serverClockOffsetMs } from "../../lib/server-clock";
import { useSharedNow } from "../../lib/use-shared-now";
import type { CoastLand } from "./coast-service";

export function CoastWeather({ sector, biome, area }: { sector: number; biome: string; area?: CoastLand }) {
    const now = useSharedNow() + serverClockOffsetMs();
    // The scheduled sky can turn while the land status reply remains on screen.
    const sky = area?.sky;
    const weather = sky?.fixed ? sky.weather : resolveSectorWeather(biome, sector, now);
    const { name, effect } = weatherEffects[weather];
    return <span className="coast-sky">
        <strong>{name}</strong>
        <span>{effect}</span>
        {sky?.fixed && area?.holder && <span>Kept so by {area.holder.clan}</span>}
    </span>;
}

