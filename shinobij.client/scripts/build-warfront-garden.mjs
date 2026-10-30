// Authored training garden. The environment and collision props share materials,
// dimensions and a single source; no runtime scatter or procedural allocations.
import { writeFileSync } from 'node:fs';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader ??= class {
    async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
};
let seed = 142857;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const palette = {
    stone: ['#758387', '#869292', '#657579', '#778483'],
    trim: ['#a6aaa0', '#8e9a94'], wood: ['#453b32', '#554637'],
    roof: ['#263c47', '#304852'], earth: ['#263830', '#304035'],
    foliage: ['#294d40', '#345c47', '#456d50'], red: ['#724535', '#9a5940'],
    water: ['#254d57'], lamp: ['#e7b568'],
};
function build(name, author) {
    const batches = new Map();
    function add(g, mat, x, y, z, scale = [1,1,1], rotation = [0,0,0]) {
        if (g.index) g = g.toNonIndexed();
        g.scale(...scale); g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]); g.translate(x,y,z);
        const choices = palette[mat], c = new T.Color(choices[Math.floor(rand()*choices.length)]);
        const colors = new Float32Array(g.attributes.position.count*3);
        for (let i=0;i<colors.length;i+=3) {
            // Vertex AO seats stonework; the roof and foliage remain softly varied.
            const shade = .92 + rand()*.12;
            colors.set([c.r*shade,c.g*shade,c.b*shade],i);
        }
        g.setAttribute('color',new T.BufferAttribute(colors,3));
        if (!batches.has(mat)) batches.set(mat,[]);
        batches.get(mat).push(g);
    }
    function block(w,h,d,x,y,z,mat='stone',yaw=0,bevel=.035) {
        const shape=new T.Shape();shape.moveTo(-w/2,-d/2);shape.lineTo(w/2,-d/2);shape.lineTo(w/2,d/2);shape.lineTo(-w/2,d/2);shape.closePath();
        const g=new T.ExtrudeGeometry(shape,{depth:h,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1});
        g.rotateX(-Math.PI/2);add(g,mat,x,y,z,[1,1,1],[0,yaw,0]);
    }
    function rock(x,y,z,sx,sy,sz,mat='stone') {
        const g=new T.IcosahedronGeometry(1,1), p=g.attributes.position;
        for(let i=0;i<p.count;i++) { const k=.91+Math.sin(p.getX(i)*11+p.getZ(i)*7)*.09;p.setXYZ(i,p.getX(i)*k,p.getY(i)*k,p.getZ(i)*k); }
        g.computeVertexNormals();add(g,mat,x,y,z,[sx,sy,sz],[0,rand()*6.28,0]);
    }
    function beam(ax,ay,az,bx,by,bz,r,mat='wood') {
        const a=new T.Vector3(ax,ay,az),b=new T.Vector3(bx,by,bz),v=b.clone().sub(a);
        const g=new T.CylinderGeometry(r*.75,r,v.length(),7);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.normalize()));
        add(g,mat,(ax+bx)/2,(ay+by)/2,(az+bz)/2);
    }
    function shrub(x,y,z,r,mat='foliage') {
        for(let i=0;i<5;i++) rock(x+(rand()-.5)*r,y+rand()*r*.25,z+(rand()-.5)*r,r*.55,r*.23,r*.48,mat);
    }
    function lantern(x,z) {
        block(.72,.13,.72,x,.05,z,'trim');block(.38,.72,.38,x,.17,z,'stone');
        block(.68,.08,.68,x,.91,z,'trim');block(.44,.47,.44,x,1,z,'lamp',0,0);
        for(const dx of [-.26,.26]) for(const dz of [-.26,.26]) block(.055,.55,.055,x+dx,.96,z+dz,'wood',0,0);
        add(new T.ConeGeometry(.6,.24,4),'roof',x,1.63,z,[1,1,1],[0,Math.PI/4,0]);
        block(.13,.12,.13,x,1.76,z,'trim');
    }
    author({add,block,rock,beam,shrub,lantern});
    const root=new T.Group();root.name=name;
    for(const [kind,geometries] of batches) {
        const material=new T.MeshStandardMaterial({vertexColors:true,roughness:kind==='water'?.32:.94,metalness:0});
        if(kind==='lamp') {material.emissive.set('#e9ab55');material.emissiveIntensity=.8;}
        material.name=kind;
        const mesh=new T.Mesh(mergeGeometries(geometries),material);mesh.name=`${name}-${kind}`;root.add(mesh);
    }
    return root;
}

