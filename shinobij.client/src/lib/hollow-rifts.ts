/*
 * hollow-rifts (lib) — delivery layer for the wandering-AI rift quests in
 * data/hollow-rifts.ts. A roaming giver appears in the player's current sector
 * and reports a rift at a TARGET sector; accepting seals it server-side and the
 * player travels there to find a clickable rift structure; descending enters a
 * scaled event Hollow Gate (existing enterHollowGateShrine path) with a themed
 * boss. Beating the boss completes the quest (server-authoritative).
 *
 * Sibling of lib/story-road-events.ts. The Hollow Gate engine is untouched: the
 * rift just builds a HollowGateEventConfig (short floors + themed boss id, free
 * entry) and rides the existing event-gate entry.
 */

import type { Character } from "../types/character";
import type { Biome } from "../types/core";
import type { CreatorEvent } from "../types/vn";
import type { Wanderer, WandererArchetypeId } from "./wanderers";
import { sectorRegionName, villageForOutskirtsSector } from "../data/sectors";
import { hollowRifts, hollowRiftById, type HollowRift, type RiftGiverArchetype, type RiftPage } from "../data/hollow-rifts";

export const RIFT_GIVER_PREFIX = "rift-giver-";
export const RIFT_STRUCTURE_TYPE = "hollowRift";
/** Sentinel choice traits WorldMap reads (never stored as real story traits). */
export const RIFT_ACCEPT_MARKER = "__rift-accept";
export const RIFT_DESCEND_MARKER = "__rift-descend";
export const RIFT_ABANDON_MARKER = "__rift-abandon";

/** Which existing NPC face each giver archetype wears (until bespoke art). */
const RIFT_ART: Record<RiftGiverArchetype, WandererArchetypeId> = {
    tracker: "tracker",
    pilgrim: "pilgrim",
    courier: "courier",
    soldier: "patrol",
    sage: "sage",
    broker: "bountyHunter",
    official: "patrol",
};

/** The same archetype face as a PUBLIC portrait path (the wanderer art copied
 *  from src/assets/wanderers/<face>.webp into public/portraits/wanderer-<face>.webp).
 *  A plain string path — this module stays webp-import-free so its node tests run —
 *  so the VN speaker card shows the same face the giver wears on the sector map. */
const RIFT_GIVER_FACE: Record<RiftGiverArchetype, string> = {
    tracker: "wanderer-tracker",
    pilgrim: "wanderer-pilgrim",
    courier: "wanderer-courier",
    soldier: "wanderer-patrol",
    sage: "wanderer-sage",
    broker: "wanderer-bounty-hunter",
    official: "wanderer-patrol",
};

/** VN speaker portrait for the giver (its archetype face) and the rift boss (its
 *  512² portrait crop) — both public /portraits/*.webp paths. */
export function riftGiverPortrait(rift: HollowRift): string {
    return `/portraits/${RIFT_GIVER_FACE[rift.giverArchetype]}.webp`;
}
export function riftBossPortrait(rift: HollowRift): string {
    return `/portraits/${rift.bossAiId}.webp`;
}
/** Portrait for whoever speaks on a rift VN page: the giver wears its face, the
 *  boss its portrait, everyone else (Narrator) none — so the slot hides instead
 *  of showing initials. */
function riftPortraitFor(rift: HollowRift, speaker: string): string | undefined {
    const s = speaker.trim().toLowerCase();
    if (s === rift.giverName.trim().toLowerCase()) return riftGiverPortrait(rift);
    if (s === rift.bossName.trim().toLowerCase()) return riftBossPortrait(rift);
    return undefined;
}

/** Deterministic wilderness sector for a (player, rift): stable, avoids village
 *  outskirts + central + the lava arena. The server recomputes the SAME value at
 *  accept, so client display and server seal always agree. */
