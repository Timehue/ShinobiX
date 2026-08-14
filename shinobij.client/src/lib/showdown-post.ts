/*
 * showdown-post — custom post-processing for Pet Showdown.
 *
 * ZoomBlurEffect: an 8-tap radial ("zoom") blur from the frame center,
 * pulsed for a few frames at super strikes — the reference games sell big
 * contacts with exactly this camera-rush. Strength is driven per-frame
 * through the effect's uniform by the battle's PostDriver; zero at rest, so
 * the pass costs almost nothing outside the pulse.
 *
 * Desktop-gated alongside Bloom (petBloomEnabled) and skipped entirely under
 * reduced motion, same as every other flourish.
 */

import { Effect } from "postprocessing";
import { Uniform } from "three";

const ZOOM_BLUR_FRAGMENT = /* glsl */ `
uniform float strength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (strength <= 0.001) {
        outputColor = inputColor;
        return;
    }
    vec2 center = vec2(0.5, 0.46);
    vec2 toCenter = center - uv;
    vec4 sum = inputColor;
    // 8 taps marching toward the center, weighted evenly — cheap and soft.
    for (int i = 1; i <= 8; i++) {
        float k = strength * float(i) / 8.0;
        sum += texture2D(inputBuffer, uv + toCenter * k);
    }
    outputColor = sum / 9.0;
}
`;

export class ZoomBlurEffect extends Effect {
    constructor() {
        super("ShowdownZoomBlur", ZOOM_BLUR_FRAGMENT, {
            uniforms: new Map<string, Uniform>([["strength", new Uniform(0)]]),
        });
    }

    /** 0 = pass-through; ~0.08 = a hard strike rush. */
    setStrength(value: number): void {
        const u = this.uniforms.get("strength");
        if (u) u.value = value;
    }
}
