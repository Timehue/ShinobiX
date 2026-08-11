/*
 * ShowdownIcon — the Pet Showdown glyph set.
 *
 * Every symbol in the battle HUD used to be an OS emoji, which means the mode's
 * entire visual language changed shape, palette and light direction depending on
 * whether the player was on Windows, macOS or Android. These are authored
 * instead: one shape language, one light direction, tintable with `color`.
 *
 * Shape rules (keep these when adding a glyph):
 *   - 24x24 viewBox, live area 20x20 (2 units of optical margin all round).
 *     Round marks overshoot to ~21 so they read the same optical size as squares.
 *   - Filled silhouette in `currentColor`; detail is CUT OUT with evenodd, never
 *     drawn in a second colour. Accent masses use opacity, never a gradient —
 *     a gradient breaks `currentColor` tinting and costs bytes.
 *   - Light from the top-left: the lit sub-path sits upper-left at .40-.55.
 *   - Legible at 14px: no feature under 2 units, no gap under 1.5, <=3 masses.
 *   - Icons never shear. The 26 degree cut belongs to frames and bars.
 *
 * Usage:  <ShowdownIcon name="strike" />            18px, inherits color
 *         <ShowdownIcon name="elem-fire" size={22} title="Fire" />
 */
import type { CSSProperties, ReactElement } from "react";
import type { ShowdownIconName } from "./showdown-icon-names";

export type { ShowdownIconName } from "./showdown-icon-names";

