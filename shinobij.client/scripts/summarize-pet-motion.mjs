import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
const root=resolve(import.meta.dirname,'../../docs/pet-motion-evidence');
const load=async file=>JSON.parse(await readFile(resolve(root,file),'utf8'));
const before=await load('before-framed/render-results.json'), after=await load('after/render-results.json');
const angle=(a,b)=>new THREE.Quaternion().fromArray(a).normalize().angleTo(new THREE.Quaternion().fromArray(b).normalize());
const results=before.map((b,i)=>{
    const a=after[i], idle=b.samples.find(s=>s.state==='idle'), old=b.samples.find(s=>s.state==='idle-after-dodges'), fresh=a.samples.find(s=>s.state==='idle-after-dodges');
    return {pet:b.pet,mobile:b.mobile,errorsBefore:b.errors.length,errorsAfter:a.errors.length,
        callsBefore:idle.calls,callsAfter:a.samples[0].calls,trianglesBefore:idle.triangles,trianglesAfter:a.samples[0].triangles,
        residualWingDegreesBefore:idle.bones.wing_midL ? angle(idle.bones.wing_midL,old.bones.wing_midL)*180/Math.PI:null,
        residualWingDegreesAfter:idle.bones.wing_midL ? angle(idle.bones.wing_midL,fresh.bones.wing_midL)*180/Math.PI:null};
});
await writeFile(resolve(root,'render-comparison.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify(results));
