import type { CSSProperties, ReactNode } from "react";
import "../styles/central-skin.css";

type CentralDestinationHeaderProps = {
    art?: string;
    backLabel?: string;
    eyebrow: string;
    icon: ReactNode;
    onBack: () => void;
    statusLabel?: string;
    statusValue?: ReactNode;
    subtitle: string;
    title: string;
    tone?: "azure" | "gold" | "violet" | "crimson";
};

export function CentralDestinationHeader({
    art,
    backLabel = "Central",
    eyebrow,
    icon,
    onBack,
    statusLabel,
    statusValue,
    subtitle,
    title,
    tone = "gold",
}: CentralDestinationHeaderProps) {
    const style = art
        ? ({ "--destination-art": `url(${art})` } as CSSProperties)
        : undefined;

    return (
        <header className={`central-destination-header${art ? " has-art" : ""}`} data-tone={tone} style={style}>
            <button type="button" className="central-destination-back" onClick={onBack} aria-label={`Return to ${backLabel}`}>
                <span aria-hidden="true">←</span>
                <span>{backLabel}</span>
            </button>

            <div className="central-destination-identity">
                <span className="central-destination-icon" aria-hidden="true">{icon}</span>
                <div className="central-destination-copy">
                    <span className="central-destination-eyebrow">{eyebrow}</span>
                    <h2>{title}</h2>
                    <p>{subtitle}</p>
                </div>
            </div>

            {statusLabel && (
                <div className="central-destination-status" aria-label={`${statusLabel}: ${String(statusValue ?? "")}`}>
                    <span>{statusLabel}</span>
                    <strong>{statusValue}</strong>
                </div>
            )}
        </header>
    );
}
