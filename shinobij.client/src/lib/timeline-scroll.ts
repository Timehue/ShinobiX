/*
 * Scroll arithmetic for the battle action timeline.
 *
 * Extracted from the component deliberately. These two decisions are the ones
 * that go wrong in a horizontal, prepend-growing, auto-following strip, and
 * they are impossible to test through a DOM double: jsdom has no layout engine,
 * so scrollWidth/clientWidth are permanently 0 and any assertion about them is
 * vacuous. As plain arithmetic they are exactly testable.
 *
 * Both functions are pure; the component owns the DOM reads and writes.
 */

/** A horizontal scroller's geometry at one moment. */
export interface ScrollGeometry {
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
}

/**
 * Is the viewer parked at the newest end of the strip?
 *
 * Only true when they are within `slack` of the right edge. This gates
 * auto-scroll: yanking the strip away from someone reading round 2 because a
 * new action arrived is worse than making them scroll for it.
 *
 * `slack` absorbs sub-pixel layout and momentum-scroll overshoot, which
 * otherwise make an at-the-end reader look scrolled away by a fraction of a
 * pixel and silently disable following.
 */
export function isFollowingEnd(geo: ScrollGeometry, slack = 24): boolean {
    const { scrollLeft, scrollWidth, clientWidth } = geo;
    // A strip that does not overflow is trivially "at the end".
    if (scrollWidth <= clientWidth) return true;
    return scrollLeft + clientWidth >= scrollWidth - slack;
}

/**
 * Where to put scrollLeft after OLDER entries were prepended.
 *
 * Prepending shifts every existing node right by however much the content grew.
 * The browser preserves scrollLeft, so without correction the strip appears to
 * jump backwards in time — the action the reader was looking at slides off to
 * the right. Re-anchoring by the growth keeps the same content under the
 * viewport, which is the whole point of "load older".
 *
 * Returns the ORIGINAL scrollLeft when the content did not grow (a no-op page,
 * or a re-render that changed nothing), so a spurious call cannot nudge it.
 */
export function scrollLeftAfterPrepend(
    before: { scrollWidth: number; scrollLeft: number },
    afterScrollWidth: number,
): number {
    const grew = afterScrollWidth - before.scrollWidth;
    if (grew <= 0) return before.scrollLeft;
    return before.scrollLeft + grew;
}
