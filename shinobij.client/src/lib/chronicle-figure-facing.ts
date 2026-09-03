/** Inherent horizontal facing of each cut-out creature figure
 * (public/chronicle/figures/<id>.webp), recorded by eye from the art:
 * "L" looks screen-left, "R" screen-right, "F" frontal/symmetric.
 * Drives the board's mirror rule so summoned figures always lean into
 * the center of the battle instead of gazing off the stage. A figure
 * missing from this map is treated as frontal (never mirrored). */
export type FigureFacing = "L" | "R" | "F";

export const FIGURE_FACING: Readonly<Record<string, FigureFacing>> = {
    "tc-01": "F", "tc-02": "L", "tc-03": "L", "tc-04": "L", "tc-05": "L",
    "tc-06": "F", "tc-07": "L", "tc-08": "L", "tc-09": "F", "tc-103": "F",
    "tc-104": "F", "tc-106": "L", "tc-108": "F", "tc-11": "L", "tc-110": "F",
    "tc-114": "F", "tc-117": "F", "tc-119": "F", "tc-12": "L", "tc-120": "L",
    "tc-121": "L",
    "tc-124": "L", "tc-126": "F", "tc-128": "F", "tc-129": "F", "tc-13": "F",
    "tc-130": "F", "tc-135": "L", "tc-15": "F", "tc-16": "L", "tc-17": "F",
    "tc-19": "F", "tc-21": "R", "tc-23": "F", "tc-26": "F", "tc-27": "L",
    "tc-30": "F", "tc-31": "L", "tc-32": "F", "tc-33": "F", "tc-36": "L",
    "tc-37": "L", "tc-38": "F", "tc-42": "F", "tc-43": "F", "tc-44": "L",
    "tc-45": "F", "tc-47": "F", "tc-50": "F", "tc-51": "L", "tc-52": "F",
    "tc-54": "L", "tc-56": "F", "tc-57": "L", "tc-58": "F", "tc-61": "F",
    "tc-63": "L", "tc-67": "F", "tc-70": "L", "tc-72": "F", "tc-76": "F",
    "tc-77": "L", "tc-81": "F", "tc-86": "F", "tc-87": "L", "tc-96": "F",
    "tc-97": "L", "tc-99": "F",
};

/** Mirror decision: zones left of center want the figure facing right,
 * zones right of center want it facing left, the middle zone and all
 * frontal figures stay as painted. */
export function figureFlip(cardId: string, zoneIndex: number): boolean {
    const facing = FIGURE_FACING[cardId];
    if (!facing || facing === "F" || zoneIndex === 2) return false;
    const want: FigureFacing = zoneIndex < 2 ? "R" : "L";
    return facing !== want;
}
