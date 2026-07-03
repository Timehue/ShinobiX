/*
 * PlayerNameplate — the badge-chip identity row from the design handoff:
 *
 *   Rill   [ Lvl 50 ] [ Fated ] [ Moonlit Ghost ] [ Moonshadow ]
 *
 * Priority order (handoff): level, custom title, earned/legacy title, village.
 * Pure presentation — every value is passed in; ownership/moderation is
 * enforced server-side (api/save/[name].ts + api/_titles-registry.ts).
 */
import type { CSSProperties } from "react";
import { titleStyleColor, type LegacyRarity } from "../lib/legacy";

const CHIP: CSSProperties = {
    display: "inline-block", padding: "1px 8px", borderRadius: 999,
    fontSize: ".68rem", lineHeight: 1.6, whiteSpace: "nowrap",
    border: "1px solid rgba(148,163,184,.35)", color: "#cbd5e1",
    background: "rgba(148,163,184,.08)",
};

export function PlayerNameplate({ name, level, customTitle, customTitleStyle, customTitleIcon, legacyTitle, village }: {
    name: string;
    level?: number;
    customTitle?: string | null;
    customTitleStyle?: string | null;
    customTitleIcon?: string | null;
    legacyTitle?: string | null;
    // legacyRarity intentionally omitted — legacy rank is owner-only and never
    // colored on the nameplate. Callers may still pass it; it is ignored.
    legacyRarity?: LegacyRarity | null;
    village?: string | null;
}) {
    // Every legacy chip uses the same accent — rank is never revealed.
    const rarityColor = "#c084fc";
    const titleColor = titleStyleColor(customTitleStyle);
    return (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: "1.05rem", color: "#f1f5f9" }}>{name}</b>
            {typeof level === "number" && level > 0 && (
                <span style={CHIP}>Lvl {level}</span>
            )}
            {customTitle && customTitle !== legacyTitle && (
                <span style={{ ...CHIP, borderColor: `${titleColor}73`, color: titleColor, background: `${titleColor}14` }}>
                    {customTitleIcon ? `${customTitleIcon} ` : ""}{customTitle}
                </span>
            )}
            {legacyTitle && (
                <span style={{ ...CHIP, borderColor: `${rarityColor}66`, color: rarityColor, background: `${rarityColor}14` }}>{legacyTitle}</span>
            )}
            {village && (
                <span style={CHIP}>{village}</span>
            )}
        </div>
    );
}
