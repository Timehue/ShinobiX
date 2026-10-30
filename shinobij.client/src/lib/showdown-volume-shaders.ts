/*
 * showdown-volume-shaders — procedural surface shaders for the Pet Showdown
 * volumetric set-pieces.
 *
 * The sprite/billboard construction hit its ceiling: a texture on a plane has
 * edges, and up close it reads as a pane of glass (owner: "is this the best we
 * can do?"). These materials COMPUTE their surfaces instead — fbm-noise flames
 * that lick and erode, water with analytic feathering and living foam, vortex
 * bands that dissolve into turbulence — so there is no rectangle to catch and
 * no frame-stepping to see.
 *
 * Discipline: every material exposes plain uniforms (uTime/uOpacity/...)
 * mutated ONLY through refs inside useFrame; uTime is fed the PIECE-relative
 * clock, never a wall clock, so replays and fast-forward render identically.
 */

import * as THREE from "three";

/** Shared GLSL: hash → value noise → 4-octave fbm. Cheap and sufficient for
 *  stylized surfaces; simplex would be overkill at these scales. */
const NOISE_GLSL = /* glsl */ `
float sH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}float sN(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(sH(i),sH(i+vec2(1.,0.)),f.x),mix(sH(i+vec2(0.,1.)),sH(i+vec2(1.,1.)),f.x),f.y);}float sF(vec2 p){float v=0.;float a=0.5;for(int i=0;i<4;i++){v+=a*sN(p);p*=2.03;a*=0.5;}return v;}
`;

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
`;

/** Living flame card: body mask eroded by upward-scrolling fbm, black-body
 *  color ramp with a white-hot core. The flame SHAPE moves — no frames. */
// Wide rooted base, top eroded by noise — the classic licking silhouette.
const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;uniform float uSeed;uniform vec3 uTint;uniform float uOpacity;varying vec2 vUv;${NOISE_GLSL}void main(){vec2 uv=vUv;float n=sF(vec2(uv.x*3.1+uSeed,uv.y*2.3-uTime*2.7));float n2=sF(vec2(uv.x*6.7-uSeed*2.,uv.y*4.6-uTime*4.2));float body=smoothstep(0.,0.14,uv.y)*(1.-smoothstep(0.42+n*0.55,1.,uv.y));float side=smoothstep(0.,0.16+n2*0.12,uv.x)*smoothstep(0.,0.16+n*0.12,1.-uv.x);float a=body*side*smoothstep(0.22,0.6,n*0.55+n2*0.55);float core=smoothstep(0.5,0.95,a+n2*0.35)*(1.-smoothstep(0.2,0.75,uv.y));vec3 col=mix(vec3(0.72,0.13,0.03),vec3(1.,0.52,0.1),clamp(a*1.6,0.,1.));col=mix(col,vec3(1.,0.94,0.66),core);col*=uTint;gl_FragColor=vec4(col,a*uOpacity);if(gl_FragColor.a<0.01)discard;}
`;

/** Water shell: deep base → aqua ramp along the climb, scrolling flow
 *  streaks, boiling foam at the crest, and ANALYTIC feathering on every
 *  edge — the plane's rectangle can never show. */
// uv.x climbs the curl (base -> crest); uv.y spans the lane width.
// Streaks riding the climb.
// Foam boils at the crest and flecks below it.
// Analytic feathering: width edges, crest end, base end.
const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;uniform float uSeed;uniform vec3 uTint;uniform float uOpacity;varying vec2 vUv;${NOISE_GLSL}void main(){vec2 uv=vUv;float flow=sF(vec2(uv.x*4.-uTime*2.1+uSeed,uv.y*5.5));float flow2=sF(vec2(uv.x*9.-uTime*3.4,uv.y*11.+uSeed));vec3 deep=vec3(0.03,0.2,0.33);vec3 mid=vec3(0.09,0.43,0.58);vec3 aqua=vec3(0.36,0.77,0.86);vec3 col=mix(deep,mid,smoothstep(0.,0.55,uv.x));col=mix(col,aqua,smoothstep(0.45,0.85,uv.x)*(0.5+flow*0.5));col+=vec3(0.10,0.16,0.18)*smoothstep(0.55,0.95,flow2)*smoothstep(0.1,0.6,uv.x);float foam=smoothstep(0.68,0.9,uv.x+(flow2-0.5)*0.22);foam=max(foam,smoothstep(0.72,0.98,flow2)*smoothstep(0.35,0.8,uv.x));col=mix(col,vec3(0.94,0.99,1.),clamp(foam,0.,1.));float a=smoothstep(0.,0.13,uv.y)*smoothstep(0.,0.13,1.-uv.y);a*=smoothstep(0.,0.07,uv.x)*(1.-smoothstep(0.9,1.,uv.x+(flow-0.5)*0.12));a*=0.88+foam*0.12;col*=uTint;gl_FragColor=vec4(col,a*uOpacity);if(gl_FragColor.a<0.01)discard;}
`;

/** Vortex band shader: diagonal wind bands climbing the funnel, eroded by
 *  fbm so they shred into air at both rims. */
// Bands spiral: around the cone (x) + climb (y), scrolling with time.
// The funnel mouth and skirt shred into nothing.
const VORTEX_FRAGMENT = /* glsl */ `
uniform float uTime;uniform float uSeed;uniform vec3 uTint;uniform float uOpacity;varying vec2 vUv;${NOISE_GLSL}void main(){vec2 uv=vUv;float band=sin((uv.x*6.+uv.y*9.-uTime*5.2+uSeed)*3.14159);band=smoothstep(0.15,0.95,band*0.5+0.5);float turb=sF(vec2(uv.x*5.+uTime*0.9,uv.y*6.-uTime*2.6));float a=band*smoothstep(0.28,0.72,turb+band*0.25);a*=smoothstep(0.,0.22,uv.y)*smoothstep(0.,0.24,1.-uv.y);vec3 col=mix(vec3(0.78,0.93,0.87),vec3(1.,1.,1.),band*0.6)*uTint;gl_FragColor=vec4(col,a*uOpacity);if(gl_FragColor.a<0.01)discard;}
`;

export type VolumeShaderKind = "flame" | "water" | "vortex";

const FRAGMENTS: Record<VolumeShaderKind, string> = {
    flame: FLAME_FRAGMENT,
    water: WATER_FRAGMENT,
    vortex: VORTEX_FRAGMENT,
};

/** Build one volume material. Callers own it (dispose on unmount) and drive
 *  uTime/uOpacity through refs each frame. */
export function makeVolumeMaterial(kind: VolumeShaderKind, opts: { seed?: number; tint?: string; additive?: boolean } = {}): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: FRAGMENTS[kind],
        uniforms: {
            uTime: { value: 0 },
            uSeed: { value: opts.seed ?? 0 },
            uTint: { value: new THREE.Color(opts.tint ?? "#ffffff") },
            uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
    } as THREE.ShaderMaterialParameters & { toneMapped: boolean });
}
