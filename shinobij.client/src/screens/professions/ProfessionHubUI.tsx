import type { ReactNode } from "react";

export function ProfessionSectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: ReactNode }) {
    return <div className="ph-section-heading"><div><span className="ph-eyebrow">{eyebrow}</span><h3>{title}</h3></div>{detail && <span className="ph-section-detail">{detail}</span>}</div>;
}

export function ProfessionDestination({ image, title, description, onClick, disabled, status, featured = false }: {
    image: string; title: string; description: string; onClick: () => void; disabled?: boolean; status?: string; featured?: boolean;
}) {
    return <button type="button" className={`ph-destination${featured ? " is-featured" : ""}`} onClick={onClick} disabled={disabled} title={status}>
        <img src={image} alt="" loading="lazy" />
        <span className="ph-destination-copy"><strong>{title}</strong><span>{disabled && status ? status : description}</span></span>
        <span className="ph-destination-arrow" aria-hidden="true">{disabled ? "—" : "↗"}</span>
    </button>;
}

export function ProfessionMetric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
    return <div className="ph-metric"><dt>{label}</dt><dd>{value}</dd><span>{detail}</span></div>;
}
