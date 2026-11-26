/*
 * Quest sites as gathering nodes.
 *
 * A quest site (shared/quest-sites.ts) is worked through the ordinary gathering
 * route (api/world/resource.ts): the same tool, skill, daily allowance, tool
 * wear, minigame and skill XP as any node. This file is the adapter that lets
 * that route see a site as a node, and the three places it differs:
 *
 *   - it is found here, not in the home node tables, so no home site reshuffles;
 *   - it is never shared: attempts are the player's own, so one player working
 *     a site never blocks the next player on the same quest step;
 *   - it can be worked only by a player whose quest has reached the stage that
 *     sends them there, and it stays workable for the rest of that quest, so a
 *     tool lost in a failed fight can always be made again.
 *
 * Pure apart from reading the active catalogue: no KV, auth or locks.
 */
import { countOwned } from '../craft/_forge.js';
import { COAST_WORLD_VERSION, coastLayout, coastSite } from '../../shared/coast-world.js';
import { COAST_GRID, coastTileWalkable } from '../../shared/coast-world-rules.js';
import { QUEST_SITES, QUEST_SITE_ATTEMPTS, questSite } from '../../shared/quest-sites.js';
import { resourceNodeState, type ResourceGatheringState } from '../../shared/resource-gathering.js';
import { resourceNode, type GatherFamily, type ResourceNode, type ResourceNodeLevel } from '../../shared/resource-nodes.js';
import { activeQuestCatalogue } from './_active-catalogue.js';
import { parseQuestLines } from './_record.js';

const nodes = new Map<string, ResourceNode | null>();

/** The gathering node a quest site is, or undefined when the id is not a placed quest site. */
export function questSiteNode(id: unknown): ResourceNode | undefined {
    const site = questSite(id);
    if (!site) return undefined;
    let node = nodes.get(site.id);
    if (node === undefined) {
        const place = coastSite(site.id);
        node = place ? {
            id: site.id, name: place.name, activity: site.activity, sector: place.sector,
            approach: place.approach,
            // The painted landmark's own ground: the first tile of its footprint.
            target: place.footprint[1] * COAST_GRID + place.footprint[0],
            difficulty: site.level as ResourceNodeLevel,
            ceiling: 0,
            // A site pays its quest material and nothing else (resolveResourceAttempt).
            family: site.itemId as GatherFamily,
            layoutVersion: COAST_WORLD_VERSION,
        } : null;
        nodes.set(site.id, node);
    }
    return node ?? undefined;
}

/** Any place the gathering route can work: a home node, or a quest site. */
export function gatherNode(id: unknown): ResourceNode | undefined {
    return resourceNode(id) ?? questSiteNode(id);
}

/** A quest site can be worked while its sector is open and its approach tile can be stood on. */
export function questSiteWorkable(node: ResourceNode): boolean {
    const mask = coastLayout(node.sector)?.mask;
    return !!mask && questSiteNode(node.id)?.approach === node.approach && coastTileWalkable(mask, node.approach);
}

/** The current Rounds II cord errand, never another use of this shared site. */
export function saltstairCordBatch(save: Record<string, unknown>, character: Record<string, unknown>, siteId: string | undefined, mode: unknown): { stageAt: number; count: number } | undefined {
    if (siteId !== 'saltstair-harvest-102' || mode !== 'relaxed') return undefined;
    const questId = 'saltstair-rounds-2';
    const active = parseQuestLines(save.questLines).active[questId];
    if (!active) return undefined;
    const stage = activeQuestCatalogue().lines[questId]?.stages[active.stage];
    if (stage?.kind !== 'gather' || stage.key !== 'gather-1' || stage.itemId !== 'quest-wrack-cord'
        || stage.count !== 6 || !stage.siteIds.includes(siteId)) return undefined;
    const count = Math.min(2, stage.count - countOwned(character, stage.itemId));
    return count > 0 ? { stageAt: active.at, count } : undefined;
}

