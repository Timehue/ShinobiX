import type { JutsuTag } from "../types/combat";
import type { JutsuMethod, JutsuTarget } from "../types/core";
import { instantEffectGroundTags, SELF_GROUND_EFFECT_AP, selfGroundEffectTags } from "./tags";

const SINGLE_MOVE_UNREACHABLE_TAGS = new Set(["Pierce", "Wound", "Siphon"]);

export type InstantEffectFamily = "enemy-field" | "buff-tile" | null;

/** Which ground family an Instant Effect draft has committed to: its first ground tag decides. */
export function instantEffectFamily(tags: readonly Pick<JutsuTag, "name">[]): InstantEffectFamily {
    const first = tags.find((tag) => instantEffectGroundTags.includes(tag.name) || selfGroundEffectTags.includes(tag.name));
    if (!first) return null;
    return selfGroundEffectTags.includes(first.name) ? "buff-tile" : "enemy-field";
}

/**
 * Instant Effect tag policy, mirrored by api/bloodlines/_jutsu-schema.ts. An
 * Instant Effect is either an enemy field (Decrease Damage Given / Recoil /
 * Poison around you) or, at 40 AP only, a buff tile on one chosen hex, with
 * an optional Move that dashes you onto it. The two never mix.
 */
export function instantEffectCreatorTags<T extends Pick<JutsuTag, "name">>(tags: readonly T[], ap: number | undefined): T[] {
    if (Number(ap) === SELF_GROUND_EFFECT_AP && instantEffectFamily(tags) === "buff-tile") {
        const move = tags.find((tag) => tag.name === "Move");
        return [...(move ? [move] : []), ...tags.filter((tag) => selfGroundEffectTags.includes(tag.name))];
    }
    return tags.filter((tag) => instantEffectGroundTags.includes(tag.name));
}

/** Tags an Instant Effect slot may offer at this AP (before family greying). */
export function instantEffectOfferedTags(ap: number | undefined): string[] {
    return Number(ap) === SELF_GROUND_EFFECT_AP
        ? [...instantEffectGroundTags, ...selfGroundEffectTags, "Move"]
        : [...instantEffectGroundTags];
}

/**
 * Why an offered Instant Effect tag is unavailable for this slot, or null. The
 * reason is shown next to the tag in the picker.
 */
export function instantEffectTagBlockReason(
    tagName: string,
    otherTagNames: readonly string[],
): string | null {
    const family = instantEffectFamily(otherTagNames.map((name) => ({ name })));
    if (family === "enemy-field" && (selfGroundEffectTags.includes(tagName) || tagName === "Move")) return "enemy field";
    if (family === "buff-tile" && instantEffectGroundTags.includes(tagName)) return "buff tile";
    if (tagName === "Move" && family !== "buff-tile") return "needs a buff tag";
    return null;
}

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

/**
 * SINGLE movement has no impact footprint, so the runtime forces its damage to
 * zero. A 60+ AP cast pays for damage, so a Move on it becomes Circle Movement,
 * the method that can land that hit. 40 AP SINGLE Move stays a utility dash.
 */
export function bloodlineCreatorMethodForTags(
    method: JutsuMethod,
    ap: number | undefined,
    tags: readonly Pick<JutsuTag, "name">[],
): JutsuMethod {
    return method === "SINGLE" && Number(ap) > 40 && tags.some((tag) => tag.name === "Move")
        ? "AOE_CIRCLE"
        : method;
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
export function bloodlineCreatorRangeForTarget(target: JutsuTarget, range: number, method?: JutsuMethod): number {
    if (target === "SELF") return 0;
    if (method === "INSTANT_EFFECT") return Number(range) === 5 ? 5 : 4;
    if (method === "AOE_SPIRAL") return Number(range) >= 4 ? 4 : 3;
    return Number(range) === 5 ? 5 : 4;
}
