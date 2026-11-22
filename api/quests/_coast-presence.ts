/*
 * Who a player sees standing on the coast, and where their quests have
 * something for them to do.
 *
 * The quests name people and places: "Find the boatwright", "Ask the keeper of
 * the Record House". Until this, nobody stood there, and nothing on the map
 * said where to go. Two lists are worked out here and sent with the quest list:
 *
 *   - `figures`: each keeper at the door of the counter they keep, always, and
 *     the boss of a quest whose next step is that fight, at the place it is
 *     fought. A figure is drawn with the cast member's own world model.
 *   - `marks`: the sectors, and the sites in them, where a quest can be taken
 *     or moved on right now.
 *
 * Presentation only. Nothing here decides whether a step can be done; the
 * quest handler still checks where the player really stands.
 */
import { coastCastMember, coastCastPortrait } from '../../shared/coast-cast.js';
import { coastLayout, coastSite, coastSitesInSector, type CoastSiteRef } from '../../shared/coast-world.js';
import type { QuestEngineDeps, QuestLineView } from './_engine.js';
import type { QuestLinesRecord } from './_record.js';
import { questStageFightId, type QuestLineStage } from './_types.js';

export interface CoastFigure {
    sector: number;
    /** The tile the figure stands on: the doorway of `site`. */
    tile: number;
    /** What the figure is called when hovered or read out: a name and who they are. */
    label: string;
    /** The cast member's world model (shared/coast-cast.ts). */
    model: string;
    /** Their painted cut-out, drawn when world models are off (a player may choose 2D figures) or not loaded yet. */
    image?: string;
    /** The site the figure stands at. Choosing the figure goes there. */
    site: string;
    /** True for a quest's boss, waiting to be fought. */
    boss?: true;
    /**
     * Where a keeper stands inside their site's ground-floor room, in tiles from
     * the room's top left corner: at the station they work, on its far side from
     * the floor. Absent for a boss and for a site that has no room.
     */
    room?: [x: number, y: number];
}
export interface CoastQuestMark { sector: number; site?: string }

const GRID = 12;
/** The middle of a site's front edge: where someone standing in its doorway would be. */
function doorway(site: CoastSiteRef): number {
    const [x, y, size] = site.footprint;
    return (y + size - 1) * GRID + x + Math.floor(size / 2);
}

const pictured = (castId: string) => { const image = coastCastPortrait(castId); return image ? { image } : {}; };

const buildingOf =(stage: QuestLineStage | undefined) =>
    stage && (stage.kind === 'enter' || stage.kind === 'make' || stage.kind === 'deliver') ? coastSite(stage.buildingId) : undefined;

/** Where a fight in this sector is met: its garrison, gate or hold when it has one, else the first place that is not a gathering site, a plot or a dock. */
function fightSite(sector: number): CoastSiteRef | undefined {
    const sites = coastSitesInSector(sector);
    return sites.find(site => /garrison|fort|gate|hold|watch/.test(site.id))
        ?? sites.find(site => !/harvest|mine|fish|plot|dock/.test(site.id))
        ?? sites[0];
}

/**
 * The counter each keeper keeps: the first place on the coast one of their
 * quests begins. Worked out from the catalogue, so a keeper given a new quest
 * needs nothing added here.
 */
export function coastKeeperSites(deps: Pick<QuestEngineDeps, 'catalogue'>): Record<string, CoastSiteRef> {
    const out: Record<string, CoastSiteRef> = {};
    for (const line of Object.values(deps.catalogue.lines)) {
        if (Object.hasOwn(out, line.giver) || !coastCastMember(line.giver)) continue;
        const site = line.stages.map(buildingOf).find(Boolean);
        if (site) out[line.giver] = site;
    }
    return out;
}

/**
 * The station in their room a keeper works at, by its name in the room's own
 * data, for the rooms whose first station is not the keeper's. Everyone else
 * stands at their room's first station. A test holds every name here to a
 * station that exists.
 */
export const KEEPER_POSTS: Readonly<Record<string, string>> = { 'slip-boatwright': 'Joiner’s bench', 'relay-keeper': 'Dispatch desk' };

/** Where a keeper stands inside their site: the middle of the far row of their station. */
export function keeperPost(castId: string, site: CoastSiteRef): [number, number] | undefined {
    const stations = site.floors[0]?.stations ?? [];
    const station = stations.find(entry => entry.name === KEEPER_POSTS[castId]) ?? stations[0];
    if (!station) return undefined;
    const [x, y, width] = station.target;
    return [x + width / 2, y + 0.5];
}

export function coastQuestPresence(
    deps: Pick<QuestEngineDeps, 'catalogue'>,
    record: QuestLinesRecord,
    views: readonly Pick<QuestLineView, 'id' | 'state'>[],
): { figures: CoastFigure[]; marks: CoastQuestMark[] } {
    const figures: CoastFigure[] = [];
    for (const [castId, site] of Object.entries(coastKeeperSites(deps))) {
        const member = coastCastMember(castId)!;
        const room = keeperPost(castId, site);
        figures.push({ sector: site.sector, tile: doorway(site), label: `${member.name}, ${member.title}`, model: member.model, site: site.id, ...pictured(castId), ...(room ? { room } : {}) });
    }

    const marks: CoastQuestMark[] = [];
    const mark = (sector: number, site?: string) => {
        if (!coastLayout(sector) || marks.some(row => row.sector === sector && row.site === site)) return;
        marks.push({ sector, ...(site ? { site } : {}) });
    };
    for (const view of views) {
        const line = deps.catalogue.lines[view.id];
        const active = record.active[view.id];
        const stage = view.state === 'open' ? line.stages[0] : view.state === 'active' && active ? line.stages[active.stage] : undefined;
        if (!stage) continue;
        const building = buildingOf(stage);
        if (building) mark(building.sector, building.id);
        else if (stage.kind === 'speak' || stage.kind === 'reach') mark(stage.place.sector);
        else if (stage.kind === 'gather') for (const id of stage.siteIds) { const site = coastSite(id); if (site) mark(site.sector, site.id); }
        else if (stage.kind === 'drop' || stage.kind === 'boss') {
            const fight = deps.catalogue.fights[questStageFightId(stage, active?.choices)];
            const site = fight ? fightSite(fight.sector) : undefined;
            if (!fight) continue;
            mark(fight.sector, site?.id);
            // The boss stands where the quest says it is fought, until it is beaten.
            const member = stage.kind === 'boss' ? coastCastMember(fight.castId) : undefined;
            if (member && site) figures.push({ sector: fight.sector, tile: doorway(site), label: `${member.name}, ${member.title}`, model: member.model, site: site.id, boss: true, ...pictured(fight.castId) });
        }
    }
    return { figures, marks };
}
