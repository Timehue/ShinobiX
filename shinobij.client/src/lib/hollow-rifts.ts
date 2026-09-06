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
import { CASTLE_SECTORS, MAX_WILD_SECTOR, OUTSKIRTS_SECTORS } from "../../../shared/sector-geo";
import { hollowRifts, hollowRiftById, type HollowRift, type RiftGiverArchetype, type RiftPage } from "../data/hollow-rifts";
import { serverNow } from "./server-clock";

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

const RIFT_GREETINGS: Readonly<Record<string, string>> = {
    "rift-legacy-echo": "Senna steadies a leaning grave marker with one knee and holds a spare brush out to you.",
    "rift-hollow-stalker": "Vessa pins a field map to the boundary stone before the wind can take it.",
    "rift-beast-warren": "Houndmaster Bel stands beside the empty kennel runs, gripping one broken collar.",
    "rift-engine-echo": "Recorder Sann waves you over with an open ledger whose newest line is still forming.",
    "rift-hollow-name": "Keeper Oru raises a shrine lamp and asks you to hold it steady over a worn slate.",
    "rift-mirror-shard": "Broker Nemo shutters his booth, checks your reflection, and then checks you.",
    "rift-gate-heir": "Kite Harrow taps a folded pressure report against the wagon seat and makes room beside her.",
};

/** VN speaker portrait for the giver (its archetype face) and the rift boss (its
 *  512² portrait crop) — both public /portraits/*.webp paths. */
export function riftGiverPortrait(rift: HollowRift): string {
    return `/portraits/${RIFT_GIVER_FACE[rift.giverArchetype]}.webp`;
}
export function riftBossPortrait(rift: HollowRift): string {
    return `/portraits/${rift.bossAiId}.webp`;
}
/** Deterministic wilderness sector for a (player, rift): stable, avoids village
 *  outskirts + the neutral castle city + the lava arena. The server recomputes
 *  the SAME value at accept (api/sector/_rift-quest.ts riftTargetSector — keep
 *  in lockstep), so client display and server seal always agree. The draw spans
 *  MAX_WILD_SECTOR so later-added sectors are rift homes too; an accepted quest
 *  keeps the sector that was sealed for it, so widening never moves one. */
