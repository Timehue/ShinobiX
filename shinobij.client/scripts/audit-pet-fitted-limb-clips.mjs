// Read-only inventory. Missing fitted channels are a review signal, not proof
// that the original visible feet had authored movement in that clip.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {readCharacterTake} from './lib/pet-character-motion.mjs';

export async function inventoryFittedLimbClips(path) {
    const bytes=await readFile(path),{json,bin}=parseStudioGlb(bytes);
    const joints=[...new Set(json.skins.flatMap(s=>s.joints))];
    const fitted=joints.filter(i=>/^(front|hind)_(upper|lower|paw)\.[LR]$/.test(json.nodes[i].name));
    const legacy=joints.filter(i=>/^legacy_(?:(front|hind)_(upper|lower|paw)|upper_arm|forearm|hand|thigh|shin|foot)\.[LR]$/.test(json.nodes[i].name));
    // Polar Bear appended quadruped chains without renaming its original
    // humanoid joints. A legacy_ naming convention must not hide that rig.
    const unrenamed=joints.filter(i=>/^(upper_arm|forearm|hand|thigh|shin|foot)\.[LR]$/.test(json.nodes[i].name));
    const original=[...legacy,...unrenamed];
    if(!fitted.length||!original.length)return null;
    const clips=[];
    for(const clip of json.animations){
        const take=await readCharacterTake(json,bin,clip);
        clips.push({name:clip.name,duration:take.duration,
            fitted:take.channels.filter(c=>fitted.includes(c.node)).map(c=>({name:c.name,path:c.path,keys:c.times.length})),
            legacy:take.channels.filter(c=>legacy.includes(c.node)).map(c=>({name:c.name,path:c.path,keys:c.times.length})),
            original:take.channels.filter(c=>original.includes(c.node)).map(c=>({name:c.name,path:c.path,keys:c.times.length})),
        });
    }
    return {sha256:createHash('sha256').update(bytes).digest('hex'),fittedJointCount:fitted.length,legacyJointCount:legacy.length,unrenamedOriginalJointCount:unrenamed.length,originalJointCount:original.length,clips};
}

async function main(){
    const client=resolve(import.meta.dirname,'..'),rows=[];
    for(const {pet,model,path} of runtimePetModels){
        const source=await inventoryFittedLimbClips(path);if(!source)continue;
        const battlePath=resolve(client,'public/pet-models/warfront-lod',relative(resolve(client,'public/pet-models'),path));
        rows.push({id:pet.id,assetId:model.visualId,sourcePath:relative(client,path).replaceAll('\\','/'),battlePath:relative(client,battlePath).replaceAll('\\','/'),source,battle:await inventoryFittedLimbClips(battlePath)});
    }
    const report={generatedAt:new Date().toISOString(),scope:'Runtime asset files in this checkout; this inventory is not a claim of live delivery.',runtimeEntriesChecked:runtimePetModels.length,rows,visualApproval:false,limits:'Channel inventory only. Independently identified original surfaces and original-limb-only freeze counterfactuals are required to establish authored motion loss; absent channels alone do not establish it.'};
    const out=resolve(process.argv[2]??resolve(client,'.tmp/pet-fitted-limb-clip-inventory.json'));await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({runtimeEntriesChecked:report.runtimeEntriesChecked,appendedLimbRigs:rows.length,rows:rows.map(r=>({id:r.id,sourceMissing:r.source.clips.filter(c=>!c.fitted.length).map(c=>({clip:c.name,originalChannels:c.original.length})),battleMissing:r.battle.clips.filter(c=>!c.fitted.length).map(c=>c.name)})),report:out},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
