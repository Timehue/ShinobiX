import type { QuestLinesList } from "../../lib/quest-lines-api";

type AtlasGoalsSource = Pick<QuestLinesList, "lines" | "sites" | "coast">;
type AtlasGoal = { questId: string; text: string };

/** Describe active objectives at server-marked destinations; never infer new pins or access. */
export function coastAtlasGoals(quests: AtlasGoalsSource | null): Map<number, AtlasGoal[]> {
    const goals = new Map<number, AtlasGoal[]>();
    for (const line of quests?.lines ?? []) {
        const stage = line.stage;
        if (line.world !== "coast" || line.state !== "active" || !stage?.text) continue;
        const destinations = new Set<number>();
        if (stage.place) destinations.add(stage.place.sector);
        if (stage.kind === "gather") {
            for (const site of quests?.sites ?? []) {
                if (site.questId === line.id && !site.kept && site.itemId === stage.need?.itemId
                    && quests?.coast.places?.some(mark => mark.sector === site.sector && (mark.site === undefined || mark.site === site.id))) {
                    destinations.add(site.sector);
                }
            }
        }
        for (const sector of destinations) {
            if (!quests?.coast.places?.some(mark => mark.sector === sector)) continue;
            const progress = stage.need;
            const target = stage.deliveryReservation?.target ?? progress?.count;
            const count = progress && target !== undefined ? ` (${Math.min(progress.have, target)}/${target})` : "";
            const warning = stage.deliveryReservation ? ` ${stage.deliveryReservation.message}` : "";
            const goal = { questId: line.id, text: `${line.title}: ${stage.text}${count}${warning}` };
            goals.set(sector, [...(goals.get(sector) ?? []), goal]);
        }
    }
    return goals;
}
