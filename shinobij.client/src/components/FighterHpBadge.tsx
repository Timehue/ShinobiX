// Always-visible per-fighter HP bar that floats just above a combatant's board
// orb, so HP reads AT the fighter instead of only in the corner side-HUD. This
// generalizes the summoned-pet badge that already lived inline in Arena.tsx
// (petHpBadge) and the on-orb bar in Battle Towers, so PvE, PvP (and later
// Towers) share ONE implementation and can't drift.
//
// Purely presentational + purely cosmetic: it renders an absolutely-positioned
// bar at a caller-computed (left, top) INSIDE the `.hex-grid-layer` (which the
// board's transform:scale() shrinks to fit), so it auto-scales with the
// fighters and needs no isMobile branch. It never intercepts clicks
// (pointerEvents:none) and never changes combat outcomes. Do NOT portal it to
// document.body — that would break the board-scale transform + coordinate
// origin the fighters are positioned in.

// Traffic-light HP colour by fraction-of-max — identical ramp to the pet badge
// and CombatSideHud (>50 green, >25 amber, else red) so every HP readout in the
// game agrees.
function hpBarColor(pct: number): string {
    return pct > 50 ? "#22c55e" : pct > 25 ? "#f59e0b" : "#ef4444";
}

// Glide the badge with its fighter on Move / Push / Pull / ground relocation —
// same easing the orbs use, so the bar travels with the unit rather than
// snapping. Matches ORB_PATH_TRANSITION in the battle screens.
const BADGE_GLIDE = "left 280ms ease, top 280ms ease";

export function FighterHpBadge({
    left,
    top,
    width,
    hp,
    maxHp,
    side,
    caption,
    showNumbers = true,
    zIndex = 11,
}: {
    /** x of the fighter's orb inside `.hex-grid-layer` (same value the orb uses). */
    left: number;
    /** y for the TOP of the badge — callers pass the orb's y minus a head offset. */
    top: number;
    /** badge width — pass the orb size (ORB) so the bar spans the token. */
    width: number;
    hp: number;
    maxHp: number;
    /** drives the border tint so a glance says whose bar it is. */
    side: "player" | "enemy" | "pet";
    /** optional caption line under the bar (e.g. the pet's name + turns-left). */
    caption?: string;
    /** when true (default) and no caption is given, shows `cur/max` under the bar. */
    showNumbers?: boolean;
    zIndex?: number;
}) {
    const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    const color = hpBarColor(pct);
    // Side-tinted border (blue player / red enemy / dark pet) + a hard shadow so
    // the bar survives busy biome backgrounds.
    const border =
        side === "enemy" ? "rgba(239,68,68,0.9)" :
        side === "player" ? "rgba(96,165,250,0.9)" :
        "rgba(0,0,0,0.6)";
    const label = caption ?? (showNumbers ? `${Math.max(0, Math.round(hp))}/${Math.round(maxHp)}` : "");
    return (
        <div style={{ position: "absolute", left, top, width, zIndex, pointerEvents: "none", transition: BADGE_GLIDE }}>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(2,6,18,0.72)", overflow: "hidden", border: `1px solid ${border}`, boxShadow: "0 1px 2px rgba(0,0,0,0.75)" }}>
                <span style={{ display: "block", height: "100%", width: `${pct}%`, background: color, transition: "width 280ms ease" }} />
            </div>
            {label && (
                <div style={{ fontSize: 9, lineHeight: 1.25, textAlign: "center", color: "#e5e7eb", textShadow: "0 1px 2px #000", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {label}
                </div>
            )}
        </div>
    );
}
