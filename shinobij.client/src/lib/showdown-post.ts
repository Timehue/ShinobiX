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

import { Effect, EffectAttribute } from "postprocessing";
import { Uniform, type Vector2 } from "three";

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

// Compact edge-aware antialiasing for the conditional Showdown composer.
// This deliberately uses the Effect pipeline's built-in texelSize instead of
// importing postprocessing's full FXAA implementation and shader preset table.
const EDGE_AA_FRAGMENT = /* glsl */ `
float edgeLuma(const in vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 north = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
    vec3 south = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
    vec3 west = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
    vec3 east = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
    float centerLuma = edgeLuma(inputColor.rgb);
    float northLuma = edgeLuma(north);
    float southLuma = edgeLuma(south);
    float westLuma = edgeLuma(west);
    float eastLuma = edgeLuma(east);
    float lowest = min(centerLuma, min(min(northLuma, southLuma), min(westLuma, eastLuma)));
    float highest = max(centerLuma, max(max(northLuma, southLuma), max(westLuma, eastLuma)));
    float range = highest - lowest;
    if (range < max(0.0312, highest * 0.125)) {
        outputColor = inputColor;
        return;
    }
    vec2 direction = vec2(westLuma - eastLuma, northLuma - southLuma);
    direction /= max(abs(direction.x) + abs(direction.y), 0.0001);
    vec2 offset = direction * texelSize * 0.5;
    vec4 smoothed = 0.5 * (
        texture2D(inputBuffer, uv - offset) +
        texture2D(inputBuffer, uv + offset)
    );
    outputColor = mix(inputColor, smoothed, clamp(range * 4.0, 0.0, 0.75));
}
`;

// The Showdown stack only uses ChromaticAberrationEffect's non-radial mode.
// Keep that exact sampling behavior without shipping the unused radial branch,
// option plumbing, and accessors from the general-purpose implementation.
const CHROMATIC_FRAGMENT = /* glsl */ `
varying float vActive;
varying vec2 vUvR;
varying vec2 vUvB;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 ra = inputColor.ra;
    vec2 ba = inputColor.ba;
    if (vActive > 0.0) {
        ra = texture2D(inputBuffer, vUvR).ra;
        ba = texture2D(inputBuffer, vUvB).ba;
    }
    outputColor = vec4(ra.x, inputColor.g, ba.x, max(max(ra.y, ba.y), inputColor.a));
}
`;

const CHROMATIC_VERTEX = /* glsl */ `
uniform vec2 offset;
varying float vActive;
varying vec2 vUvR;
varying vec2 vUvB;
void mainSupport(const in vec2 uv) {
    vec2 shift = offset * vec2(1.0, aspect);
    vActive = (shift.x != 0.0 || shift.y != 0.0) ? 1.0 : 0.0;
    vUvR = uv + shift;
    vUvB = uv - shift;
}
`;

export class ShowdownChromaticEffect extends Effect {
    readonly offset: Vector2;

    constructor(offset: Vector2) {
        super("ShowdownChromatic", CHROMATIC_FRAGMENT, {
            vertexShader: CHROMATIC_VERTEX,
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map<string, Uniform>([["offset", new Uniform(offset)]]),
        });
        this.offset = offset;
    }
}

export class ShowdownEdgeAAEffect extends Effect {
    constructor() {
        super("ShowdownEdgeAA", EDGE_AA_FRAGMENT);
    }
}

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
