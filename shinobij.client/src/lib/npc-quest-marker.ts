/*
 * The "!" / "?" a quest-giving NPC wears above its head, coloured by how much the
 * offer matters. Presentation only: it reads who the NPC already is and never
 * decides what they offer, so nothing here touches quests or saves.
 *
 *   "!" something is on offer      "?" a quest you hold is finished, or brought you here
 *   story gold: main story and Legacy    event violet: rifts, Chronicle, timed events
 *   boss  red: a fight a quest waits on  side  teal: any other quest giver
 *
 * Ids are literal prefixes (the strings the owning modules export) so this stays
 * out of the startup bundle.
 */
import type { Wanderer } from "./wanderers";

export type NpcMarkerTier = "story" | "event" | "boss" | "side";
export type NpcMarker = Readonly<{ glyph: "!" | "?"; tier: NpcMarkerTier }>;

export const npcMarker = (glyph: "!" | "?", tier: NpcMarkerTier): NpcMarker => ({ glyph, tier });

type Giver = Pick<Wanderer, "id" | "verb" | "archetype">;

/** The marker a road/sector NPC wears, or null when it offers no quest. */
export function wandererMarker(w: Giver): NpcMarker | null {
    if (w.verb === "legacyQuest" || w.archetype === "wanderingSage" || /^story-(?:reckoning|road-)/.test(w.id)) return npcMarker("!", "story");
    if (w.verb !== "quest") return null;
    return npcMarker("!", /^(rift-giver-|chronicle-scribe|pet-mentor-)/.test(w.id) ? "event" : "side");
}

/**
 * What this player can take from the NPC right now. Nothing is drawn when there is
 * nothing to take: a quest or epic is already held (it would be refused), or an
 * emissary's errands are all locked. A finished held quest puts a "?" on whoever
 * gives errands. Givers that exist only while their offer does (the Sage, rifts,
 * the scribe, the pet mentor, story beats) keep the base marker.
 */
export function offeredMarker(
    w: Giver,
    state: { busy: boolean; ready?: boolean; locked: readonly string[]; emissaryMetrics?: readonly string[] },
): NpcMarker | null {
    const base = wandererMarker(w);
    if (!base) return null;
    const emissary = w.verb === "legacyQuest";
    if (state.ready && (emissary || base.tier === "side")) return npcMarker("?", emissary ? "story" : "side");
    if (emissary) return state.busy || !state.emissaryMetrics || state.emissaryMetrics.every(metric => state.locked.includes(metric)) ? null : base;
    return base.tier === "side" && state.busy ? null : base;
}

/** The marker a coast figure wears: a keeper a quest has brought you to, or the boss it waits on. */
export const coastFigureMarker = (figure: { boss?: boolean }): NpcMarker => npcMarker("?", figure.boss ? "boss" : "story");
