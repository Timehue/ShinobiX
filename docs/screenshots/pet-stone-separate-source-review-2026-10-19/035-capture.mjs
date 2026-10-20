import{execFileSync}from'node:child_process';import{writeFileSync}from'node:fs';
const run=(script,args,log)=>{try{const out=execFileSync(process.execPath,['--import','tsx',script,...args],{encoding:'utf8',timeout:1200000,maxBuffer:20e6});if(log)writeFileSync(log,out);console.log(script+' '+args.filter(a=>a.startsWith('--label=')).join(' ')+' complete');}catch(e){if(log)writeFileSync(log,(e.stdout??'')+(e.stderr??''));throw e;}};
run('scripts/audit-independent-pet-faces.mjs',['--model=standard-5','--stage=source','--source-root=.tmp/pebble-stone-complete-face-v1','--blends','--label=stone-separate-candidate-v1'],'.tmp/stone-separate-candidate-v1-faces.log');
const labels=[];
for(const[stage,asset]of[['original',null],['candidate','/.tmp/pebble-stone-complete-face-v1/roster/standard-5.glb']])for(const part of['head','body']){const label='stone-separate-'+stage+'-v1-'+part;labels.push(label);run('scripts/capture-pet-shape-audit.mjs',['--model=standard-5','--base-url=https://localhost:5207','--ignore-https-errors','--production-diffuse',...(asset?['--asset='+asset]:[]),...(part==='head'?['--head','--opposite-head-side','--independent-faces']:['--tight-body']),'--progress=0,.125,.375,.625,.875,1','--label='+label]);}
run('.tmp/slice-pet-reviewed-label.mjs',labels);
console.log('Captured original and private Stone Turtle candidate only. Visual approval remains pending.');
