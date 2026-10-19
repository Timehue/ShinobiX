import{execFileSync}from'node:child_process';
const run=(script,args=[],log)=>{try{const out=execFileSync(process.execPath,['--import','tsx',script,...args],{encoding:'utf8',maxBuffer:20e6,timeout:1200000});if(log)awaitDummyWrite(log,out);console.log(script+' '+args.filter(a=>a.startsWith('--label=')).join(' ')+' complete');}catch(e){if(log)awaitDummyWrite(log,(e.stdout??'')+(e.stderr??''));throw e;}};
import{writeFileSync as awaitDummyWrite}from'node:fs';
run('scripts/audit-independent-pet-faces.mjs',['--model=starter-earth','--blends','--label=pebble-distinct-contact-v2'],'.tmp/pebble-distinct-contact-v2-face-probe.log');
const base=['--base-url=https://localhost:5207','--ignore-https-errors'],labels=[];
for(const stage of['source','battle']){
run('scripts/audit-all-pet-animation-poses.mjs',['--model=starter-earth','--full-geometry',...(stage==='battle'?['--asset-root=public/pet-models/warfront-lod']:[]),'--label=pebble-distinct-contact-v2-'+stage],'.tmp/pebble-distinct-contact-v2-'+stage+'-geometry.log');
for(const part of['head','body']){const label='pebble-distinct-contact-v2-'+stage+'-'+part;labels.push(label);run('scripts/capture-pet-shape-audit.mjs',['--model=starter-earth',...base,'--production-diffuse',...(stage==='battle'?['--asset-root=/pet-models/warfront-lod']:[]),...(part==='head'?['--head','--opposite-head-side','--independent-faces']:['--tight-body']),'--progress=0,.125,.375,.625,.875,1','--label='+label]);run('.tmp/slice-pet-reviewed-label.mjs',[label]);}}
const label='pebble-distinct-contact-v2-techniques';run('scripts/capture-pet-companion-techniques.mjs',['--model=starter-earth',...base,'--label='+label]);run('.tmp/make-technique-inspection-strips.mjs',[label]);
console.log('All first-pass images captured; visual approval still pending.');
