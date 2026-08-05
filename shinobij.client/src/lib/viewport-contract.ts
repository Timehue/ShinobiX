export const VIEWPORT_BREAKPOINTS = {
    sm: 560,
    md: 980,
    lg: 1180,
    xl: 1400,
    xxl: 2200,
} as const;

export const VIEWPORT_CLASSES = ["xs", "sm", "md", "lg", "xl", "xxl"] as const;

export type ViewportClass = (typeof VIEWPORT_CLASSES)[number];

/**
 * The single JavaScript mirror of the CSS shell breakpoints.
 *
 * Normal components should reflow with CSS/container queries. This classifier
 * exists for the root compatibility attribute and the few specialized surfaces
 * that need to coordinate with the application shell.
 */
export function viewportClassForWidth(width: number): ViewportClass {
    if (width < VIEWPORT_BREAKPOINTS.sm) return "xs";
    if (width < VIEWPORT_BREAKPOINTS.md) return "sm";
    if (width < VIEWPORT_BREAKPOINTS.lg) return "md";
    if (width < VIEWPORT_BREAKPOINTS.xl) return "lg";
    if (width < VIEWPORT_BREAKPOINTS.xxl) return "xl";
    return "xxl";
}
