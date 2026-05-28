import {
    type Jutsu,
    JUTSU_MAX_LEVEL,
    jutsuDisplayAtLevel,
    jutsuEffectInfo,
    scaleJutsuTagsForDisplay,
} from "../App";
import type { JutsuType } from "../types/core";

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
    const effectJutsu = scaledEffectPower === undefined
        ? jutsuDisplayAtLevel(jutsu, level)
        : scaleJutsuTagsForDisplay({ ...jutsu, effectPower: scaledEffectPower }, level);

    return (
        <div className="jutsu-effect-cards">
            {effectJutsu.tags.filter((tag) => tag.name).map((tag, index) => {
                const info = jutsuEffectInfo(effectJutsu, tag, lensDiscipline);
                return (
                    <div className="jutsu-effect-card" key={`${tag.name}-${index}`}>
                        <div className="jutsu-effect-card-head">
                            <strong>{tag.name}</strong>
                            <span>{info.duration}</span>
                        </div>
                        <p>{info.summary}</p>
                        <div className="jutsu-effect-meta">
                            <span><strong>Value:</strong> {info.value}</span>
                            <span><strong>Target:</strong> {jutsu.target.toLowerCase().replaceAll("_", " ")}</span>
                        </div>
                        <small>{info.rule}</small>
                    </div>
                );
            })}
        </div>
    );
}