const PATHS: Record<ShowdownIconName, ReactElement> = {
    // ── Element crests ──────────────────────────────────────────────────────
    // Two-tongued flame. The second tongue is what stops it reading as a
    // droplet — a single teardrop is water, and these two sit side by side.
    "elem-fire": (
        <>
            <path d="M13.4 1.4c.9 3.4-.4 5.6-1.9 7.4-1.2 1.5-2.5 2.8-3.2 4.6-.9 2.3-.3 4.9 1.6 6.4 1.2 1 2.7 1.4 4.1 1.2 3.2-.4 5.6-3.2 5.6-6.5 0-2.4-1.2-4.2-2.6-6-.2 1.3-.8 2.2-1.8 2.8.7-4.1-.7-7.4-1.8-9.9Z" />
            <path opacity=".5" d="M7.4 10.2c-1.9 2-3.4 4-3.4 6.5 0 1.6.5 3 1.5 4.2-2.4-1.2-4-3.7-4-6.5 0-2.7 1.8-4.9 3.7-6.6.4 1 1.2 1.8 2.2 2.4Z" />
        </>
    ),
    // Droplet with a crescent highlight cut from the upper-left face.
    "elem-water": (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2.1c3.9 4.9 6.5 8.2 6.5 11.6a6.5 6.5 0 1 1-13 0c0-3.4 2.6-6.7 6.5-11.6Zm-2.3 8.1c-1.3 1.6-2 3-2 4.2a1.2 1.2 0 0 0 2.4 0c0-1 .5-2.2 1.4-3.6a1.2 1.2 0 0 0-1.8-.6Z" />
        </>
    ),
    // Three gust lines with hooked ends — the tomoe lobes read as blobs at 14px.
    "elem-wind": (
        <>
            <path d="M2.4 5h10.9a2.3 2.3 0 1 0-2.2-2.9l-2.3-.6A4.7 4.7 0 1 1 13.3 7.4H2.4V5Z" />
            <path opacity=".78" d="M2.4 10.8h14.3a2.5 2.5 0 1 1-2.4 3.2l-2.3.6a4.9 4.9 0 1 0 4.7-6.2H2.4v2.4Z" />
            <path opacity=".5" d="M2.4 16.6h7.2a2.1 2.1 0 1 0-2-2.7l-2.3-.6a4.5 4.5 0 1 1 4.3 5.7H2.4v-2.4Z" />
        </>
    ),
    // Bolt.
    "elem-lightning": (
        <>
            <path d="M13.9 2 5.2 13.1h5.2L9.4 22l9.2-11.6h-5.4L13.9 2Z" />
            <path opacity=".45" d="M13.9 2 5.2 13.1h3l5.7-11.1Z" />
        </>
    ),
    // Two angular boulders. A single pentagon reads as a house and a seam band
    // reads as an open box; overlapping stones read as stone.
    "elem-earth": (
        <>
            <path d="M13.8 4.6 21.6 9.6l-1.8 10.6H8.4L6.4 10.2l7.4-5.6Z" />
            <path opacity=".42" d="M13.8 4.6 21.6 9.6l-3.4 1.6-4.8-2.6-4.6 2.4-2.4-.8 7.4-5.6Z" />
            <path opacity=".62" d="M5.4 12.2 9.8 15l-.8 5.2H2.4l-.8-5.6 3.8-2.4Z" />
        </>
    ),
    // Hollow ring + four radial spokes — "elementless", not an empty slot.
    "elem-none": (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2Zm0 2.4a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Z" />
            <path opacity=".55" d="M11 1.4h2v3.2h-2zM11 19.4h2v3.2h-2zM19.4 11v2h3.2v-2zM1.4 11v2h3.2v-2z" />
        </>
    ),

    // ── Offense ─────────────────────────────────────────────────────────────
    // Upright blade with a crossguard and pommel.
    strike: (
        <>
            <path d="M12 1.4 15 7.4v8.2H9V7.4l3-6Z" />
            <path opacity=".45" d="M12 1.4 15 7.4h-6l3-6Z" />
            <path d="M7.2 16.4h9.6v2.3h-3.7v3.9h-2.2v-3.9H7.2v-2.3Z" />
        </>
    ),
    // Mallet: wide head, centred haft, two chips knocked out of the striking face.
    crush: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M3.4 3.6h17.2v6.8H3.4V3.6Zm3.4 6.8-1.4 2.6h3l1.3-2.6h-2.9Zm8.4 0-1.4 2.6h3l1.3-2.6h-2.9Z" />
            <path opacity=".42" d="M3.4 3.6h17.2v2.2H3.4V3.6Z" />
            <path d="M10.6 10.4h2.8v10h-2.8z" />
        </>
    ),
    // Three parallel claw slashes, leaning 26 degrees.
    rend: (
        <>
            <path d="M6.6 2.8 11 2l-4 19.2-3.2-1.5L6.6 2.8Z" />
            <path opacity=".72" d="M12.4 2.8 16.8 2l-4 19.2-3.2-1.5 2.8-16.9Z" />
            <path opacity=".45" d="M18.2 4.4 21.6 4l-3.2 15.2-2.6-1.2 2.4-13.6Z" />
        </>
    ),
    // Droplet drawn up a return arrow — the arrow is a real hook with a head.
    siphon: (
        <>
            <path d="M8.6 1.8c2.7 3.4 4.4 5.6 4.4 7.8a4.4 4.4 0 1 1-8.8 0c0-2.2 1.7-4.4 4.4-7.8Z" />
            <path opacity=".75" d="M13.4 14.4h2.6v3.1a2.5 2.5 0 0 0 2.5 2.5h2.1v2.6h-2.1a5.1 5.1 0 0 1-5.1-5.1v-3.1Z" />
            <path opacity=".75" d="m14.7 9.6 4.4 4.8h-8.8l4.4-4.8Z" />
        </>
    ),
    // Flame over a three-dot damage-over-time rail.
    pyre: (
        <>
            <path d="M12 1.8c.8 2.5 4.8 4.4 4.8 8.1a4.8 4.8 0 0 1-9.6 0c0-1.6.7-2.7 1.7-3.8.2.9.6 1.5 1.2 1.9.3-2.4 1.2-4.2 1.9-6.2Z" />
            <path opacity=".45" d="M10.1 8c-1 1.1-1.7 2.2-1.7 3.8H6.6c0-2.2 1.2-3.9 2.3-5 .2.5.7.9 1.2 1.2Z" />
            <path opacity=".8" d="M4.6 17.2h2.6v2.6H4.6zM10.7 17.2h2.6v2.6h-2.6zM16.8 17.2h2.6v2.6h-2.6z" />
        </>
    ),

    // ── Control ─────────────────────────────────────────────────────────────
    // Two interlocking rings — an actual chain reads at 14px; U-shapes do not.
    bind: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M8.2 2.6a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2Zm0 2.8a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
            <path fillRule="evenodd" clipRule="evenodd" opacity=".72" d="M15.8 10.2a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2Zm0 2.8a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
        </>
    ),
    // Six-spoke frost crystal.
    frost: (
        <>
            <path d="M10.9 1.8h2.2v20.4h-2.2z" />
            <path opacity=".82" d="M10.9 1.8h2.2v20.4h-2.2z" transform="rotate(60 12 12)" />
            <path opacity=".62" d="M10.9 1.8h2.2v20.4h-2.2z" transform="rotate(120 12 12)" />
            <path opacity=".55" d="m12 3.9 2.6 2.4-1.5 1.6L12 6.7l-1.1 1.2-1.5-1.6L12 3.9ZM12 20.1l-2.6-2.4 1.5-1.6 1.1 1.2 1.1-1.2 1.5 1.6-2.6 2.4Z" />
        </>
    ),
    // Spiral with a broken outer arc — disoriented.
    daze: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Zm0 2.1a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z" />
            <path opacity=".7" d="M12 4.4a7.6 7.6 0 0 1 7.4 5.9l-2.3.5A5.3 5.3 0 0 0 12 6.7V4.4ZM12 19.6a7.6 7.6 0 0 1-7.4-5.9l2.3-.5A5.3 5.3 0 0 0 12 17.3v2.3Z" />
            <path opacity=".45" d="m18.6 3.6 2.3 2.9-3.7.2 1.4-3.1ZM5.4 20.4l-2.3-2.9 3.7-.2-1.4 3.1Z" />
        </>
    ),
    // Hook with a motion tail — drags a target off its line.
    drag: (
        <>
            <path d="M14.6 2.4h2.3v8.4a4.9 4.9 0 0 1-9.8 0h2.3a2.6 2.6 0 0 0 5.2 0V2.4Z" />
            <path opacity=".55" d="M2.4 6.2h6.2v2.2H2.4zM4.6 10.4h4v2.2h-4z" />
            <path opacity=".72" d="m19.6 3.6 2 3.4h-4l2-3.4Z" />
        </>
    ),
    // Bullseye.
    mark: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2Zm0 2.4a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4Z" />
            <path fillRule="evenodd" clipRule="evenodd" opacity=".62" d="M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Zm0 2.3a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z" />
            <path d="M10.9 10.9h2.2v2.2h-2.2z" />
        </>
    ),
    // Open hand raised — "come at me", not an announcement.
    provoke: (
        <>
            <path d="M8.2 4.1a1.2 1.2 0 0 1 2.4 0v6.1h.9V2.9a1.2 1.2 0 0 1 2.4 0v7.3h.9V4.6a1.2 1.2 0 0 1 2.4 0v8.6c0 4.6-2.1 8.4-5.6 8.4-3.1 0-5-2.3-6.2-5.4l-1.3-3.4a1.3 1.3 0 0 1 2.2-1.3l1.5 2.2V4.1Z" />
            <path opacity=".45" d="M8.2 4.1a1.2 1.2 0 0 1 2.4 0v6.1H8.2V4.1Z" />
        </>
    ),

    // ── Support ─────────────────────────────────────────────────────────────
    // Cross with softened arms inside a partial ring.
    mend: (
        <>
            <path d="M10.4 6.6h3.2v3.8h3.8v3.2h-3.8v3.8h-3.2v-3.8H6.6v-3.2h3.8V6.6Z" />
            <path opacity=".55" d="M12 1.6a10.4 10.4 0 0 1 9.7 6.7l-2.2.8A8 8 0 0 0 12 4V1.6ZM12 22.4a10.4 10.4 0 0 1-9.7-6.7l2.2-.8A8 8 0 0 0 12 20v2.4Z" />
        </>
    ),
    // Heater shield — a held object, flat soak.
    aegis: (
        <>
            <path d="M12 1.9 20.4 4v7.3c0 4.6-3.3 8.4-8.4 10.8-5.1-2.4-8.4-6.2-8.4-10.8V4L12 1.9Z" />
            <path opacity=".42" d="M12 1.9 20.4 4v7.3c0 .6-.1 1.2-.2 1.8H12V1.9Z" />
        </>
    ),
    // Arced dome over a baseline — a field over you, not a thing you hold.
    veil: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 3.4a9 9 0 0 1 9 9v2.2h-2.4v-2.2a6.6 6.6 0 0 0-13.2 0v2.2H3v-2.2a9 9 0 0 1 9-9Z" />
            <path opacity=".55" d="M7.4 12.4h2.3v2.2H7.4zM14.3 12.4h2.3v2.2h-2.3z" />
            <path opacity=".82" d="M3 17.4h18v2.4H3z" />
        </>
    ),

    // ── Stances and menu actions ────────────────────────────────────────────
    // Exhaled vapour curling up into a wisp.
    breath: (
        <>
            <path d="M4.6 15.4a4.4 4.4 0 0 1 1.5-8.5c.5 0 1 .1 1.5.3A5.6 5.6 0 0 1 18 8.5a3.5 3.5 0 0 1-.4 6.9H4.6Z" />
            <path opacity=".5" d="M9.4 17.9h7.2v2.2H9.4zM12.6 21h5.6v1.8h-5.6z" />
        </>
    ),
    // Two creature lozenges swapping along an arc.
    rotate: (
        <>
            <path d="M6.4 4.6a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" opacity=".62" />
            <path d="M17.6 11.4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
            <path opacity=".82" d="M14.9 3.6 21 5.9l-3.9 4.7-.5-2.7c-2.6.4-4 1.6-5 3.4l-2-1.1c1.4-2.6 3.7-4.2 6.7-4.6l-.4-2ZM9.1 20.4 3 18.1l3.9-4.7.5 2.7c2.6-.4 4-1.6 5-3.4l2 1.1c-1.4 2.6-3.7 4.2-6.7 4.6l.4 2Z" />
        </>
    ),
    // A shield planted on the ground — the stance, not the object.
    brace: (
        <>
            <path d="M12 1.8 20.4 3.9v5.7c0 3.9-3.2 7.3-8.4 9.4-5.2-2.1-8.4-5.5-8.4-9.4V3.9L12 1.8Z" />
            <path opacity=".42" d="M12 1.8 20.4 3.9v5.7c0 .5 0 1-.2 1.4H12V1.8Z" />
            <path opacity=".8" d="M2.6 20.2h18.8v2.4H2.6z" />
        </>
    ),
    // A five-point star inside a segmented ring.
    signature: (
        <>
            <path d="m12 4.2 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 4.2Z" />
            <path opacity=".45" d="M11 .8h2v2.6h-2zM11 20.6h2v2.6h-2zM20.6 11h2.6v2h-2.6zM.8 11h2.6v2H.8zM17.8 4.7l1.5 1.4-1.9 1.9-1.4-1.4 1.8-1.9ZM6.2 19.3l-1.5-1.4 1.9-1.9 1.4 1.4-1.8 1.9ZM19.3 17.9l-1.4 1.4-1.9-1.9 1.4-1.4 1.9 1.9ZM4.7 6.1 6.1 4.7 8 6.6 6.6 8 4.7 6.1Z" />
        </>
    ),
    // Scroll with both rolls visible and a ruled body.
    scroll: (
        <>
            <path d="M3.2 2.6h17.6v3.2H3.2zM3.2 18.2h17.6v3.2H3.2z" />
            <path fillRule="evenodd" clipRule="evenodd" opacity=".7" d="M5.6 6.6h12.8v10.8H5.6V6.6Zm2 2v1.6h8.8V8.6H7.6Zm0 3.4v1.6h8.8V12H7.6Zm0 3.4v1.2h5.6v-1.2H7.6Z" />
        </>
    ),
    // Chevron with a return foot — back / undo.
    "caret-back": (
        <>
            <path d="m9.4 5.6 1.7 1.7-3.5 3.5h7a5.4 5.4 0 0 1 0 10.8h-3.2v-2.4h3.2a3 3 0 0 0 0-6h-7l3.5 3.5-1.7 1.7L3.8 12l5.6-6.4Z" />
        </>
    ),

    // ── Status modifiers ────────────────────────────────────────────────────
    // Double chevron up on a baseline — direction AND fill carry the sign.
    wax: (
        <>
            <path d="m12 2.6 6.6 7.2h-13.2L12 2.6Z" />
            <path opacity=".7" d="m12 10.2 6.6 7.2h-13.2L12 10.2Z" />
            <path opacity=".85" d="M4.4 19.2h15.2v2.4H4.4z" />
        </>
    ),
    wane: (
        <>
            <path d="m12 21.4-6.6-7.2h13.2L12 21.4Z" />
            <path opacity=".7" d="m12 13.8-6.6-7.2h13.2L12 13.8Z" />
            <path opacity=".85" d="M4.4 2.4h15.2v2.4H4.4z" />
        </>
    ),
    // An anchor — immovable. The post-and-ticks version read as a grave marker.
    steadfast: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 1.4a3.3 3.3 0 0 1 1.3 6.3v1.5h3.1v2.6h-3.1v8.4c2.5-.5 4.4-2.6 4.7-5.2h-2.1l3.5-4.4 3.5 4.4h-2.2A8.9 8.9 0 0 1 12 22.6a8.9 8.9 0 0 1-8.7-7.6H1.1l3.5-4.4 3.5 4.4H6a6.3 6.3 0 0 0 4.7 5.2v-8.4H7.6V9.2h3.1V7.7A3.3 3.3 0 0 1 12 1.4Zm0 2.6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Z" />
        </>
    ),
    // Three swept speed lines.
    haste: (
        <>
            <path d="M4.4 5.2h15.2l-3.6 4H.8l3.6-4Z" />
            <path opacity=".72" d="M7.4 11h13.8l-3.6 4H3.8l3.6-4Z" />
            <path opacity=".45" d="M10.4 16.8h10.8l-3.6 4H6.8l3.6-4Z" />
        </>
    ),

    // ── HUD chrome ──────────────────────────────────────────────────────────
    // A kunai in profile, tip right — the mode's selection caret.
    cursor: (
        <>
            <path d="m22 12-9.4 5.2V6.8L22 12Z" />
            <path opacity=".72" d="M5.4 9.4h7.6v5.2H5.4z" />
            <path fillRule="evenodd" clipRule="evenodd" opacity=".55" d="M4 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm0 2.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z" />
        </>
    ),
    fast: (
        <>
            <path d="M2.6 4.8 12 12l-9.4 7.2V4.8Z" />
            <path opacity=".7" d="M12 4.8 21.4 12 12 19.2V4.8Z" />
        </>
    ),
    "sound-on": (
        <>
            <path d="M11.4 3.4v17.2l-5-4.2H2.6V7.6h3.8l5-4.2Z" />
            <path opacity=".72" d="M14.4 8.2a5 5 0 0 1 0 7.6l-1.5-1.8a2.7 2.7 0 0 0 0-4l1.5-1.8Z" />
            <path opacity=".45" d="M17.6 4.8a9.6 9.6 0 0 1 0 14.4l-1.5-1.8a7.3 7.3 0 0 0 0-10.8l1.5-1.8Z" />
        </>
    ),
    // Same cone and bounding box as sound-on, so the chip never reflows.
    "sound-off": (
        <>
            <path d="M11.4 3.4v17.2l-5-4.2H2.6V7.6h3.8l5-4.2Z" />
            <path opacity=".82" d="m14.8 8.6 6.6 6.6-1.7 1.7-6.6-6.6 1.7-1.7Z" />
            <path opacity=".82" d="m21.4 8.6-6.6 6.6-1.7-1.7 6.6-6.6 1.7 1.7Z" />
        </>
    ),
    // A lowered pennant on a staff.
    flag: (
        <>
            <path d="M4.6 2.4h2.4v19.2H4.6z" />
            <path opacity=".82" d="M7.8 3.6h11.6l-2.6 4 2.6 4H7.8v-8Z" />
        </>
    ),
    // A broken ring with a fracture through it.
    "ko-stamp": (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 1.8a10.2 10.2 0 1 1 0 20.4 10.2 10.2 0 0 1 0-20.4Zm0 2.6a7.6 7.6 0 1 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z" />
            <path d="m6.9 18.6 11.7-13 1.9 1.7-11.7 13-1.9-1.7Z" />
        </>
    ),
    // Stood down — a pause mark in a framed socket. "Sheathed blade" was too
    // oblique at 14px; this is the one idea a player reads instantly.
    bench: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M4.4 3.4h15.2a1.8 1.8 0 0 1 1.8 1.8v13.6a1.8 1.8 0 0 1-1.8 1.8H4.4a1.8 1.8 0 0 1-1.8-1.8V5.2a1.8 1.8 0 0 1 1.8-1.8Zm.6 2.4v12.4h14V5.8H5Z" />
            <path opacity=".85" d="M8.2 7.8h2.6v8.4H8.2zM13.2 7.8h2.6v8.4h-2.6z" />
        </>
    ),
    // A bound X of two crossed links — the action is taken from you.
    "action-lost": (
        <>
            <path d="m5.4 3.7 14.9 14.9-2.4 2.4L3 6.1l2.4-2.4Z" />
            <path opacity=".62" d="M20.3 6.1 5.4 21 3 18.6 17.9 3.7l2.4 2.4Z" />
        </>
    ),
    // A scalloped fog band — intent concealed, not "unknown data".
    veiled: (
        <>
            <path opacity=".85" d="M2 8.4c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6v3.2c-1.6 0-1.6 1.6-3.2 1.6s-1.6-1.6-3.2-1.6-1.6 1.6-3.2 1.6-1.6-1.6-3.2-1.6-1.6 1.6-3.2 1.6S3.6 11.6 2 11.6V8.4Z" />
            <path opacity=".5" d="M2 14.2c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6v3.2c-1.6 0-1.6 1.6-3.2 1.6s-1.6-1.6-3.2-1.6-1.6 1.6-3.2 1.6-1.6-1.6-3.2-1.6-1.6 1.6-3.2 1.6S3.6 17.4 2 17.4v-3.2Z" />
        </>
    ),
    mvp: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 8.6a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4Zm0 2.6a4.1 4.1 0 1 1 0 8.2 4.1 4.1 0 0 1 0-8.2Z" />
            <path opacity=".72" d="M6.4 1.6h4l2.2 6.4-3.7 1.5L6.4 1.6ZM17.6 1.6h-4l-2.2 6.4 3.7 1.5 2.5-7.9Z" />
            <path opacity=".55" d="m12 12.4.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3.9-1.9Z" />
        </>
    ),
    // A heart cut to a shield-ish silhouette — reads as vitality at 14px.
    hp: (
        <>
            <path d="M12 21.2 4.3 13.9A5.1 5.1 0 0 1 12 7.2a5.1 5.1 0 0 1 7.7 6.7L12 21.2Z" />
            <path opacity=".42" d="M12 7.2a5.1 5.1 0 0 0-7.7 6.7l3.6 3.4A5.1 5.1 0 0 1 12 7.2Z" />
        </>
    ),
    // A charged cell — the stamina pool.
    stamina: (
        <>
            <path fillRule="evenodd" clipRule="evenodd" d="M5.4 4.4h13.2v15.2H5.4V4.4Zm2.4 2.4v10.4h8.4V6.8H7.8Z" />
            <path d="M9.6 2h4.8v2.4H9.6z" />
            <path opacity=".72" d="M12.9 7.8 9.2 13.4h2.4l-.5 3.6 3.7-5.6h-2.4l.5-3.6Z" />
        </>
    ),
};

export function ShowdownIcon({ name, size = 18, title, className, style }: {
    name: ShowdownIconName;
    size?: number;
    /** Supply only when the glyph is the sole carrier of meaning. */
    title?: string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            focusable="false"
            aria-hidden={title ? undefined : true}
            role={title ? "img" : undefined}
            className={className}
            style={style}
        >
            {title && <title>{title}</title>}
            {PATHS[name]}
        </svg>
    );
}
