/*
 * The "!" / "?" a quest-giving NPC wears above its head, coloured by how much the
 * offer matters to the game. Presentation only: it reads who the NPC already is
 * and never decides what they offer, so nothing here touches quests or saves.
 *
 *   "!"  something is on offer here
 *   "?"  a quest you hold has brought you to this person (turn it in, or go on)
 *
 *   tier    colour   what it is
 *   story   gold     the main story and the Legacy line
 *   event   violet   rifts, the Chronicle and other timed events
 *   boss    red      a fight a quest is waiting on
 *   side    teal     everything else that gives a quest
 *
 * Ids are matched as literal prefixes (they are the same strings the owning
 * modules export) so this stays out of the startup bundle.
 */
import type { Wanderer } from "./wanderers";

export type NpcMarkerTier = "story" | "event" | "boss" | "side";
export type NpcMarker = Readonly<{ glyph: "!" | "?"; tier: NpcMarkerTier; label: string }>;

const TIER_LABEL: Record<NpcMarkerTier, string> = {
    story: "Story quest", event: "Event", boss: "Quest fight", side: "Side quest",
};

export function npcMarker(glyph: "!" | "?", tier: NpcMarkerTier): NpcMarker {
    return { glyph, tier, label: (glyph === "?" ? "Quest in progress: " : "Quest offered: ") + TIER_LABEL[tier] };
}

/** The marker a road/sector NPC wears, or null when it offers no quest. */
export function wandererMarker(w: Pick<Wanderer, "id" | "verb" | "archetype">): NpcMarker | null {
    if (w.verb === "legacyQuest" || w.archetype === "wanderingSage" || w.id.startsWith("story-reckoning")) return npcMarker("!", "story");
    if (w.verb !== "quest") return null;
    if (w.id.startsWith("rift-giver-") || w.id === "chronicle-scribe" || w.id.startsWith("pet-mentor-")) return npcMarker("!", "event");
    return npcMarker("!", "side");
}

/**
 * What this player can actually take from the NPC right now. Nothing is drawn when
 * there is nothing to take: a quest or epic is already under way (it would be
 * refused), or an emissary's errands are all locked behind activities the player
 * has not unlocked. Givers that only exist while their offer does (the Sage, rifts,
 * the scribe, the pet mentor, story beats) keep the base marker.
 */
export function offeredMarker(
    w: Pick<Wanderer, "id" | "verb" | "archetype">,
    state: { busy: boolean; ready?: boolean; locked: readonly string[]; emissaryMetrics?: readonly string[]; roadStory?: boolean },
): NpcMarker | null {
    const base = wandererMarker(w);
    if (!base) return null;
    // A quest you hold is finished: whoever gives errands is who you hand it in to.
    if (state.ready && !state.roadStory && (w.verb === "legacyQuest" || base.tier === "side")) return npcMarker("?", w.verb === "legacyQuest" ? "story" : "side");
    if (w.verb === "legacyQuest") {
        const metrics = state.emissaryMetrics;
        return state.busy || !metrics || metrics.every(metric => state.locked.includes(metric)) ? null : base;
    }
    if (state.roadStory) return npcMarker("!", "story");
    return base.tier === "side" && state.busy ? null : base;
}

/** The marker a coast figure wears: a keeper a quest has brought you to, or the boss it waits on. */
export function coastFigureMarker(figure: { boss?: boolean }): NpcMarker {
    return figure.boss ? npcMarker("?", "boss") : npcMarker("?", "story");
}
