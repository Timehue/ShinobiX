import {
    type JutsuTarget,
    type Rank,
    allTags,
    binaryTags,
    cappedDamageTags,
    jutsuEffectInfo,
    normalizeJutsu,
    percentageTags,
    tagCapForRank,
} from "../App";

export function TagPicker({ tag, setTag, percent, setPercent, rank, jutsuTarget, disabledTags = [], allowedTags }: { tag: string; setTag: (tag: string) => void; percent: number; setPercent: (percent: number) => void; rank?: Rank | null; jutsuTarget?: JutsuTarget; disabledTags?: string[]; allowedTags?: string[] }) {
    const selectedTagInfo = tag
        ? jutsuEffectInfo(normalizeJutsu({ id: "tag-preview", name: "Tag Preview", type: "Ninjutsu", effectPower: 100, tags: [{ name: tag, percent }] }), { name: tag, percent })
        : null;
    const isGroundTargeted = jutsuTarget === "EMPTY_GROUND";
    const availableTags = allowedTags ?? (isGroundTargeted ? allTags.filter((t) => t !== "Increase Damage Taken") : allTags);
    const disabledTagSet = new Set(disabledTags);

    return (
        <div className="tag-picker">
            <select
                value={tag}
                onChange={(e) => {
                    const nextTag = e.target.value;
                    if (disabledTagSet.has(nextTag)) return;
                    setTag(nextTag);
                    if (!nextTag || binaryTags.includes(nextTag)) setPercent(0);
                    else if (cappedDamageTags.includes(nextTag)) setPercent(tagCapForRank(rank));
                    else if (percentageTags.includes(nextTag)) setPercent(40);
                    else setPercent(100);
                }}
            >
                <option value="">No Tag</option>
                {availableTags.map((tagName) => (
                    <option key={tagName} value={tagName} disabled={disabledTagSet.has(tagName)}>
                        {tagName}{disabledTagSet.has(tagName) ? " [already used]" : ""}
                    </option>
                ))}
            </select>
            {selectedTagInfo && (
                <small className="tag-effect-help">
                    {selectedTagInfo.summary} {selectedTagInfo.rule}
                </small>
            )}
        </div>
    );
}
