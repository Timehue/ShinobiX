import { JUTSU_MAX_LEVEL } from "../constants/game";
import { jutsuDisplayAtLevel, jutsuEffectInfo } from "../lib/jutsu-effects";
import { scaleJutsuTagsForDisplay } from "../lib/jutsu-scaling";
import { normalizeTagName } from "../lib/tags";
import type { Jutsu } from "../types/combat";
import type { JutsuType } from "../types/core";
import { canonicalizeOverloadTags } from "../../../shared/overload";

type EffectTone = "power" | "recovery" | "guard" | "harm" | "control" | "utility";

const EFFECT_TONES = [
    ["power", /^(?:Increase Damage Given|Increase Generals|Increase Discipline|Siphon|Lifesteal|Pierce|Overclock)$/],
    ["recovery", /^(?:Heal|Increase Heal)$/],
    ["guard", /^(?:Shield|Barrier|Decrease Damage Taken|Reflect|Absorb|Debuff Prevent|Clear Prevent|Stun Prevent)$/],
    ["harm", /^(?:Damage|Wound|Poison|Drain|Ignition|Afterburn|Recoil|Increase Damage Taken|Decrease Damage Given)$/],
    ["control", /^(?:Stun|Push|Pull|Bloodline Seal|Elemental Seal|Buff Prevent|Cleanse Prevent|Lag|Time Compression|Mirror)$/],
] as const satisfies ReadonlyArray<readonly [Exclude<EffectTone, "utility">, RegExp]>;

const SELF_EFFECT_TAGS = new Set([
    "Heal",
    "Shield",
    "Absorb",
    "Siphon",
    "Lifesteal",
    "Reflect",
    "Increase Damage Given",
    "Decrease Damage Taken",
    "Debuff Prevent",
    "Clear Prevent",
    "Stun Prevent",
    "Copy",
    "Overclock",
    "Increase Heal",
    "Increase Generals",
    "Increase Discipline",
    "Move",
]);

const ENEMY_EFFECT_TAGS = new Set([
    "Damage",
    "Recoil",
    "Wound",
    "Ignition",
    "Stun",
    "Bloodline Seal",
    "Elemental Seal",
    "Push",
    "Pull",
    "Buff Prevent",
    "Cleanse Prevent",
    "Poison",
    "Drain",
    "Mirror",
    "Lag",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Pierce",
]);

/** The recipient of this individual effect, which may differ from the cast target on mixed-tag jutsu. */
export function jutsuEffectTargetLabel(jutsu: Pick<Jutsu, "target">, tagName: string): string {
    const canonicalName = normalizeTagName(tagName);
    if (SELF_EFFECT_TAGS.has(canonicalName)) return canonicalName === "Copy" ? "Self (copies eligible enemy buffs)" : "Self";
    if (ENEMY_EFFECT_TAGS.has(canonicalName)) return canonicalName === "Mirror" ? "Enemy (copies all your debuffs)" : "Enemy";
    if (canonicalName === "Barrier") return "Battlefield";

    switch (jutsu.target ?? "OPPONENT") {
        case "SELF": return "Self";
        case "OPPONENT": return "Enemy";
        case "OTHER_USER": return "Other player";
        case "CHARACTER": return "Character";
        case "EMPTY_GROUND": return "Ground";
    }
}

export function jutsuEffectTone(name: string): EffectTone {
    for (const [tone, pattern] of EFFECT_TONES) {
        if (pattern.test(name)) return tone;
    }
    return "utility";
}

export function JutsuEffectCards({ jutsu, scaledEffectPower, masteryLevel, lensDiscipline }: { jutsu: Jutsu; scaledEffectPower?: number; masteryLevel?: number; lensDiscipline?: JutsuType }) {
    const tags = jutsu.tags.filter((tag) => tag.name);
    if (tags.length === 0) {
        return (
            <div className="jutsu-effect-cards">
                <div className="jutsu-effect-card">
                    <strong>No special effects</strong>
                    <p>This jutsu only uses its base effect power.</p>
                </div>
            </div>
        );
    }

    const level = masteryLevel ?? JUTSU_MAX_LEVEL;
    const canonicalJutsu = { ...jutsu, tags: canonicalizeOverloadTags(jutsu.id, jutsu.tags) };
    const effectJutsu = scaledEffectPower === undefined
        ? jutsuDisplayAtLevel(canonicalJutsu, level)
        : scaleJutsuTagsForDisplay({ ...canonicalJutsu, effectPower: scaledEffectPower }, level);
    const maxEffectJutsu = jutsuDisplayAtLevel(canonicalJutsu, JUTSU_MAX_LEVEL);
    const groups = effectJutsu.tags.filter((tag) => tag.name).reduce<Array<{ name: string; tags: typeof effectJutsu.tags }>>((result, tag) => {
        const existing = result.find((group) => group.name === tag.name);
        if (existing) existing.tags.push(tag);
        else result.push({ name: tag.name, tags: [tag] });
        return result;
    }, []);

    return (
        <div className="jutsu-effect-cards" role="list" aria-label="Jutsu effects">
            {groups.map((group) => {
                const tag = group.tags[0]!;
                const info = jutsuEffectInfo(effectJutsu, tag, lensDiscipline);
                const tone = jutsuEffectTone(group.name);
                const duplicateValues = group.tags.map((stack) => jutsuEffectInfo(effectJutsu, stack, lensDiscipline).value);
                const maxValues = maxEffectJutsu.tags
                    .filter((maxTag) => maxTag.name === group.name)
                    .map((maxTag) => jutsuEffectInfo(maxEffectJutsu, maxTag, lensDiscipline).value);
                const stackCount = group.tags.length;
                const maxStackLabel = maxValues.length > 0 && maxValues.every((value) => value === maxValues[0])
                    ? `${maxValues.length} × +${maxValues[0].replace(/^\+/, "")}`
                    : maxValues.map((value) => `+${value.replace(/^\+/, "")}`).join(" · ");
                return (
                    <div className={`jutsu-effect-card jutsu-effect-card--${tone}`} role="listitem" key={group.name}>
                        <div className="jutsu-effect-card-head">
                            <strong>{group.name}</strong>
                            <span>{stackCount > 1 ? `${stackCount} stacks · ` : ""}{info.duration}</span>
                        </div>
                        <p>{info.summary}</p>
                        {stackCount > 1 && (
                            <div className="jutsu-effect-stack-panel">
                                <strong>Triggers {stackCount}× per cast</strong>
                                <div className="jutsu-effect-stack-values">
                                    {duplicateValues.map((value, index) => (
                                        <span key={`${group.name}-stack-${index}`}><small>Stack {index + 1}</small><strong>{value}</strong></span>
                                    ))}
                                </div>
                                {level < JUTSU_MAX_LEVEL && maxValues.length === stackCount && (
                                    <small className="jutsu-effect-max">At max mastery: {maxStackLabel}</small>
                                )}
                            </div>
                        )}
                        <div className="jutsu-effect-meta">
                            <span><strong>Value:</strong> {info.value}</span>
                            <span><strong>Target:</strong> {jutsuEffectTargetLabel(jutsu, group.name)}</span>
                        </div>
                        <small>{info.rule}</small>
                    </div>
                );
            })}
        </div>
    );
}
