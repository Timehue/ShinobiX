/*
 * GameIcon — a small, cohesive set of inline-SVG game glyphs.
 *
 * These are authored as source (not uploaded through /api/images, which
 * rejects SVG for XSS reasons — that gate is for runtime uploads, not trusted
 * committed code). Being vector + `currentColor` means:
 *   • zero bandwidth — they ship in the JS bundle, never as polled image data
 *   • crisp at any DPR / size (mobile-safe)
 *   • themeable — they inherit text color, or set one via style/CSS var:
 *        <GameIcon name="ryo" style={{ color: "var(--gold, #f4c95d)" }} />
 *
 * Usage:
 *   <GameIcon name="ryo" />                       // 18px, inherits color
 *   <GameIcon name="shard" size={22} title="Shards" />   // labelled (a11y)
 *
 * Add a new glyph: extend GameIconName + add a PATHS entry (24×24 viewBox).
 * Keep the filled style + `currentColor` so the set stays visually coherent.
 */
import type { CSSProperties, ReactElement } from "react";
import type { GameIconName } from "./icon-names";

export type { GameIconName } from "./icon-names";

// Inner SVG for each glyph. The parent <svg> sets fill="currentColor", so a
// plain <path> inherits it; lighter accents use opacity, and any line detail is
// cut out with fillRule="evenodd" so it reads against any background color.
const PATHS: Record<GameIconName, ReactElement> = {
    // Two overlapping mon coins (circle with a square hole) — reads as currency.
    ryo: (
        <>
            <path opacity=".45" fillRule="evenodd" clipRule="evenodd" d="M8 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-1.6 4.9h3.2v3.2H6.4V9.4Z" />
            <path fillRule="evenodd" clipRule="evenodd" d="M15 6a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-1.6 4.9h3.2v3.2h-3.2V10.9Z" />
        </>
    ),
    // Faceted gem: solid body + low-opacity crown/girdle facet lines.
    shard: (
        <>
            <path d="M8 2.5h8l3 6-7 13.5L5 8.5z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".5" d="M5 8.5h14M8 2.5 9.7 8.5 12 22M16 2.5 14.3 8.5 12 22" />
        </>
    ),
    // Five-sided cut crystal stone (distinct from the pointed gem above).
    crystal: (
        <>
            <path d="M12 2.5 18 7 16 18.5 8 18.5 6 7Z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.05" strokeLinejoin="round" opacity=".42" d="M6 7 12 10.5 18 7M12 10.5 12 18.3" />
        </>
    ),
    // Four-point sparkle with a small accent spark.
    sparkle: (
        <>
            <path d="M12 2.5 14.2 9.8 21.5 12 14.2 14.2 12 21.5 9.8 14.2 2.5 12 9.8 9.8Z" />
            <circle cx="18.6" cy="5.6" r="1.15" opacity=".6" />
        </>
    ),
    // Five-point star inside a thin ring — a stamped seal/sigil.
    sigil: (
        <>
            <path d="M12 5.5 13.59 9.82 18.18 9.99 14.57 12.83 15.82 17.26 12 14.7 8.18 17.26 9.43 12.83 5.82 9.99 10.41 9.82Z" />
            <circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" strokeWidth="1.3" opacity=".5" />
        </>
    ),
    // Dog-bone charm — four lobes joined by a shaft (union of same-fill shapes).
    bone: (
        <>
            <circle cx="7.6" cy="9.4" r="2.3" />
            <circle cx="7.6" cy="14.6" r="2.3" />
            <circle cx="16.4" cy="9.4" r="2.3" />
            <circle cx="16.4" cy="14.6" r="2.3" />
            <path d="M7.6 10.4h8.8v3.2H7.6z" />
        </>
    ),
    // Ribbon tails + a ringed medal disc with a center boss.
    medal: (
        <>
            <path opacity=".55" d="M9 2.5 6.2 8l2.7 1.3L11.4 4zM15 2.5 17.8 8l-2.7 1.3L12.6 4z" />
            <path fillRule="evenodd" clipRule="evenodd" d="M12 7.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 2.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z" />
            <circle cx="12" cy="14.5" r="2.4" />
        </>
    ),
    // Chakra orb with three tomoe cut out (sharingan-style).
    chakra: (
        <path fillRule="evenodd" clipRule="evenodd" d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 6.6a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM8.8 12.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM15.2 12.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z" />
    ),
    hp: (
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    ),
    // Upright blade: tip, guard, grip, pommel.
    sword: (
        <>
            <path d="M12 2l2.2 3.2V13h-4.4V5.2L12 2Z" />
            <path d="M8.4 13h7.2v2.2H8.4z" />
            <path d="M11 15.2h2v5.4h-2z" />
            <path d="M9.8 20.4h4.4V22H9.8z" />
        </>
    ),
    // Heater shield with an inset lighter shield.
    shield: (
        <>
            <path d="M12 2.2 4.5 5.1v6.2c0 4.9 3.3 8.4 7.5 10.5 4.2-2.1 7.5-5.6 7.5-10.5V5.1L12 2.2Z" />
            <path opacity=".4" d="M12 5.2 7.5 7v4.3c0 3.2 2 5.6 4.5 7 2.5-1.4 4.5-3.8 4.5-7V7L12 5.2Z" />
        </>
    ),
    // Parchment with three text lines cut out (reads as a jutsu scroll).
    scroll: (
        <path fillRule="evenodd" clipRule="evenodd" d="M6.5 3h9A2.5 2.5 0 0 1 18 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Zm1 4.5v1.4h9V7.5h-9Zm0 3.5v1.4h9V11h-9Zm0 3.5v1.4h6v-1.4h-6Z" />
    ),
    // Folded travel map with two creases — tiles / expedition.
    map: (
        <>
            <path d="M3 5.5 9 4 15 6 21 4.5V18.5L15 20 9 18 3 19.5Z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.05" opacity=".4" d="M9 4V18M15 6V20" />
        </>
    ),
    // Bullseye ring + center dot — hunts.
    target: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6Z" />
            <circle cx="12" cy="12" r="2.6" />
        </>
    ),
    // Die showing five pips (cut out) — fate spins.
    dice: (
        <path fillRule="evenodd" clipRule="evenodd" d="M6 3.5h12a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5ZM7.8 6.65a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3ZM16.2 6.65a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3ZM12 10.85a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3ZM7.8 15.05a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3ZM16.2 15.05a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
    ),
    // Clock face + hands — daily reset timer.
    clock: (
        <>
            <circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M12 7.3V12l3.1 2" />
        </>
    ),
    // Dumbbell — physical / stat training.
    dumbbell: (
        <>
            <rect x="3" y="8" width="2.5" height="8" rx="1" />
            <rect x="5.5" y="9.6" width="1.7" height="4.8" rx=".8" />
            <rect x="7.2" y="11" width="9.6" height="2" rx="1" />
            <rect x="16.8" y="9.6" width="1.7" height="4.8" rx=".8" />
            <rect x="18.5" y="8" width="2.5" height="8" rx="1" />
        </>
    ),
    // Paw print — four toe beans over a pad.
    paw: (
        <>
            <ellipse cx="8" cy="10" rx="1.55" ry="2" />
            <ellipse cx="11.1" cy="8.3" rx="1.6" ry="2.15" />
            <ellipse cx="14.3" cy="8.3" rx="1.6" ry="2.15" />
            <ellipse cx="16.4" cy="10" rx="1.55" ry="2" />
            <path d="M12 12.6c2.7 0 4.7 1.7 4.7 3.7 0 1.7-1.9 2.7-4.7 2.7s-4.7-1-4.7-2.7c0-2 2-3.7 4.7-3.7Z" />
        </>
    ),
    // Gift box with a vertical ribbon (cut) + bow — reward ready.
    gift: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M3.6 8.4h16.8v3H3.6zM5 11.4h14v8.6H5zM11.1 8.4h1.8v11.6h-1.8z" />
            <path d="M12 8.4 8.6 5.2Q8.2 7.4 11.4 8.4ZM12 8.4 15.4 5.2Q15.8 7.4 12.6 8.4Z" />
        </>
    ),
};

export function GameIcon({
    name,
    size = 18,
    title,
    className,
    style,
}: {
    name: GameIconName;
    /** Square px size (width = height). Defaults to 18. */
    size?: number;
    /** Accessible label. Omit for purely decorative icons (then aria-hidden). */
    title?: string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            className={className}
            style={style}
            fill="currentColor"
            role={title ? "img" : undefined}
            aria-hidden={title ? undefined : true}
            focusable="false"
        >
            {title ? <title>{title}</title> : null}
            {PATHS[name]}
        </svg>
    );
}