/**
 * Why this player may not work a quest site, as a sentence they can read, or
 * null when they may. Read from the stored save: the client never says which
 * quest it is on.
 */
export function questSiteRefusal(save: Record<string, unknown>, siteId: string): string | null {
    const catalogue = activeQuestCatalogue();
    const lines = parseQuestLines(save.questLines);
    // A site a finished quest earned stays open for good.
    const keptBy = questSite(siteId)?.keptBy;
    if (keptBy && lines.done[keptBy]) return null;
    for (const [questId, active] of Object.entries(lines.active)) {
        const line = Object.hasOwn(catalogue.lines, questId) ? catalogue.lines[questId] : undefined;
        if (!line) continue;
        const reached = line.stages.some((stage, index) => index <= active.stage && stage.kind === 'gather' && stage.siteIds.includes(siteId));
        if (reached) return null;
    }
    return 'There is nothing here you have a use for yet. A quest will send you back.';
}

export interface QuestSiteView {
    id: string;
    name: string;
    questId: string;
    sector: number;
    /** The tile to stand on, and the tile the marker sits on. */
    approach: number;
    target: number;
    activity: ResourceNode['activity'];
    /** The gathering skill level the site needs. */
    level: number;
    itemId: string;
    /** How many the stage asks for, and how many are in the backpack. */
    need: number;
    have: number;
    /** The player's own attempts left before the site must refill for them. */
    remaining: number;
    refillAt: number;
    /** True for a site a finished quest earned: it is open for good and asks for nothing. */
    kept?: true;
}

/** The sites the player's quests have opened for them, for the map and the quest tab. */
export function questSiteViews(save: Record<string, unknown>, character: Record<string, unknown>, now: number): QuestSiteView[] {
    const catalogue = activeQuestCatalogue();
    const lines = parseQuestLines(save.questLines);
    const gathering = (character.resourceGathering && typeof character.resourceGathering === 'object'
        ? character.resourceGathering : {}) as Partial<ResourceGatheringState>;
    const views = new Map<string, QuestSiteView>();
    for (const [questId, active] of Object.entries(lines.active)) {
        const line = Object.hasOwn(catalogue.lines, questId) ? catalogue.lines[questId] : undefined;
        if (!line) continue;
        line.stages.forEach((stage, index) => {
            if (index > active.stage || stage.kind !== 'gather') return;
            for (const siteId of stage.siteIds) {
                const node = questSiteNode(siteId);
                if (!node || views.has(siteId)) continue;
                const mine = resourceNodeState(gathering.nodes?.[siteId], now);
                views.set(siteId, {
                    id: siteId, name: node.name, questId, sector: node.sector, approach: node.approach, target: node.target,
                    activity: node.activity, level: node.difficulty, itemId: stage.itemId,
                    need: stage.count, have: countOwned(character, stage.itemId),
                    remaining: Math.max(0, QUEST_SITE_ATTEMPTS - mine.attempts), refillAt: mine.refillAt,
                });
            }
        });
    }
    // Sites a finished quest earned. Nothing is asked for any more: `need` is 0.
    for (const site of Object.values(QUEST_SITES)) {
        if (!site.keptBy || !lines.done[site.keptBy] || views.has(site.id)) continue;
        const node = questSiteNode(site.id);
        if (!node) continue;
        const mine = resourceNodeState(gathering.nodes?.[site.id], now);
        views.set(site.id, {
            id: site.id, name: node.name, questId: site.keptBy, sector: node.sector, approach: node.approach, target: node.target,
            activity: node.activity, level: node.difficulty, itemId: site.itemId,
            need: 0, have: countOwned(character, site.itemId),
            remaining: Math.max(0, QUEST_SITE_ATTEMPTS - mine.attempts), refillAt: mine.refillAt, kept: true,
        });
    }
    return [...views.values()];
}