const environment=build('garden',({block,rock,beam,shrub,lantern,add})=>{
    // A single raised foundation, with an outer gravel walk and inset stone lanes.
    block(27,.55,19,0,-.65,0,'stone',0,.12);
    block(25.5,.12,17.5,0,-.23,0,'earth');
    // Bonded flagstones, no grid overlay: smaller joints and subtle value changes.
    for(let row=0;row<12;row++) for(let col=0;col<16;col++) {
        const x=(col-7.5)*1.45,z=(row-5.5)*1.28;
        block(1.405,.08,1.235,x,-.09,z,'stone',0,.018);
    }
    // The garden islands emerge from planned foundations in the floor coursing.
    for(const z of [-3,3]) {
        block(3.05,.09,2.85,0,-.025,z,'trim');
        block(2.78,.11,2.58,0,.025,z,'earth');
    }
    // Two recessed firing terraces connect to the perimeter paving.
    for(const [x,z] of [[-3.2,-6],[3.2,6]]) {
        block(3,.07,2.7,x,-.005,z,'trim');
        block(2.65,.07,2.4,x,.025,z,'stone');
    }
    // Water rills border the combat floor, with regularly spaced crossing slabs.
    for(const x of [-12,12]) {
        block(.55,.03,16.8,x,-.02,0,'water',0,0);
        for(const z of [-6,0,6]) block(1.25,.16,1.6,x,.02,z,'trim');
        for(const z of [-7.3,-3.6,3.6,7.3]) lantern(x*1.04,z);
    }
    for(const z of [-8.1,8.1]) {
        block(24.5,.22,.34,0,-.02,z,'trim');
        for(let x=-10.5;x<=10.5;x+=3) {
            block(.35,.7,.35,x,.14,z,'stone');
            block(2.7,.11,.16,x+1.5,.75,z,'wood');
            block(2.7,.1,.12,x+1.5,.42,z,'wood');
        }
    }
    // A continuous rear cloister gives the garden an architectural origin.
    block(25,.5,2.4,0,.02,-9.7,'stone');
    for(let x=-12;x<=12;x+=3) {
        block(.48,.24,.48,x,.52,-9.7,'trim');
        block(.24,3.5,.24,x,.75,-9.7,'wood');
    }
    for(const y of [3.7,4.05]) block(25,.23,.25,0,y,-9.7,'wood');
    for(const side of [-1,1]) for(let i=0;i<5;i++) {
        // Overlapping tile courses flare gently at each eave.
        const z=-9.7+side*(i*.24),y=4.6-i*.11+(i===4?.12:0);
        block(25.8,.09,.34,0,y,z,'roof');
    }
    for(let x=-12.7;x<13;x+=.28) beam(x,4.5,-10.8,x,4.5,-8.6,.045,'roof');
    for(const x of [-10.5,-4.5,4.5,10.5]) {
        block(1.5,2.1,.08,x,1.1,-10.15,'earth',0,0);
        for(let i=-3;i<=3;i++) block(.045,2.15,.06,x+i*.2,1.08,-10.05,'wood',0,0);
        lantern(x,-8.7);
    }
    // Side gates and their planted beds frame the two deployment ends.
    for(const side of [-1,1]) {
        const x=side*13;
        for(const z of [-2,2]) {block(.65,.3,.65,x,.05,z,'trim');block(.27,3.8,.27,x,.35,z,'red');}
        block(.32,.24,5,x,3.55,0,'wood');block(.48,.25,5.5,x,4.05,0,'red');
        for(const z of [-6,5.7]) {
            block(2,.2,2.6,x,.05,z,'trim');block(1.8,.15,2.4,x,.2,z,'earth');
            beam(x,.3,z,x-.4,2.6,z+.2,.2);
            beam(x-.25,1.9,z+.15,x+side*.9,3.1,z-.4,.11);
            for(let i=0;i<5;i++) shrub(x+(rand()-.5)*1.8,2.5+rand()*.8,z+(rand()-.5)*1.8,1.3,side===1?'red':'foliage');
            for(let i=0;i<6;i++) rock(x+(rand()-.5)*1.4,.35,z+(rand()-.5)*2,.22,.18,.2);
        }
    }
    // Entry steps are outside the battle, never in a movement lane.
    for(let i=0;i<4;i++) block(7+i*.35,.18,1,0,-.6-i*.17,9+i*.5,'stone');
    // Sparse leaf drifts belong to planting beds, not the combat sight lines.
    for(let i=0;i<110;i++) {
        const side=i%2?1:-1,x=side*(10.8+rand()*1.2),z=(rand()-.5)*15;
        add(new T.PlaneGeometry(.09+rand()*.09,.07),'red',x,.02,z,[1,1,1],[-Math.PI/2,0,rand()*6.28]);
    }
});
const pillar=build('pillar',({block,rock,shrub,beam})=>{
    // One planted stone island, wholly contained in its blocked cell.
    block(2.7,.17,2.45,0,.03,0,'trim',0,.06);block(2.42,.12,2.18,0,.2,0,'earth');
    rock(-.21,1.06,.05,.63,1.03,.58);rock(.45,.65,-.25,.45,.62,.5);
    rock(-.65,.42,.45,.36,.3,.33);rock(.63,.36,.55,.32,.22,.28);
    for(const [x,z] of [[-.85,-.7],[.75,.55],[-.45,.73]]) shrub(x,.38,z,.65);
    // Deliberate bamboo accent behind the rock; kept below the pet silhouette cap.
    for(let i=0;i<4;i++) {const x=.55+i*.1,z=-.68+(i%2)*.12;beam(x,.28,z,x-.08,1.6+i*.11,z,.035,'foliage');}
});
const cover=build('cover',({block})=>{
    // Four connected-looking terrace corners leave a cross-shaped walking lane.
    for(const sx of [-1,1]) for(const sz of [-1,1]) {
        block(.78,.42,.25,sx*.86,.07,sz*1.12,'stone');
        block(.25,.42,.68,sx*1.13,.07,sz*.88,'stone');
        block(.85,.08,.32,sx*.86,.51,sz*1.12,'trim');
        block(.32,.08,.75,sx*1.13,.51,sz*.88,'trim');
    }
});
const scene=new T.Group();scene.add(environment,pillar,cover);
const result=await new GLTFExporter().parseAsync(scene,{binary:true});
writeFileSync(new URL('./warfront-terrain/source/training-garden-layout.glb',import.meta.url),Buffer.from(result));
console.log(`Training garden: ${result.byteLength.toLocaleString()} bytes, ${environment.children.length} environment material batches.`);
