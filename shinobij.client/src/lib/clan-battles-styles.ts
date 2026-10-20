import type {CSSProperties} from 'react';
/** Shared immutable presentation values; original styles and action logic stay identical. */
export const warActionRow:Readonly<CSSProperties>={ background: "#0b1220", padding: "0.5rem 0.7rem", borderRadius: 4, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
export const warFlexibleField:Readonly<CSSProperties>={ flex: 1, minWidth: 200 };
export const warMutedHeading:Readonly<CSSProperties>={ color: "var(--text-dim)", fontWeight: 400 };
export const warPrimaryButton:Readonly<CSSProperties>={ padding: "0.3rem 0.6rem", background: "#15803d", borderColor: "var(--green-400)", fontSize: "0.85rem" };
export const warSmallButton:Readonly<CSSProperties>={ padding: "0.3rem 0.6rem", fontSize: "0.8rem" };
export const warSectionCard:Readonly<CSSProperties>={ background: "#0b1220", border: "1px solid var(--slate-700)", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" };
