import type { CSSProperties, ReactNode } from "react";
import { FACILITY_PRESENTATION, type FacilityId } from "../lib/facility-presentation";
import { BackToVillageButton } from "./BackToVillageButton";

export type FacilityHeroMetric = {
    label: string;
    value: ReactNode;
    tone?: "default" | "good" | "warning";
};

export function FacilityHero({
    facility,
    eyebrow,
    title,
    description,
    metrics,
    onBack,
    compact = false,
}: {
    facility: FacilityId;
    eyebrow: string;
    title: string;
    description: string;
    metrics: FacilityHeroMetric[];
    onBack?: () => void;
    compact?: boolean;
}) {
    const presentation = FACILITY_PRESENTATION[facility];
    const style = {
        "--facility-art": `url(${presentation.hero})`,
        "--facility-accent": presentation.accent,
    } as CSSProperties;

    return (
        <header
            className={`facility-hero facility-hero--${facility}${compact ? " facility-hero--compact" : ""}`}
            style={style}
        >
            <div className="facility-hero-main">
                {onBack && <BackToVillageButton onClick={onBack} />}
                <div className="facility-hero-copy">
                    <p className="facility-hero-kicker">{eyebrow}</p>
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
            </div>
            <dl className="facility-hero-metrics" aria-label={`${title} overview`}>
                {metrics.map((metric) => (
                    <div key={metric.label} data-tone={metric.tone ?? "default"}>
                        <dt>{metric.label}</dt>
                        <dd>{metric.value}</dd>
                    </div>
                ))}
            </dl>
        </header>
    );
}
