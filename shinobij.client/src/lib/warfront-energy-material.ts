import { DoubleSide, MeshBasicMaterial, type IUniform } from "three";

/** Soft, directional elemental surfaces for the fixed Warfront instance pools.
 * Local -Y leads the projectile; every surface is feathered before the quad
 * boundary. The caller supplies simulation time, including pause and rewind. */
export function warfrontEnergyMaterial(kind: number): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ transparent: true,
        side: DoubleSide, depthWrite: false, toneMapped: false });
    material.defines = { USE_UV: "" };
    material.userData.replayTime = { value: 0 } satisfies IUniform<number>;
    material.customProgramCacheKey = () => `wfe-${kind}`;
    material.onBeforeCompile = shader => {
        shader.uniforms.wt = material.userData.replayTime;
        shader.vertexShader = `varying float wf;\n${shader.vertexShader}`.replace("#include <project_vertex>", `#include <project_vertex>
vec3 wn=normal;
#ifdef USE_INSTANCING
wn=mat3(instanceMatrix)*wn;
#endif
wf=abs(dot(normalize(normalMatrix*wn),normalize(-mvPosition.xyz)));`);
        shader.fragmentShader = `varying float wf;uniform float wt;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `
#include <color_fragment>
vec2 q=vUv-.5;float t=wt;float n=sin(q.x*31.+sin(q.y*19.-t*7.))*sin(q.y*27.-t*11.);float a=0.;float h=0.;float e=1.-smoothstep(.39,.5,max(abs(q.x),abs(q.y)));
${kind === 0 ? `
float w=.09+.22*(.5-q.y);float p=1.-smoothstep(w*.2,w,abs(q.x+n*.045*(q.y+.5)));a=p*(1.-smoothstep(.2,.5,q.y+n*.09))*smoothstep(-.5,-.24,q.y);h=pow(max(0.,1.-length(vec2(q.x*4.,(q.y+.17)*3.))),2.);
` : kind === 1 ? `
float d=length(vec2(q.x*1.5,q.y+.1));float f=sin(q.y*32.+q.x*12.-t*12.);a=(1.-smoothstep(.12,.35,d))*(.78+.22*f);h=pow(max(0.,1.-d*4.),3.)+.28*pow(max(0.,f),8.);
` : kind === 2 ? `
float b=.19*sin(q.y*5.+t*2.);float s=abs(q.x-b);a=(1.-smoothstep(.015,.065,s))*.8;a+=(1.-smoothstep(.012,.04,abs(q.x+b+.14)))*.45;a*=1.-smoothstep(.2,.48,abs(q.y));h=.35;
` : kind === 3 ? `
float s=abs(q.x)*1.8+abs(q.y+.04)*.8;a=1.-smoothstep(.27,.3,s);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.36,.27,.16),.65)*(.75+q.x*.9+n*.1);h=0.;
` : kind === 4 ? `
float j=.07*sin(q.y*41.+floor(t*12.))+.035*sin(q.y*79.);float d=abs(q.x-j);a=exp(-d*25.)*(1.-smoothstep(.28,.49,abs(q.y)));h=exp(-d*100.);
` : `
float d=length(q);a=exp(-d*d*24.)*(1.-smoothstep(.3,.49,d));
`}
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.,.96,.84),clamp(h,0.,.9));diffuseColor.a*=clamp(a,0.,1.)*e*smoothstep(.05,.7,wf);if(diffuseColor.a<.008)discard;
`);
    };
    return material;
}
