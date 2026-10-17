import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,dirname} from 'node:path';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {PET_REVIEW_RENDER_FILES,petReviewRendererSha256} from './check-pet-shape-review.mjs';
import {petBakedSupportOwnsBody} from '../src/lib/pet-baked-support.ts';
const repo=resolve(import.meta.dirname,'../..'),base=process.argv.find(a=>a.startsWith('--base='))?.slice(7);
if(!base||!/^[a-f0-9]{40}$/.test(base))throw Error('Pass the full reviewed baseline commit with --base=');
const sha=b=>createHash('sha256').update(b).digest('hex'),git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024});
const normalized=b=>b.toString('utf8').replaceAll('\r\n','\n');
const files=[];let oldRenderer=createHash('sha256');
for(const path of PET_REVIEW_RENDER_FILES){
 const before=normalized(git('show',`${base}:${path}`)),after=normalized(await readFile(resolve(repo,path)));
 oldRenderer.update(path+'\0').update(before).update('\0');
 if(path.endsWith('/pet-baked-support.ts')){
  const expected=before.replace('    clips: readonly { contacts: number }[];','    clips: readonly { contacts: number }[];\n    /** Authored physical/cast techniques solve paws and torso together. */\n    plantedAttack?: boolean;\n    /** Authored hit reaction solves its own grounded recoil. */\n    plantedRecoil?: boolean;')
   .replace('        && SUPPORT_MOTIONS.has(frame.motion)',"        && (SUPPORT_MOTIONS.has(frame.motion)\n            || (bank!.plantedAttack === true && ['windup', 'strike', 'recover'].includes(frame.motion))\n            || (bank!.plantedRecoil === true && frame.motion === 'stagger'))");
  assert.equal(after,expected,'Only the explicit plantedAttack/plantedRecoil metadata branches may differ');
 }else assert.equal(after,before,`${path}: a different renderer change needs its own review`);
 files.push({path,beforeSha256:sha(before),afterSha256:sha(after)});
}
const tree=new Map(git('ls-tree','-r',base,'--','shinobij.client/public/pet-models').toString().trim().split('\n').map(line=>{const [meta,path]=line.split('\t');return[path,meta.split(' ')[2]];}));
const support=new Set(['idle','run','dash','guard','rest']),pets=[];let comparisons=0;
for(const row of runtimePetModels.filter(r=>r.pet.id!=='mythic-4')){
 const assets=[];
 for(const path of [row.path,resolve(repo,'shinobij.client/public/pet-models/warfront-lod',relative(resolve(repo,'shinobij.client/public/pet-models'),row.path))]){
  const bytes=await readFile(path),local=relative(repo,path).replaceAll('\\','/');
  const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(blob,tree.get(local),`${local}: changed since baseline`);
  const bank=parseStudioGlb(bytes).json.extras?.characterMotion;assert.ok(bank);assert.equal(bank.plantedAttack,undefined,`${local}: not eligible for unchanged-renderer proof`);assert.equal(bank.plantedRecoil,undefined,`${local}: not eligible for unchanged-renderer proof`);
  for(const motion of ['idle','run','dash','guard','rest','windup','strike','recover','dodge','stagger','dead'])
   for(const profile of ['quadruped','biped','heavy','avian'])for(const aquatic of [true,false])for(const victorious of [true,false])for(const entranceProgress of [undefined,0,.5,1]){
    const expected=bank.revision==='20261014-contact-performance-v1'&&bank.clips.length>0&&bank.clips.some(c=>c.contacts>0)&&!aquatic&&!victorious&&!(entranceProgress!==undefined&&entranceProgress<1)&&support.has(motion)&&!(profile==='avian'&&motion==='dash');
    assert.equal(petBakedSupportOwnsBody({motion,victorious,entranceProgress},profile,bank,aquatic),expected);comparisons++;
   }
  assets.push({path:local,sha256:sha(bytes),baselineBlob:blob});
 }
 pets.push({id:row.pet.id,assets});
}
assert.equal(pets.length,160);
const report={schema:1,baselineCommit:base,scope:'Unchanged models only; Oni requires a fresh full review.',priorRendererSha256:oldRenderer.digest('hex'),rendererSha256:await petReviewRendererSha256(repo),rendererFiles:files,identities:160,decisionsCompared:comparisons,pets,conclusion:'The only runtime changes are gated by plantedAttack === true or plantedRecoil === true. Every other source and battle asset is byte-identical to baseline and lacks both flags. Its body-ownership decisions remain identical in every motion, grounded profile, aquatic, victory and entrance combination.'};
const output=resolve(repo,'docs/audits/oni-coordinated-technique-renderer-compatibility-2026-10-17.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({identities:pets.length,decisionsCompared:comparisons,rendererSha256:report.rendererSha256,output}));
