import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import sharp from 'sharp';
import { rawPetPool } from '../src/data/pet-pool.ts';
import { STARTER_PETS } from '../src/data/starter-pets.ts';
import { STARTER_EVOLUTIONS, petVisualId } from '../src/data/pet-evolutions.ts';
import { petCombatModel } from '../src/lib/pet-3d-models.ts';
import { warfrontPetModelConfig } from '../src/lib/pet-warfront-model-lod.ts';
import { INDIVIDUAL_PET_ANIMATION_MODEL_IDS } from '../src/lib/pet-proper-animation-assets.ts';
import { RALLY_ECONOMY_CONTACT_ANCHOR } from '../src/features/sunscar/rally-economy-pose.ts';
import { writeRallySpriteMotionPreview } from './rally-sprite-motion-preview.mjs';

// Run from the repository: node --import tsx shinobij.client/scripts/bake-pet-rally-sprites.mjs
// Preview subset: append --ids starter-fire,standard-5,legendary-7,rare-24
// All browser requests are fulfilled from disk; no dev server or game API is used.
const client = resolve(import.meta.dirname, '..'), repo = resolve(client, '..');
const output = resolve(client, 'public/pet-rally');
const artifacts = resolve(repo, '.tmp/rally-sprite-bake');
const args = process.argv.slice(2), idsOption = args.indexOf('--ids');
assert.ok(args.every((arg, index) => arg === '--ids' || index === idsOption + 1 && idsOption >= 0), 'Only --ids comma,separated,canonical,ids is supported');
const requested = idsOption >= 0 ? new Set((args[idsOption + 1] || '').split(',').filter(Boolean)) : null;
assert.ok(!requested || requested.size > 0, '--ids requires at least one canonical pet ID');
const pets = [...rawPetPool, ...STARTER_PETS.map(entry => entry.pet), ...STARTER_EVOLUTIONS];
const entries = new Map();
for (const pet of pets) {
    const id = petVisualId(pet);
    assert.match(id, /^[a-z][a-z0-9-]*$/);
    const config = warfrontPetModelConfig(petCombatModel(pet), true);
    assert.ok(config, `No production model for ${id}`);
    entries.set(id, { id, config, preserveAuthoredStride: INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(config.visualId) });
}
for (const id of requested || []) assert.ok(entries.has(id), `Unknown canonical pet ID: ${id}`);
const models = [...entries.values()].filter(entry => !requested || requested.has(entry.id));
await mkdir(output, { recursive: true }); await mkdir(artifacts, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {
    '/animation.js': await readFile(resolve(client, 'src/features/sunscar/rally-animation.ts'), 'utf8'),
    '/rally-presentation-clock': await readFile(resolve(client, 'src/features/sunscar/rally-presentation-clock.ts'), 'utf8'),
    '/bounds.js': await readFile(resolve(client, 'src/lib/pet-model-bounds.ts'), 'utf8'),
};
const modules = new Map(Object.entries(sources).map(([url, source]) => [url, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText]));
const CELL = 192, ANCHOR_X = .5, ANCHOR_Y = RALLY_ECONOMY_CONTACT_ANCHOR;
const frames = [
    ...[0, .25, .5, .75].map(phase => ({ clip: 'gallop', phase, view: 'rear' })),
    { clip: 'guard', phase: .15, view: 'rear' },
    { clip: 'guard', phase: .15, view: 'front' },
];
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/modules/three/build/three.module.js"}}</script></head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/modules/meshoptimizer/meshopt_decoder.mjs';
import { prepareRallyClips } from '/animation.js';
import { stablePetModelPresentationBounds } from '/bounds.js';
await MeshoptDecoder.ready;
const cell=${CELL}, anchorX=${ANCHOR_X}, anchorY=${ANCHOR_Y}, frames=${JSON.stringify(frames)};
const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(cell,cell);renderer.setPixelRatio(1);renderer.setClearColor(0,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fff0dc','#798b94',2.1));
const sun=new THREE.DirectionalLight('#fff0d9',2.4);sun.position.set(-3,5,4);scene.add(sun);
const fill=new THREE.DirectionalLight('#d7ebff',.65);fill.position.set(3,2,-4);scene.add(fill);
const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,40);
// A shallow rear view keeps a ground-level trailing tail beside the soles in
// image space; steep elevation otherwise forces the whole pet to shrink.
camera.position.set(0,1.325,6);camera.lookAt(0,.8,0);camera.updateMatrixWorld(true);
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const atlas=document.createElement('canvas');atlas.width=cell*frames.length;atlas.height=cell;
const context=atlas.getContext('2d');
const point=new THREE.Vector3();
const gpu=renderer.getContext().getExtension('WEBGL_debug_renderer_info');
window.bakeInfo={threeRevision:THREE.REVISION,renderer:gpu?renderer.getContext().getParameter(gpu.UNMASKED_RENDERER_WEBGL):'unknown'};
function release(gltf,mixer,actor){
 mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);scene.remove(actor);
 const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
 gltf.scene.traverse(node=>{if(!node.isMesh)return;geometries.add(node.geometry);if(node.skeleton)skeletons.add(node.skeleton);
  for(const material of Array.isArray(node.material)?node.material:[node.material]){
   materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  }
 });
 const before={...renderer.info.memory};
 for(const geometry of geometries)geometry.dispose();
 for(const skeleton of skeletons)skeleton.dispose();
 for(const material of materials)material.dispose();
 for(const texture of textures){texture.dispose();texture.image?.close?.();}
 actor.clear();renderer.renderLists.dispose();
 return {before,geometries:geometries.size,skeletons:skeletons.size,textures:textures.size};
}
window.bakeRallyPet=async ({id,config,preserveAuthoredStride})=>{
 const gltf=await loader.loadAsync('/assets'+config.url);
 let mixer,actor;
 try{
  let skinned=0;gltf.scene.traverse(node=>{if(!node.isMesh)return;if(node.isSkinnedMesh)skinned++;
   node.frustumCulled=false;
   for(const material of Array.isArray(node.material)?node.material:[node.material])if(material.isMeshStandardMaterial){material.roughness=Math.max(.6,material.roughness);material.metalness=Math.min(.25,material.metalness);}
  });
  if(!skinned)throw new Error(id+': no real skeletal model');
  const bank=prepareRallyClips(gltf.animations,gltf.scene,false,preserveAuthoredStride);
  mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(bank.get('idle')).play();mixer.update(.01);
  const bounds=stablePetModelPresentationBounds(gltf.scene),size=bounds.fit.getSize(new THREE.Vector3()),center=bounds.fit.getCenter(new THREE.Vector3());
  const scale=Math.min(1.75/Math.max(.01,size.y),2.8/Math.max(.01,size.x,size.z));mixer.stopAllAction();
  gltf.scene.position.set(-center.x,-bounds.groundY,-center.z);
  const normalized=new THREE.Group();normalized.scale.setScalar(scale);normalized.add(gltf.scene);
  actor=new THREE.Group();actor.add(normalized);scene.add(actor);
  const renderedVertices=new Map();
  gltf.scene.traverse(node=>{if(!node.isMesh)return;
   const geometry=node.geometry,index=geometry.index,count=index?index.count:geometry.attributes.position.count;
   const start=Math.max(0,geometry.drawRange.start),end=Math.min(count,start+geometry.drawRange.count),used=new Set();
   const groups=Array.isArray(node.material)?geometry.groups:[{start,count:end-start,materialIndex:0}];
   for(const group of groups){const material=Array.isArray(node.material)?node.material[group.materialIndex]:node.material;
    if(!material||material.visible===false)continue;
    for(let entry=Math.max(start,group.start);entry<Math.min(end,group.start+group.count);entry++)used.add(index?index.getX(entry):entry);
   }
   renderedVertices.set(node,[...used]);
  });
  const jointAxis=new THREE.Vector3(1,0,0),jointTurn=new THREE.Quaternion();
  const bendJoints=[];
  gltf.scene.traverse(node=>{if(!node.isBone)return;const match=/^(front_lower|hind_lower|shin)([.]?[LR])$/.exec(node.name);
   if(!match)return;const tipName=(match[1]==='shin'?'foot':match[1].replace('lower','paw'))+match[2];
   const tip=gltf.scene.getObjectByName(tipName);bendJoints.push({lower:node,tip,lowerBase:node.quaternion.clone(),tipBase:tip?.quaternion.clone(),side:match[2].endsWith('L')?0:.5,front:match[1]==='front_lower'});
  });
  const sample=frame=>{
   actor.rotation.y=config.yawOffset+(frame.view==='rear'?Math.PI:0);
   mixer.stopAllAction();
   // Unkeyed joints are not restored by AnimationMixer. Restore the original
   // pose before authored tracks and additive folds are sampled again.
   for(const joint of bendJoints){joint.lower.quaternion.copy(joint.lowerBase);if(joint.tip)joint.tip.quaternion.copy(joint.tipBase);}
   const clip=bank.get(frame.clip),action=mixer.clipAction(clip).reset().play();
   action.time=clip.duration*frame.phase;action.paused=true;mixer.update(0);
   // Rear views hide forward/back hip swing. Give the generic adapter a small
   // alternating knee fold/ankle recovery so swing feet clear the planted one.
   // Specialist banks retain their individually authored choreography.
   if(frame.clip==='gallop'&&!preserveAuthoredStride){
    for(const joint of bendJoints){const lift=Math.max(0,Math.sin((frame.phase+joint.side+(joint.front ? .5 : 0))*Math.PI*2));
     joint.lower.quaternion.multiply(jointTurn.setFromAxisAngle(jointAxis,-lift*.65));
     if(joint.tip?.parent===joint.lower)joint.tip.quaternion.multiply(jointTurn.setFromAxisAngle(jointAxis,lift*.4));
    }
    normalized.rotation.z=Math.sin(frame.phase*Math.PI*2)*.025;
   }else normalized.rotation.z=0;
   actor.updateMatrixWorld(true);
  };
  const snapshotPose=()=>{
   const values=[];actor.traverse(node=>{
    // Include the actor/normalization ancestors, bones, meshes and any other
    // animated nodes. Copy numbers so later sampling cannot mutate evidence.
    values.push(...node.matrixWorld.elements);
    if(node.isSkinnedMesh)values.push(...node.bindMatrixInverse.elements);
    if(node.morphTargetInfluences)values.push(...node.morphTargetInfluences);
   });return values;
  };
  // Keep a fixed scale/x across the complete silhouettes, but derive the
  // vertical anchor from each pose's actual sole, never a different frame/tail.
  const envelope={left:Infinity,right:-Infinity,low:Infinity,high:-Infinity};
  const contacts=[],measuredPoses=[];let aboveContact=0,belowContact=0;
  for(const frame of frames){sample(frame);
   measuredPoses.push(snapshotPose());
   const posed={low:Infinity,high:-Infinity,coreTop:-Infinity},sole=[],belly=[],silhouette=[];
   actor.traverse(node=>{
   if(!node.isMesh||!node.visible)return;
   for(const i of renderedVertices.get(node)||[]){
    node.getVertexPosition(i,point);point.applyMatrix4(node.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    if(!point.toArray().every(Number.isFinite))throw new Error(id+': invalid deformed point');
    envelope.left=Math.min(envelope.left,point.x);envelope.right=Math.max(envelope.right,point.x);
    envelope.low=Math.min(envelope.low,point.y);envelope.high=Math.max(envelope.high,point.y);
    posed.low=Math.min(posed.low,point.y);posed.high=Math.max(posed.high,point.y);
    const candidate={x:point.x,y:point.y};silhouette.push(candidate);
    if(node.isSkinnedMesh){let footWeight=0,bodyWeight=0,headWeight=0;
     const indices=node.geometry.attributes.skinIndex,weights=node.geometry.attributes.skinWeight;
     for(let influence=0;influence<4;influence++){
      const bone=node.skeleton.bones[indices.getComponent(i,influence)],weight=weights.getComponent(i,influence);
      // Sculpted toe/sole surfaces are often weighted to the lower-leg segment
      // rather than its terminal paw node; both are genuine foot support.
      if(/^(foot|front_paw|hind_paw|shin|front_lower|hind_lower)[.]?[LR]$/.test(bone?.name||''))footWeight+=weight;
      if(/^(root|pelvis|spine|chest)$/.test(bone?.name||''))bodyWeight+=weight;
      if(/^(neck|head)$/.test(bone?.name||''))headWeight+=weight;
     }
     if(footWeight>=.4)sole.push(candidate);if(bodyWeight>=.5)belly.push(candidate);
     if(bodyWeight+headWeight>=.5)posed.coreTop=Math.max(posed.coreTop,point.y);
    }
   }
   });
   const useSole=sole.length>=6;
   const support=useSole?sole:belly.length>=6?belly:silhouette;
   const contact=support.reduce((low,value)=>value.y<low.y?value:low,{x:0,y:Infinity});
   contacts.push({...contact,method:useSole?'sole':belly.length>=6?'belly':'silhouette',vertices:support.length,
    coreHeight:Number.isFinite(posed.coreTop)?posed.coreTop-contact.y:posed.high-contact.y});
   aboveContact=Math.max(aboveContact,posed.high-contact.y);belowContact=Math.max(belowContact,contact.y-posed.low);
  }
  const origin=new THREE.Vector3(0,0,0).applyMatrix4(camera.matrixWorldInverse),padding=9;
  const halfWidth=Math.max(Math.abs(envelope.left-origin.x),Math.abs(envelope.right-origin.x));
  const pixelsPerUnit=Math.min((cell*.5-padding)/Math.max(.01,halfWidth),(cell*anchorY-padding)/Math.max(.01,aboveContact),
   (cell*(1-anchorY)-3)/Math.max(.001,belowContact));
  camera.left=origin.x-cell*anchorX/pixelsPerUnit;camera.right=camera.left+cell/pixelsPerUnit;
  context.clearRect(0,0,atlas.width,atlas.height);
  for(const [index,frame]of frames.entries()){sample(frame);
   const renderedPose=snapshotPose(),measuredPose=measuredPoses[index];
   if(renderedPose.length!==measuredPose.length||renderedPose.some((value,component)=>!Number.isFinite(value)||!Number.isFinite(measuredPose[component])||Math.abs(value-measuredPose[component])>1e-7))
    throw new Error(id+'/'+index+': measurement/render pose mismatch');
   camera.top=contacts[index].y+cell*anchorY/pixelsPerUnit;camera.bottom=camera.top-cell/pixelsPerUnit;camera.updateProjectionMatrix();
   renderer.render(scene,camera);context.drawImage(renderer.domElement,index*cell,0);
  }
  for(const contact of contacts){contact.pixel={x:cell*anchorX+(contact.x-origin.x)*pixelsPerUnit,y:cell*anchorY};
   contact.normalized={x:contact.pixel.x/cell,y:anchorY};contact.bodyHeightPixels=contact.coreHeight*pixelsPerUnit;}
  const result={png:atlas.toDataURL('image/png').split(',')[1],scale,envelope,pixelsPerUnit,
   sourceVisualId:config.visualId,source:config.url,yawOffset:config.yawOffset,profile:config.profile,
   gallopTracks:bank.get('gallop').tracks.length,preserveAuthoredStride,contacts,posePassesIdentical:true,
   topology:[...renderedVertices].map(([mesh,used])=>({mesh:mesh.name,positions:mesh.geometry.attributes.position.count,rendered:used.length}))};
  result.release=release(gltf,mixer,actor);mixer=null;actor=null;
  result.resources={...renderer.info.memory};return result;
 }finally{if(mixer&&actor)release(gltf,mixer,actor);}
};
window.closeBake=()=>{renderer.dispose();renderer.forceContextLoss();};
window.bakeReady=true;
</script></body></html>`;
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], rows = [], startedAt = new Date().toISOString();
let rendererTextureBaseline;
const page = await browser.newPage({ viewport: { width: CELL, height: CELL } });
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
    if (modules.has(path)) return route.fulfill({ contentType: 'text/javascript', body: modules.get(path) });
    const library = path.startsWith('/modules/'), prefix = library ? '/modules/' : '/assets/';
    const base = resolve(client, library ? 'node_modules' : 'public');
    const file = resolve(base, decodeURIComponent(path.slice(prefix.length)));
    if (!path.startsWith(prefix) || !file.startsWith(base + sep)) return route.abort();
    return route.fulfill({ contentType: library ? 'text/javascript' : 'model/gltf-binary', body: await readFile(file) });
});
try {
    await page.goto('http://rally-sprite-bake.invalid/index.html'); await page.waitForFunction(() => window.bakeReady);
    const info = await page.evaluate(() => window.bakeInfo);
    for (const [index, model] of models.entries()) {
        const { png, ...metadata } = await page.evaluate(entry => window.bakeRallyPet(entry), model);
        const bytes = Buffer.from(png, 'base64');
        const { data, info: raster } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(raster.width, CELL * frames.length); assert.equal(raster.height, CELL);
        const coverage = frames.map((_, column) => {
            const extent = { left: CELL, right: -1, top: CELL, bottom: -1, pixels: 0, contactBandPixels: 0 };
            for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
                const alpha = data[((y * raster.width + column * CELL + x) * 4) + 3];
                if (alpha < 16) continue;
                extent.left = Math.min(extent.left, x); extent.right = Math.max(extent.right, x);
                extent.top = Math.min(extent.top, y); extent.bottom = Math.max(extent.bottom, y); extent.pixels++;
                if (Math.abs(y + .5 - CELL * ANCHOR_Y) <= 3) extent.contactBandPixels++;
            }
            assert.ok(extent.pixels > 100, `${model.id}/${column}: empty sprite`);
            assert.ok(extent.left >= 3 && extent.right < CELL - 3 && extent.top >= 3 && extent.bottom < CELL - 3, `${model.id}/${column}: clipped silhouette ${JSON.stringify(extent)}`);
            assert.ok(extent.contactBandPixels >= 2, `${model.id}/${column}: no visible support at the contact anchor`);
            return extent;
        });
        const webp = await sharp(bytes).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
        const path = resolve(output, `${model.id}.webp`); await writeFile(path, webp);
        const sourceBytes = await readFile(resolve(client, 'public', model.config.url.split('?')[0].slice(1)));
        const smallBodyFrames = metadata.contacts.flatMap((contact, frame) => contact.method === 'sole' && contact.bodyHeightPixels < 100 ? [frame] : []);
        rows.push({ id: model.id, file: `/pet-rally/${model.id}.webp`, bytes: webp.length, sha256: sha256(webp), sourceSha256: sha256(sourceBytes), ...metadata, coverage, smallBodyFrames });
        assert.equal(metadata.resources.geometries, 0, `${model.id}: retained geometry`);
        // Three may retain a renderer-wide lookup texture. It must stay bounded
        // across the whole roster rather than retain any per-pet allocation.
        rendererTextureBaseline ??= metadata.resources.textures;
        assert.ok(rendererTextureBaseline <= 3, `${model.id}: unexpected renderer texture baseline`);
        assert.ok(metadata.resources.textures <= rendererTextureBaseline, `${model.id}: growing retained textures ${JSON.stringify(metadata.release)}`);
        console.log(`${index + 1}/${models.length} ${model.id} ${webp.length} bytes`);
        if (smallBodyFrames.length) console.warn(`${model.id}: review legged body occupancy in frames ${smallBodyFrames.join(',')}`);
    }
    assert.deepEqual(errors, []);
    const report = { startedAt, completedAt: new Date().toISOString(), format: 'webp', cell: CELL, columns: frames.length,
        anchor: { x: ANCHOR_X, y: ANCHOR_Y }, frames, camera: { projection: 'orthographic', position: [0, 1.325, 6], lookAt: [0, .8, 0] },
        adapterSha256: sha256(Object.values(sources).join('\n')), bakerSha256: sha256(await readFile(import.meta.filename)),
        contactAnchorSha256: sha256(await readFile(resolve(client, 'src/features/sunscar/rally-economy-pose.ts'))),
        ...info, models: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), errors,
        occupancyWarnings: rows.filter(row => row.smallBodyFrames.length).map(row => ({ id: row.id, frames: row.smallBodyFrames,
            bodyHeightPixels: row.contacts.map(contact => Math.round(contact.bodyHeightPixels)) })), rows };
    await writeFile(resolve(artifacts, requested ? 'preview-report.json' : 'report.json'), JSON.stringify(report, null, 2));
    // A review sheet shows every frame on a plain background; shipping remains transparent.
    const sheet = [];
    for (const [row, entry] of rows.entries()) {
        sheet.push({ input: await sharp(resolve(output, `${entry.id}.webp`)).flatten({ background: '#283238' }).png().toBuffer(), left: 0, top: row * (CELL + 28) + 28 });
        const label = `<svg width="${CELL * frames.length}" height="28"><rect width="100%" height="100%" fill="#283238"/><text x="10" y="20" fill="white" font-size="16" font-family="Arial">${entry.id} · rear run 0/25/50/75% · rear ready · front ready</text></svg>`;
        sheet.push({ input: Buffer.from(label), left: 0, top: row * (CELL + 28) });
    }
    await sharp({ create: { width: CELL * frames.length, height: rows.length * (CELL + 28), channels: 3, background: '#283238' } }).composite(sheet).png().toFile(resolve(artifacts, requested ? 'preview.png' : 'roster.png'));
    if (requested) await writeRallySpriteMotionPreview(rows, output, resolve(artifacts, 'preview-motion.gif'), CELL, ANCHOR_Y);
    await page.evaluate(() => window.closeBake());
    console.log(JSON.stringify({ models: report.models, cell: CELL, columns: frames.length, totalBytes: report.totalBytes, errors, report: artifacts }));
} finally { await browser.close(); }
