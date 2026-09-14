import * as THREE from 'three';

const VERTEX = `uniform float uElement,uStyle,uTime; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
void main(){ vUv=uv; vec3 shape=position;
 if(uStyle<.5 && uElement>.5 && uElement<1.5)shape.xz*=mix(.19,.30,uv.y)/mix(.17,.8,uv.y);
 if(uStyle<.5 && uElement<.5)shape.xz*=1.+.13*sin(uv.y*26.-uTime*18.+uv.x*6.283);
 vec4 p=modelViewMatrix*vec4(shape,1.); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`;
const FRAGMENT = `uniform float uTime,uOpacity,uElement,uStyle; uniform vec3 uTint;
varying vec2 vUv; varying vec3 vNormal,vView;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){
 vec2 p=vUv; float n=noise(vec2(p.x*12.,p.y*7.-uTime*6.));
 float f=n*.65+noise(vec2(p.x*25.,p.y*16.-uTime*10.))*.35;
 float edge=smoothstep(0.,.07,p.y)*(1.-smoothstep(.82,1.,p.y));
 float facing=smoothstep(.0,.32,abs(dot(normalize(vNormal),normalize(vView))));
 vec3 col=uTint; float a=.8;
 if(uElement<.5){
   float hot=smoothstep(.28,.9,f)*(1.-p.y*.6);
   col=mix(vec3(.62,.045,.008),vec3(1.,.32,.025),f);
   col=mix(col,vec3(1.,.87,.32),hot*.8);
   a=smoothstep(.18,.68,f+(.8-p.y)*.3);
 }else if(uElement<1.5){
   float flow=pow(.5+.5*sin(p.x*44.+p.y*24.-uTime*18.+n*3.),5.);
   col=mix(vec3(.015,.17,.4),vec3(.11,.65,.85),f);
   col=mix(col,vec3(.8,.96,1.),flow*.78); a=.7+flow*.25;
 }else{
   float band=pow(.5+.5*sin(p.x*30.+p.y*18.-uTime*8.+n),3.);
   a=band*(.45+f*.5); col=mix(uTint,vec3(.85,.97,1.),band*.6);
 }
 if(uStyle>2.5){float swirl=pow(.5+.5*sin(p.x*18.+p.y*17.-uTime*4.+n*2.),6.);a=swirl*smoothstep(.28,.75,f)*.7;col=mix(uTint,vec3(.87,.96,1.),.7);}
 if(uStyle>1.5 && uStyle<2.5){edge=smoothstep(0.,.08,p.x)*smoothstep(0.,.23,1.-p.x);a=.82;col=mix(uTint,vec3(1.),p.y*.55);}
 if(uStyle>1.5&&uStyle<2.5&&uElement>1.5&&uElement<2.5)a*=smoothstep(0.,.28,p.y)*smoothstep(0.,.28,1.-p.y)*(.35+f*.65);
 if(uStyle>.5 && uStyle<1.5){edge=1.; a=.7+f*.25;}
 if(uStyle>3.5){edge=1.;a=pow(abs(dot(normalize(vNormal),normalize(vView))),2.)*.6;col=mix(uTint,vec3(.6,.83,1.),.55);}
 gl_FragColor=vec4(col,a*edge*facing*uOpacity); if(gl_FragColor.a<.008)discard;
}`;

export function surface(style: number) {
    return new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uElement: { value: 0 }, uStyle: { value: style }, uTint: { value: new THREE.Color() } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
}

/** Branches have width in world space and lie on the arena, so the quake
 * reads from oblique/portrait cameras instead of becoming a circular decal. */
export function fissures(widthScale = 1) {
    const vertices: number[] = [];
    const strip = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
        const x = -dz / len * width * widthScale, z = dx / len * width * widthScale;
        vertices.push(a.x+x,0,a.z+z,a.x-x,0,a.z-z,b.x+x,0,b.z+z, b.x+x,0,b.z+z,a.x-x,0,a.z-z,b.x-x,0,b.z-z);
    };
    for (let i = 0; i < 9; i++) {
        let prev = new THREE.Vector3();
        for (let j = 1; j <= 6; j++) {
            const a = i * 2.399 + Math.sin(i * 13 + j * 7) * .15;
            const next = new THREE.Vector3(Math.cos(a) * j * .48, 0, Math.sin(a) * j * .48);
            strip(prev, next, .055 * (1 - j / 9));
            if (j === 3 || j === 5) strip(next, new THREE.Vector3(next.x + Math.cos(a + .8) * .65, 0, next.z + Math.sin(a + .8) * .65), .025);
            prev = next;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
}

export function boltGeometry(branch: number, halo = false) {
    const points = Array.from({ length: 12 }, (_, i) => {
        const t = i / 11;
        const spread = branch ? (1 - t) * 1.8 : 0;
        return new THREE.Vector3(Math.sin(i * 17 + branch * 9) * .3 + spread * Math.cos(branch * 2.1),
            (1 - t) * (branch ? 3.7 : 7), Math.cos(i * 11 + branch * 7) * .23 + spread * Math.sin(branch * 2.1));
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "catmullrom", .01), 44, (branch ? .035 : .065) * (halo ? 3.7 : 1), halo ? 10 : 5, false);
}

/** A widening helix gives wind a continuous, rising silhouette. */
export function vortexRibbon() {
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 96; i++) {
        const t = i / 96, angle = t * Math.PI * 5.5, radius = .35 + t * 1.9;
        const width = Math.sin(t * Math.PI) * .2;
        for (const edge of [-1, 1]) {
            positions.push(Math.cos(angle) * radius, t * 6.4 + edge * width, Math.sin(angle) * radius);
            uv.push(t, (edge + 1) / 2);
        }
        if (i < 96) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
}
