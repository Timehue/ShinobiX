import { BackToVillageButton } from "./BackToVillageButton";

/** Shared art direction for the three profession headquarters. */
export function ProfessionHero({ image, title, tagline, chapter, description, village, onBack }: {
    image: string; title: string; tagline: string; chapter: string; description: string; village: string; onBack: () => void;
}) {
    return <header className="profession-hero ph-hero">
        <img className="ph-hero-art" src={image} alt="" fetchPriority="high" />
        <div className="ph-hero-nav"><BackToVillageButton onClick={onBack} label="← Back" /><span className="ph-hero-location">{village}</span></div>
        <div className="profession-hero-content ph-hero-copy">
            <span className="ph-eyebrow">{chapter}</span>
            <h2>{title}</h2>
            <p className="ph-hero-tagline">{tagline}</p>
            <p className="ph-hero-description">{description}</p>
        </div>
        <span className="ph-hero-seal" aria-hidden="true">SHINOBI / PROFESSIONS</span>
    </header>;
}
