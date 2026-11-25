import type { Character } from "../types/character";
import { lockedQuestMetrics, questMetricForId, type Wanderer } from "./wanderers";
import { emissaryQuestById, EMISSARY_BY_SLUG, type EmissarySlug } from "./legacy-emissaries";
import { questbookStage, questbookStageProgress } from "./questbook";
import { offeredMarker, type NpcMarker } from "./npc-quest-marker";

/**
 * Same test the dialog uses to show "Claim reward": the held errand's counter has
 * reached its target, or the held epic's current stage is met.
 */
export function heldQuestReady(character: Character): boolean {
    const held = character.activeWandererQuest;
    if (held) {
        const metric = (emissaryQuestById(held.id)?.metric ?? questMetricForId(held.id)) as keyof Character;
        return Math.max(0, ((character[metric] as number | undefined) ?? 0) - held.baseline) >= held.target;
    }
    const epic = character.activeQuestbook;
    const stage = epic ? questbookStage(epic.id, epic.stage) : null;
    return !!(epic && stage && !stage.choice && questbookStageProgress(character, epic, stage) >= stage.count);
}

/** The "!" / "?" each sector NPC wears for this player (lib/npc-quest-marker). */
export function npcMarkerResolver(character: Character): (w: Wanderer) => NpcMarker | null {
    const busy = !!(character.activeWandererQuest || character.activeQuestbook);
    const ready = heldQuestReady(character);
    const locked = lockedQuestMetrics(character);
    return w => offeredMarker(w, {
        busy, ready, locked,
        emissaryMetrics: w.verb === "legacyQuest" ? EMISSARY_BY_SLUG.get(w.archetype as EmissarySlug)?.quests.map(q => q.metric) : undefined,
    });
}
