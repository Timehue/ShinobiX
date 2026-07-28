export type DuelCameraComposition = Readonly<{
    fov: number;
    pullBack: number;
    elevation: number;
    cinematicScale: number;
    maxPushIn: number;
    maxPullBack: number;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * One responsive policy for both the lens and physical camera. The old portrait
 * path widened to 60 degrees and pulled back more than twelve world units at the
 * same time, reducing a fighter to a tiny fraction of screen height. This curve
 * keeps enough horizontal room for two silhouettes without losing their scale.
 */
export function duelCameraComposition(aspectInput: number): DuelCameraComposition {
    const aspect = Number.isFinite(aspectInput) && aspectInput > 0 ? aspectInput : 16 / 9;
    const narrow = clamp01((0.8 - aspect) / 0.34);
    const tablet = clamp01((1.2 - aspect) / 0.4);
    return Object.freeze({
        // Portrait needs a little more horizontal field for long bodies (Selkie,
        // dragons) than the first 55-degree pass allowed. Physical pullback stays
        // capped, so the added four degrees do not return to the tiny-diorama look.
        fov: lerp(38, 47, tablet) + narrow * 12,
        pullBack: narrow * 5.2,
        elevation: narrow * 0.8,
        cinematicScale: lerp(1, 0.5, narrow),
        maxPushIn: lerp(0.88, 0.52, narrow),
        maxPullBack: lerp(4.2, 2.5, narrow),
    });
}
