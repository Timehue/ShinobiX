import { useState } from "react";
import type { CoastWorld, QuestLinesList } from "../../lib/quest-lines-api";

const kinds = ["Unfinished work", "Building jobs", "Fieldwork", "Fishing", "Mining", "Harvesting"] as const;
type Kind = typeof kinds[number];

export function CoastWorkRoutes({ world, quests, sector, busy, go }: {
    world: CoastWorld; quests: QuestLinesList | null; sector: number; busy: boolean; go: (at: number) => void;
}) {
    const [kind, setKind] = useState<Kind>("Unfinished work");
    const stops = world.points.flatMap(({ sector: at, region }) => {
        const layout = world.sectors[at];
        if (!layout || !quests || region > quests.coast.region || quests.coast.sealed?.includes(at)) return [];
        let activities: string[];
        if (kind === "Building jobs") activities = layout.sites.flatMap(site => site.duty ? [site.duty] : []);
        else if (kind === "Unfinished work" || kind === "Fieldwork") {
            activities = (world.jobs ?? []).flatMap(job => {
                const index = quests.coastWork?.[job.id] ?? 0;
                return job.steps[index]?.sector === at && (kind === "Fieldwork" || index > 0) ? [job.title] : [];
            });
            if (kind === "Unfinished work") activities.push(...layout.sites.flatMap(site =>
                site.duty && quests.notebook?.[site.id]?.active ? [site.duty] : []));
        } else activities = (layout.resources ?? []).filter(node => node.activity === kind.toLowerCase()).map(node => node.name);
        return activities.length ? [{ at, name: layout.name, activities }] : [];
    });
    return <details className="coast-work-routes"><summary>Find work and gathering</summary>
        <label>Show <select value={kind} onChange={e => setKind(e.target.value as Kind)}>
            {kinds.map(value => <option key={value}>{value}</option>)}
        </select></label>
        {stops.length ? <ul>{stops.map(stop => <li key={stop.at}>
            <button type="button" disabled={busy} onClick={() => go(stop.at)}>
                {stop.at === sector ? "Here" : "Travel"} · {stop.name} ({stop.at})
            </button><span>{stop.activities.join(" · ")}</span>
        </li>)}</ul> : <p role="status">{!quests ? "Reading your coast record…" : kind === "Unfinished work"
            ? "Your notebook has no unfinished orders. Choose a trade to find work." : "No location in your open regions offers this work yet."}</p>}
    </details>;
}
