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

const ZOOM_BLUR_FRAGMENT = /* glsl */ `uniform float strength;void mainImage(const in vec4 c,const in vec2 uv,out vec4 o){if(strength<=0.001){o=c;return;}vec2 d=vec2(0.5,0.46)-uv;vec4 s=c;for(int i=1;i<=8;i++)s+=texture2D(inputBuffer,uv+d*strength*float(i)/8.0);o=s/9.0;}`;

// Compact edge-aware antialiasing for the conditional Showdown composer.
// This deliberately uses the Effect pipeline's built-in texelSize instead of
// importing postprocessing's full FXAA implementation and shader preset table.
const EDGE_AA_FRAGMENT = /* glsl */ `float l(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}void mainImage(const in vec4 c,const in vec2 uv,out vec4 o){float m=l(c.rgb),n=l(texture2D(inputBuffer,uv-vec2(0.0,texelSize.y)).rgb),s=l(texture2D(inputBuffer,uv+vec2(0.0,texelSize.y)).rgb),w=l(texture2D(inputBuffer,uv-vec2(texelSize.x,0.0)).rgb),e=l(texture2D(inputBuffer,uv+vec2(texelSize.x,0.0)).rgb);float lo=min(m,min(min(n,s),min(w,e))),hi=max(m,max(max(n,s),max(w,e))),r=hi-lo;if(r<max(0.0312,hi*0.125)){o=c;return;}vec2 d=vec2(w-e,n-s);d/=max(abs(d.x)+abs(d.y),0.0001);vec2 q=d*texelSize*0.5;vec4 a=0.5*(texture2D(inputBuffer,uv-q)+texture2D(inputBuffer,uv+q));o=mix(c,a,clamp(r*4.0,0.0,0.75));}`;

// The Showdown stack only uses ChromaticAberrationEffect's non-radial mode.
// Keep that exact sampling behavior without shipping the unused radial branch,
// option plumbing, and accessors from the general-purpose implementation.
const CHROMATIC_FRAGMENT = /* glsl */ `uniform vec2 offset;void mainImage(const in vec4 c,const in vec2 uv,out vec4 o){vec2 s=offset*vec2(1.0,aspect);vec2 r=texture2D(inputBuffer,uv+s).ra,b=texture2D(inputBuffer,uv-s).ba;o=vec4(r.x,c.g,b.x,max(max(r.y,b.y),c.a));}`;

export class ShowdownChromaticEffect extends Effect {
    readonly offset: Vector2;

    constructor(offset: Vector2) {
        super("CA", CHROMATIC_FRAGMENT, {
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map<string, Uniform>([["offset", new Uniform(offset)]]),
        });
        this.offset = offset;
    }
}

export class ShowdownEdgeAAEffect extends Effect {
    constructor() {
        super("AA", EDGE_AA_FRAGMENT);
    }
}

export class ZoomBlurEffect extends Effect {
    constructor() {
        super("ZB", ZOOM_BLUR_FRAGMENT, {
            uniforms: new Map<string, Uniform>([["strength", new Uniform(0)]]),
        });
    }

    /** 0 = pass-through; ~0.08 = a hard strike rush. */
    setStrength(value: number): void {
        this.uniforms.get("strength")!.value = value;
    }
}
