import type { Jutsu } from "../types/combat";
import type { JutsuType, Rank } from "../types/core";
import { normalizeJutsu } from "./jutsu";
import { normalizeJutsuTags } from "./tags";
import { normalizeBloodlineCreatorTagPercent } from "./jutsu-points";
import { bloodlineCreatorMethodForTags, bloodlineCreatorRangeForTarget, bloodlineCreatorTargetForMethod, normalizeBloodlineCreatorMethodTags } from "./bloodline-creator-methods";

export function bloodlineCreatorDraftOffense(jutsus: ReadonlyArray<Pick<Jutsu, "type">>): JutsuType {
    return jutsus.find(jutsu => ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu"].includes(jutsu.type))?.type ?? "Ninjutsu";
}

/** Project editable effects and offense through the same normalization as save ingress. */
export function normalizeCreatorDraftJutsu(jutsu: Jutsu, rank: Rank, offense: JutsuType): Jutsu {
    const method = bloodlineCreatorMethodForTags(jutsu.method ?? "SINGLE", jutsu.ap, jutsu.tags);
    const tags = normalizeBloodlineCreatorMethodTags(normalizeJutsuTags(jutsu.tags).map((tag) => ({
        ...tag,
        percent: normalizeBloodlineCreatorTagPercent(tag.name, tag.percent, rank),
    })), method);
    const target = bloodlineCreatorTargetForMethod(method, jutsu.target, { ap: jutsu.ap, tags });
    const groundZone = method === "INSTANT_EFFECT" || method === "AOE_SPIRAL";
    const normalized = normalizeJutsu({
        ...jutsu,
        type: offense,
        bloodlineRank: rank,
        method,
        target,
        range: bloodlineCreatorRangeForTarget(target, jutsu.range, method),
        ...(groundZone ? { groundRangeVersion: 2 as const } : {}),
        tags,
    });
    return target === "SELF" ? { ...normalized, range: 0 } : normalized;
}
