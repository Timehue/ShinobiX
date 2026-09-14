/*
 * showdown-post — compact native-Three post-processing for Pet Showdown.
 *
 * ZoomBlurEffect: an 8-tap radial ("zoom") blur from the frame center,
 * pulsed for a few frames at super strikes — the reference games sell big
 * contacts with exactly this camera-rush. Strength is driven per-frame
 * through the effect's uniform by the battle's PostDriver; zero at rest, so
 * the pass costs almost nothing outside the pulse.
 *
 * Desktop-gated alongside Bloom (petBloomEnabled) and skipped entirely under
 * reduced motion, same as every other flourish. This shader intentionally runs
 * through Three's own ShaderPass so the Coliseum does not ship a second,
 * general-purpose postprocessing runtime just for three small lens accents.
 */

import { Vector2 } from "three";

const SHOWDOWN_POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 offset;
uniform float strength;
uniform float glowThreshold;
uniform float glowIntensity;
varying vec2 vUv;

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 glow(vec2 p) {
    vec3 c = texture2D(tDiffuse, p).rgb;
    return c * smoothstep(glowThreshold, 1.0, luma(c));
}

void main() {
    vec2 px = 1.0 / max(resolution, vec2(1.0));
    vec4 color = texture2D(tDiffuse, vUv);
    if (strength > 0.001) {
        vec2 ray = vec2(0.5, 0.46) - vUv;
        vec4 sum = color;
        for (int i = 1; i <= 6; i++) sum += texture2D(tDiffuse, vUv + ray * strength * float(i) / 6.0);
        color = sum / 7.0;
    }
    vec2 step = px * 3.25;
    color.rgb += glowIntensity * (
        glow(vUv + vec2(step.x, 0.0)) + glow(vUv - vec2(step.x, 0.0)) +
        glow(vUv + vec2(0.0, step.y)) + glow(vUv - vec2(0.0, step.y))
    );
    vec4 north = texture2D(tDiffuse, vUv - vec2(0.0, px.y));
    vec4 south = texture2D(tDiffuse, vUv + vec2(0.0, px.y));
    vec4 west = texture2D(tDiffuse, vUv - vec2(px.x, 0.0));
    vec4 east = texture2D(tDiffuse, vUv + vec2(px.x, 0.0));
    float edge = abs(luma(north.rgb) - luma(south.rgb)) + abs(luma(west.rgb) - luma(east.rgb));
    color = mix(color, 0.25 * (north + south + west + east), clamp((edge - 0.06) * 3.0, 0.0, 0.72));

    // Offset is measured in pixels so high-DPR displays do not magnify it.
    // Keep the subject sharp; a faint fringe lives only at the frame edges.
    float fringe = smoothstep(0.18, 0.65, length(vUv - vec2(0.5, 0.46)));
    vec2 shift = offset * px * fringe;
    vec4 redSample = texture2D(tDiffuse, vUv + shift);
    vec4 blueSample = texture2D(tDiffuse, vUv - shift);
    vec3 base = texture2D(tDiffuse, vUv).rgb;
    // Preserve the processed RGB. Replacing R/B with raw samples applied the
    // glow/blur to green alone and produced colored ghosts around every edge.
    color.rgb += vec3(redSample.r - base.r, 0.0, blueSample.b - base.b);
    gl_FragColor = vec4(max(color.rgb, vec3(0.0)), color.a);
}
`;

const SHOWDOWN_POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHOWDOWN_POST_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(1, 1) },
        offset: { value: new Vector2(0, 0) },
        strength: { value: 0 },
        glowThreshold: { value: 0.88 },
        glowIntensity: { value: 0.12 },
    },
    vertexShader: SHOWDOWN_POST_VERTEX,
    fragmentShader: SHOWDOWN_POST_FRAGMENT,
};
