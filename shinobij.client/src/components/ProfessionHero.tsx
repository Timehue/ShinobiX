/*
 * Profession hub hero banner — a wide painted scene with a dark gradient scrim,
 * the profession icon + name + tagline, and an accent underline. Shared by the
 * three profession hub screens so they share one look. Pure leaf, image baked in.
 */

import type { CSSProperties } from "react";

export function ProfessionHero({
    image,
    icon,
    title,
    tagline,
    accent,
}: {
    image: string;
    icon: string;
    title: string;
    tagline: string;
    accent: string;
}) {
    return (
        <header
            className="profession-hero"
            style={{
                "--profession-accent": accent,
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: "1rem",
                border: `1px solid ${accent}66`,
                minHeight: 150,
                backgroundImage: `linear-gradient(180deg, rgba(8,10,22,0.25), rgba(8,10,22,0.88)), url(${image})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
            } as CSSProperties}
        >
            <div className="profession-hero-content" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 18px" }}>
                <div className="profession-hero-identity" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="profession-hero-icon" aria-hidden="true" style={{ fontSize: 40, color: accent, lineHeight: 1, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{icon}</span>
                    <div className="profession-hero-copy">
                        <h2 style={{ margin: 0, color: "#faf5ff", textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>{title}</h2>
                        <p style={{ margin: "2px 0 0", color: accent, fontStyle: "italic", fontSize: 14, textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>{tagline}</p>
                    </div>
                </div>
                <div className="profession-hero-rule" aria-hidden="true" style={{ height: 3, width: 64, background: accent, borderRadius: 2, marginTop: 10 }} />
            </div>
        </header>
    );
}
