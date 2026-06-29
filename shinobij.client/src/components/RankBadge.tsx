import { eloTier } from "../lib/ranked-tier";

/**
 * Small colored pill showing a player's ranked TIER (derived from their Elo
 * rating) so ranked standing reads as recognisable status wherever a name
 * appears — profile, Nindo card, leaderboards, player view. Self-contained
 * inline styles (no global CSS), presentation only.
 *
 * Pass `showRating` to append the raw Elo (e.g. "Jōnin · 1240"); the rating is
 * always in the tooltip. Renders nothing for an undefined rating so callers can
 * drop it in unconditionally for players who have never queued ranked.
 */
export function RankBadge({
    rating,
    showRating = false,
    size = "sm",
}: {
    rating?: number | null;
    showRating?: boolean;
    size?: "sm" | "xs";
}) {
    if (rating === undefined || rating === null) return null;
    const r = Math.max(0, Math.round(Number(rating) || 0));
    const tier = eloTier(r);
    const pad = size === "xs" ? "1px 6px" : "2px 8px";
    const font = size === "xs" ? 10.5 : 11.5;
    return (
        <span
            className="rank-tier-badge"
            title={`Ranked tier: ${tier.name} (${r} Elo)`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: pad,
                borderRadius: 999,
                fontSize: font,
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: 0.2,
                color: tier.color,
                background: `${tier.color}1a`,
                border: `1px solid ${tier.color}55`,
                whiteSpace: "nowrap",
            }}
        >
            {tier.name}{showRating ? ` · ${r}` : ""}
        </span>
    );
}
