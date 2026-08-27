import type { JutsuTag } from "../types/combat";
import type { JutsuMethod, JutsuTarget } from "../types/core";

const SINGLE_MOVE_UNREACHABLE_TAGS = new Set(["Pierce", "Wound", "Siphon"]);

/** Player-creator method/tag reachability policy mirrored by the server schema. */
export function bloodlineCreatorMethodAllowsTag(
    tagName: string,
    method: JutsuMethod,
    authoredTagNames: readonly string[],
): boolean {
    // AOE_BURST is opponent-centred. The runtime interprets any Move tag as a
    // tile-targeted relocation instead, so that combination cannot be authored.
    if (method === "AOE_BURST" && tagName === "Move") return false;
    if (method === "SINGLE" && authoredTagNames.includes("Move") && SINGLE_MOVE_UNREACHABLE_TAGS.has(tagName)) return false;
    return true;
}

export function normalizeBloodlineCreatorMethodTags(tags: readonly JutsuTag[], method: JutsuMethod): JutsuTag[] {
    const authoredTagNames = tags.map((tag) => tag.name);
    return tags.filter((tag) => bloodlineCreatorMethodAllowsTag(tag.name, method, authoredTagNames));
}

export function bloodlineCreatorTargetForMethod(
    method: JutsuMethod,
    target: JutsuTarget,
    options: { ap?: number; tags?: readonly Pick<JutsuTag, "name">[] } = {},
): JutsuTarget {
    const tagNames = new Set((options.tags ?? []).map((tag) => tag.name));

    // Keep the client draft on the same target derivation as the authoritative
    // player-jutsu schema. Method/movement structure wins first; a direct legal
    // Copy or Mirror is a damaging 60+ AP cast and therefore needs an opponent.
    if (method === "AOE_BURST") return "OPPONENT";
    if (method === "AOE_CIRCLE" || method === "INSTANT_EFFECT" || method === "AOE_SPIRAL" || tagNames.has("Move")) {
        return "EMPTY_GROUND";
    }
    if (Number(options.ap) >= 60 && (tagNames.has("Copy") || tagNames.has("Mirror"))) return "OPPONENT";
    return target;
}

/** Player bloodline range projection mirrored by api/bloodlines/_jutsu-schema.ts. */
export function bloodlineCreatorRangeForTarget(target: JutsuTarget, range: number): number {
    if (target === "SELF") return 0;
    return Number(range) === 5 ? 5 : 4;
}
