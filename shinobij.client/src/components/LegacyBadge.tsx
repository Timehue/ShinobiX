/*
 * LegacyBadge — the one violet identity mark for a Legacy, shared by every
 * player-facing surface (accepted card, UserView, tavern, directory). It reuses
 * the generated /badges/legacy-<slug>.png art, but when that image is missing
 * or fails to load it degrades to a violet MONOGRAM (the legacy's initial in a
 * #c084fc box) instead of vanishing — so the mark is never fully lost.
 *
 * Rank is owner-only: the box is the same violet for every legacy and encodes
 * no rarity/tier. Optional `stage` (>=2) adds the same aura halo used elsewhere.
 */
import { useState } from "react";

const LEGACY_ACCENT = "#c084fc";

export function LegacyBadge({ badge, name, size = 40, stage = 0, radius }: {
    badge: string | null | undefined;
    name: string;
    size?: number;
    /** Legacy stage 1-5; >=2 lights the aura halo. */
    stage?: number;
    /** Corner radius override; defaults to ~20% of size (a rounded square). */
    radius?: number;
}) {
    const [failed, setFailed] = useState(false);
    const r = radius ?? Math.round(size * 0.2);
    const auraClass = stage >= 2 ? `legacy-aura-s${Math.min(5, stage)}` : undefined;
    const initial = name.replace(/^Legacy of (the )?/i, "").trim().charAt(0).toUpperCase() || "◆";
    const showFallback = !badge || failed;
    return (
        <span
            className={auraClass}
            style={{
                width: size, height: size, borderRadius: r, flexShrink: 0, overflow: "hidden",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: showFallback ? `${LEGACY_ACCENT}22` : undefined,
                border: showFallback ? `1px solid ${LEGACY_ACCENT}66` : undefined,
                color: LEGACY_ACCENT, fontWeight: 700, fontSize: size * 0.42, lineHeight: 1,
            }}
            aria-hidden="true"
        >
            {showFallback
                ? initial
                : <img
                    src={`/badges/legacy-${badge}.png`} alt=""
                    style={{ width: "100%", height: "100%", borderRadius: r, display: "block" }}
                    onError={() => setFailed(true)}
                />}
        </span>
    );
}