export function riftTargetSector(playerName: string, riftId: string): number {
    let h = 2166136261;
    const s = `${playerName}|${riftId}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    const skip = new Set([...OUTSKIRTS_SECTORS, ...CASTLE_SECTORS]);
    let sec = (Math.abs(h) % MAX_WILD_SECTOR) + 1; // 99 (lava) is out of range by construction
    for (let guard = 0; guard < MAX_WILD_SECTOR && skip.has(sec); guard++) sec = (sec % MAX_WILD_SECTOR) + 1;
    return sec;
}

/** The next rift the roaming giver should offer, or null. One at a time; skipped
 *  while a rift is active or during the post-clear cooldown. Offers any rift the
 *  player has reached (level >= levelReq, NO upper cap), PREFERRING the highest
 *  tier reached but still surfacing lower (possibly missed) rifts sometimes, so a
 *  rift you out-leveled is never locked out. Deterministic per UTC day on the
 *  SERVER clock and keyed by the day only — never the player — so two players of
 *  the same reach meet the same giver in the same sector. `now` is injectable
 *  for tests. */
export function nextRift(character: Character, now: number = serverNow()): HollowRift | null {
    if (character.activeRiftQuest) return null;
    if (now < (character.riftCooldownUntil ?? 0)) return null;
    const eligible = hollowRifts.filter((r) => character.level >= r.levelReq);
    if (!eligible.length) return null;
    const dayBucket = Math.floor(now / (24 * 60 * 60 * 1000));
    let h = 2166136261;
    const key = `rift-day|${dayBucket}`;
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
        greeting: RIFT_GREETINGS[rift.id] ?? `${rift.giverName} flags you down with a field report in hand.`,
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

function mapPages(pages: RiftPage[], last: number): NonNullable<CreatorEvent["vnPages"]> {
    return pages.map((page, index) => ({
        title: page.title,
        scene: page.scene,
        speaker: page.speaker,
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

const RIFT_REPORT_LABELS: Record<string, string> = {
    "rift-legacy-echo": "Senna's marker rubbing",
    "rift-hollow-stalker": "Vessa's stopped seam",
    "rift-beast-warren": "Nara's recovery",
    "rift-engine-echo": "Sann's signed manifest",
    "rift-hollow-name": "Oru's condemned entry",
    "rift-mirror-shard": "Nemo's returned names",
};

const REPEAT_REPORTS: Record<string, { title: string; scene: string; lines: string[]; decline: string }> = {
    "rift-legacy-echo": {
        title: "A Second Disturbance",
        scene: "Senna compares a fresh rubbing with the first one already filed",
        lines: ["The rubbing you brought is dry in the archive. This new break is worrying at another copy of the same refusal.", "Meet it in %sector. Bring the mark back without smearing it; I have paper waiting."],
        decline: "Senna folds the fresh rubbing into oilskin and sets it beside the brush. The marker can wait one more night, she says, if the paper stays dry.",
    },
    "rift-hollow-stalker": {
        title: "The Seam Opens Again",
        scene: "Vessa adds a new violet line to a map whose older seam is crossed out",
        lines: ["The seam you closed stopped widening. A new one in %sector has grown legs of its own.", "I already know you can hold your footing. I need the new break contained before it reaches the road."],
        decline: "Vessa weights the new corner of the map with a stone. She will measure the seam again at dusk and leave the figures at this post.",
    },
    "rift-beast-warren": {
        title: "A Voice From Another Warren",
        scene: "Bel stands beside Nara, bandaged and awake, while a distant den answers her bark",
        lines: ["Nara is home and healing. The thing in %sector is a renewed echo using the call it learned from her, not another abduction.", "She wants to follow. She is not going. Close it while I keep her here."],
        decline: "Bel nods once and turns back to Nara before the hound can struggle to her feet again. Neither of them likes waiting.",
    },
    "rift-engine-echo": {
        title: "A Fresh Column",
        scene: "Sann lays a new manifest beside the signed original",
        lines: ["I signed the first manifest, and it is still where we filed it. These names came from a later batch of closure bouts.", "Their Echo is standing in %sector. Close the break before the arena gives it another page."],
        decline: "Sann leaves the new manifest open to the unfinished column. He will keep copying until you return or the ink reaches the bottom.",
    },
    "rift-hollow-name": {
        title: "The Form Returns",
        scene: "Oru sets a fresh Hall-mark shard beside the condemnation already on file",
        lines: ["This is not the condemned shinobi returned. Another empty copy has begun the same opening form in %sector.", "Break the imitation. The deed and the warning we filed last time remain untouched."],
        decline: "Oru turns the slate face-down and trims the shrine lamp. He will light it again when you are ready to hear the warning.",
    },
    "rift-mirror-shard": {
        title: "Glass Sheds Twice",
        scene: "Nemo shutters the booth around a new sliver of moving glass",
        lines: ["The names from the first rim are back with their keepers. This shard in %sector wears newer reflections.", "Break it before those copies learn which faces make me hesitate."],
        decline: "Nemo wraps the sliver without looking into it and locks it in the empty cash drawer. Tonight, he says, the money can sleep elsewhere.",
    },
    "rift-gate-heir": {
        title: "The Backflow Takes Shape",
        scene: "Harrow checks a new pressure report beneath the quartered plate already posted",
        lines: ["The first plate remains on the waystation board. The drains backed up again and built another carrier in %sector.", "That one is already moving. I need it stopped before the pressure report becomes an obituary."],
        decline: "Harrow writes NOT YET across the pressure report, dates it, and makes you initial the delay. Even refusal gets a receipt with her.",
    },
};

function repeatIntroPages(rift: HollowRift): RiftPage[] {
    const report = REPEAT_REPORTS[rift.id];
    if (!report) return rift.intro;
    return [{
        title: report.title,
        scene: report.scene,
        speaker: rift.giverName,
        dialogue: report.lines,
        choices: [
            { text: `Return to the ${rift.bossName}.`, accept: true },
            { text: "Not yet.", conclusion: report.decline },
        ],
    }];
}

function harrowRiftRecord(firstClears: Readonly<Record<string, unknown>>): string {
    const verified = Object.keys(RIFT_REPORT_LABELS).filter((id) => firstClears[id]);
    if (!verified.length) {
        return "My ledger holds supplied reports from six breaks. None bears your seal yet; I am hiring you on the evidence, not pretending the earlier work was yours.";
    }
    const labels = verified.map((id) => RIFT_REPORT_LABELS[id]);
    return `Your verified reports cover ${labels.join(", ")}. The other entries came from their local witnesses; I keep the sources separate.`;
}

/** The giver's report VN (names the target sector via %sector). */
export function riftIntroEvent(
    rift: HollowRift,
    targetSector: number,
    biome: Biome,
    firstClears: Readonly<Record<string, unknown>> = {},
): CreatorEvent {
    const phrase = sectorPhrase(targetSector);
    const sourcePages = firstClears[rift.id] ? repeatIntroPages(rift) : rift.intro;
    const pages = mapPages(
        sourcePages.map((p) => ({
            ...p,
            dialogue: p.dialogue.map((line) => line
                .replace(/%sector/g, phrase)
                .replace(/%riftRecord/g, harrowRiftRecord(firstClears))),
        })),
        sourcePages.length - 1,
    );
    return {
        id: `${RIFT_GIVER_PREFIX}${rift.slug}`,
        name: `Rift Report: ${rift.bossName}`,
        biome,
        icon: "🌀",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: sourcePages[0]?.title ?? "Rift Report",
        vnScene: sourcePages[0]?.scene ?? "",
        vnSpeaker: sourcePages[0]?.speaker ?? rift.giverName,
        image: `/scenes/story/${RIFT_GIVER_PREFIX}${rift.slug}.webp`,
        vnPages: pages,
        levelReq: rift.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: pages.flatMap((p) => p.dialogue),
    };
}

const FIRST_CLEAR_REACTIONS: Record<string, RiftPage[]> = {
    "rift-legacy-echo": [{ title: "A Deed Kept", scene: "Senna's brush follows the recovered rubbing without touching its oldest strokes", speaker: "Senna Graveward", dialogue: ["Open hand. Closed gate. Witness mark. The rubbing survived clean enough to read.", "Read the three strokes back to me while I file it. A nameless marker still deserves a careful witness."] }],
    "rift-hollow-stalker": [{ title: "The Line Holds", scene: "Vessa measures the dead grass beside the sealed seam", speaker: "Scout Vessa", dialogue: ["Dead grass has not moved another inch. Hold the end of this measure.", "Contained at my line. Good. I can put the ridge patrol back on the ridge instead of making them guess where the ground ends."] }],
    "rift-beast-warren": [{ title: "Water Before Thanks", scene: "Bel kneels outside the warren as Nara breathes against her coat", speaker: "Houndmaster Bel", dialogue: ["The controlling shape let go when you broke it. Nara is hurt, but she is here. Help me get her weight onto the blanket.", "Water first. Thanks after she keeps it down. I am carrying her home; take the front edge and keep it level."] }],
    "rift-engine-echo": [{ title: "A Name on the Manifest", scene: "Sann lays the recovered manifest flat on the waystation table", speaker: "Recorder Sann", dialogue: ["Set your hand on that corner; it keeps curling. The names are still here, and so is the cause buried beside each one.", "My signature goes under the copy. Mine, not the routing office's. Give me the pen before I find a smaller way to write it."] }],
    "rift-hollow-name": [{ title: "Filed Beside the Warning", scene: "Oru fits the recovered Hall-mark shard below the face-down slate", speaker: "Keeper Oru", dialogue: ["Cut edge down. There. The shard fits beside the deed and the Hall's condemnation.", "The old name stays protected. Keep the lamp over the warning while I fasten this; my eyes are still old."] }],
    "rift-mirror-shard": [{ title: "Names Returned", scene: "Nemo reads the recovered rim with the booth shutters closed", speaker: "Broker Nemo", dialogue: ["Every etched name is legible. This one passed through my brokerage; so did this one. I will not price the list.", "I copied the chain of sales in my own hand. Now I wrap the rim for return to the people it recorded."] }],
    "rift-gate-heir": [{ title: "One Plate, Four Witnesses", scene: "A waystation board where Harrow has called witnesses from four roads", speaker: "Kite Harrow", dialogue: ["The plate matches all four reports. I gave each witness one column and a pen; they are still arguing over the ink.", "Your descent is on this copy. Keep it. Hold the plate level while I drive the second rivet."] }],
};

/** A reward-free aftermath queued only after the server returns firstClear=true
 * for the exact accepted rift receipt. */
export function riftFirstClearEvent(riftId: string, biome: Biome): CreatorEvent | null {
    const rift = hollowRiftById(riftId);
    const reaction = FIRST_CLEAR_REACTIONS[riftId];
    if (!rift || !reaction) return null;
    return {
        id: `rift-first-clear-${rift.slug}`,
        name: `Rift Report Closed: ${rift.bossName}`,
        biome,
        icon: "📜",
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: reaction[0]?.title ?? "Rift Report Closed",
        vnScene: reaction[0]?.scene ?? "",
        vnSpeaker: reaction[0]?.speaker ?? rift.giverName,
        image: `/scenes/story/${RIFT_GIVER_PREFIX}${rift.slug}.webp`,
        vnPages: mapPages(reaction, reaction.length - 1),
        levelReq: rift.levelReq,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: reaction.flatMap((p) => p.dialogue),
    };
}

/** The at-the-rift VN (before descending). */
export function riftDescentEvent(rift: HollowRift, biome: Biome): CreatorEvent {
    const pages = mapPages(rift.descent, rift.descent.length - 1);
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
