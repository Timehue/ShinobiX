import * as React from "react";
import type { JutsuMethod, JutsuTarget, Rank } from "../types/core";
import { allTags, binaryTags, cappedDamageTags, groupTags, percentageTags, tagCapForRank } from "../lib/tags";
import { bloodlineCreatorPercentPolicy, normalizeBloodlineCreatorTagPercent } from "../lib/jutsu-points";
import { jutsuEffectInfo } from "../lib/jutsu-effects";
import { normalizeJutsu } from "../lib/jutsu";

export function TagPicker({ tag, setTag, percent, setPercent, rank, jutsuTarget, jutsuMethod, disabledTags = [], allowedTags, ariaLabel = "Jutsu tag" }: { tag: string; setTag: (tag: string) => void; percent: number; setPercent: (percent: number) => void; rank?: Rank | null; jutsuTarget?: JutsuTarget; jutsuMethod?: JutsuMethod; disabledTags?: string[]; allowedTags?: string[]; ariaLabel?: string }) {
    const creatorPolicy = rank ? bloodlineCreatorPercentPolicy(tag, rank) : null;
    const displayedPercent = rank ? normalizeBloodlineCreatorTagPercent(tag, percent, rank) : percent;
    const selectedTagInfo = tag
        ? jutsuEffectInfo(
            normalizeJutsu({ id: "tag-preview", name: "Tag Preview", type: "Ninjutsu", effectPower: 100, bloodlineRank: rank ?? undefined, target: jutsuTarget ?? "OPPONENT", method: jutsuMethod ?? "SINGLE", tags: [{ name: tag, percent: displayedPercent }] }),
            { name: tag, percent: displayedPercent },
        )
        : null;
    const isGroundTargeted = jutsuTarget === "EMPTY_GROUND";
    const availableTags = allowedTags ?? (isGroundTargeted ? allTags.filter((t) => t !== "Increase Damage Taken") : allTags);
    const disabledTagSet = new Set(disabledTags);

    return (
        <div className="tag-picker">
            <select
                aria-label={ariaLabel}
                value={tag}
                onChange={(e) => {
                    const nextTag = e.target.value;
                    if (disabledTagSet.has(nextTag)) return;
                    setTag(nextTag);
                    if (rank) {
                        setPercent(bloodlineCreatorPercentPolicy(nextTag, rank).defaultPercent);
                    } else if (!nextTag || binaryTags.includes(nextTag)) setPercent(0);
                    else if (cappedDamageTags.includes(nextTag)) setPercent(tagCapForRank(rank));
                    else if (percentageTags.includes(nextTag)) setPercent(40);
                    else setPercent(100);
                }}
            >
                <option value="">No Tag</option>
                {groupTags(availableTags).map((group) => (
                    <optgroup key={group.label} label={group.label}>
                        {group.tags.map((tagName) => (
                            <option key={tagName} value={tagName} disabled={disabledTagSet.has(tagName)}>
                                {tagName}{disabledTagSet.has(tagName) ? " [already used]" : ""}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
            {creatorPolicy?.scalable && (
                <select
                    className="tag-percent-select"
                    aria-label={`${tag} strength`}
                    value={displayedPercent}
                    onChange={(event) => setPercent(Number(event.target.value))}
                >
                    {creatorPolicy.choices.map((choice) => (
                        <option key={choice} value={choice}>{choice}%</option>
                    ))}
                </select>
            )}
            {selectedTagInfo && (
                <small className="tag-effect-help">
                    {selectedTagInfo.summary} {selectedTagInfo.rule}
                </small>
            )}
        </div>
    );
}