export function riftTargetSector(playerName: string, riftId: string): number {
    let h = 2166136261;
    const s = `${playerName}|${riftId}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    const villages = new Set([11, 31, 38, 47]); // village outskirts
    let sec = (Math.abs(h) % 55) + 1;           // 1..55 wilderness (skips 56-60 central, 99 lava)
    for (let guard = 0; guard < 60 && villages.has(sec); guard++) sec = (sec % 55) + 1;
    return sec;
}

/** The next rift the roaming giver should offer, or null. One at a time; skipped
 *  while a rift is active or during the post-clear cooldown. Offers any rift the
 *  player has reached (level >= levelReq, NO upper cap), PREFERRING the highest
 *  tier reached but still surfacing lower (possibly missed) rifts sometimes, so a
 *  rift you out-leveled is never locked out. Deterministic per UTC day. */
export function nextRift(character: Character): HollowRift | null {
    if (character.activeRiftQuest) return null;
    if (Date.now() < (character.riftCooldownUntil ?? 0)) return null;
    const eligible = hollowRifts.filter((r) => character.level >= r.levelReq);
    if (!eligible.length) return null;
    const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    let h = 2166136261;
    const key = `${character.name}|${dayBucket}`;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    // Weighted pick: rank the eligible rifts by levelReq DESC and weight each
    // 2^-rank (highest tier 1, next 1/2, next 1/4, …). The top rift draws ~half
    // the days and each lower tier ~half as often as the one above, so the giver
    // leans on the highest tier you've reached yet a missed lower rift still
    // surfaces now and then. The day hash rolls a point along the summed weights.
    const ranked = [...eligible].sort((a, b) => b.levelReq - a.levelReq);
    const weights = ranked.map((_, i) => 0.5 ** i);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = ((Math.abs(h) % 1_000_000) / 1_000_000) * total;
    for (let i = 0; i < ranked.length; i++) {
        roll -= weights[i];
        if (roll < 0) return ranked[i];
    }
    return ranked[ranked.length - 1];
}

/** The giver as a roaming sector wanderer (road-event pattern), placed in the
 *  player's CURRENT sector; talking to it opens the intro VN. */
export function synthRiftGiver(rift: HollowRift, sector: number): Wanderer {
    let hash = 0;
    for (const ch of rift.slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const home = 5 * 12 + ((sector * 7 + hash) % 8) + 2;
    const face = RIFT_ART[rift.giverArchetype];
    return {
        id: `${RIFT_GIVER_PREFIX}${rift.slug}`,
        name: rift.giverName,
        archetype: face,
        verb: "quest",
        level: rift.levelReq,
        homeTile: home,
        waypoints: [home, home + 1, home - 1],
        greeting: `${rift.giverName} flags you down, still shaken by whatever they saw.`,
        tellTint: "#a855f7",
        avatarKey: face,
    };
}

export function riftBySynthId(id: string): HollowRift | null {
    if (!id.startsWith(RIFT_GIVER_PREFIX)) return null;
    return hollowRiftById(`rift-${id.slice(RIFT_GIVER_PREFIX.length)}`);
}

/** Human sector reference for the intro copy, e.g. "the Frostreach (sector 47)". */
export function sectorPhrase(sector: number): string {
    const village = villageForOutskirtsSector(sector);
    const region = village ? `the outskirts of ${village}` : sectorRegionName(sector);
    return `${region} (sector ${sector})`;
}

function mapPages(pages: RiftPage[], last: number, portraitFor: (speaker: string) => string | undefined): NonNullable<CreatorEvent["vnPages"]> {
    return pages.map((page, index) => ({
        title: page.title,
        scene: page.scene,
        speaker: page.speaker,
        rightImage: portraitFor(page.speaker),
        dialogue: page.dialogue,
        choices: index === last
            ? page.choices?.map((choice) => ({
                text: choice.text,
                nextPage: last,
                conclusion: choice.conclusion,
                trait: choice.accept ? RIFT_ACCEPT_MARKER : choice.descend ? RIFT_DESCEND_MARKER : choice.abandon ? RIFT_ABANDON_MARKER : undefined,
            }))
            : undefined,
    }));
}

/** The giver's report VN (names the target sector via %sector). */
export function riftIntroEvent(rift: HollowRift, targetSector: number, biome: Biome): CreatorEvent {
    const phrase = sectorPhrase(targetSector);
    const pages = mapPages(
        rift.intro.map((p) => ({ ...p, dialogue: p.dialogue.map((line) => line.replace(/%sector/g, phrase)) })),
        rift.intro.length - 1,
        (speaker) => riftPortraitFor(rift, speaker),
    );
    return {
        id: `${RIFT_GIVER_PREFIX}${rift.slug}`,
        name: `Strange Energy: ${rift.bossName}`,
        biome,
        icon: "🌀",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: rift.intro[0]?.title ?? "Strange Energy",
        vnScene: rift.intro[0]?.scene ?? "",
        vnSpeaker: rift.intro[0]?.speaker ?? rift.giverName,
        image: `/scenes/story/${RIFT_GIVER_PREFIX}${rift.slug}.webp`,
        vnPages: pages,
        levelReq: rift.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: rift.intro.flatMap((p) => p.dialogue),
    };
}

/** The at-the-rift VN (before descending). */
export function riftDescentEvent(rift: HollowRift, biome: Biome): CreatorEvent {
    const pages = mapPages(rift.descent, rift.descent.length - 1, (speaker) => riftPortraitFor(rift, speaker));
    return {
        id: `rift-descend-${rift.slug}`,
        name: `The Rift: ${rift.bossName}`,
        biome,
        icon: "🌀",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: rift.descent[0]?.title ?? "The Rift",
        vnScene: rift.descent[0]?.scene ?? "",
        vnSpeaker: rift.descent[0]?.speaker ?? "Narrator",
        image: `/scenes/story/rift-descend-${rift.slug}.webp`,
        vnPages: pages,
        levelReq: rift.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: rift.descent.flatMap((p) => p.dialogue),
    };
}

export function isRiftDescentEventId(id: string): boolean {
    return id.startsWith("rift-descend-");
}
export function riftByDescentEventId(id: string): HollowRift | null {
    if (!id.startsWith("rift-descend-")) return null;
    return hollowRiftById(`rift-${id.slice("rift-descend-".length)}`);
}

// The run-config + server-call helpers (riftEventConfig, acceptRift,
// completeRift, abandonRift, completeRiftRun) live in ./rift-run, which is
// DATA-FREE, so the App entry bundle can import them without pulling this
// content catalog into every player's initial download. Re-exported here for
// the (lazy) WorldMap + tests that import them alongside the delivery helpers.
export { riftEventConfig, acceptRift, completeRift, abandonRift, completeRiftRun } from "./rift-run";
