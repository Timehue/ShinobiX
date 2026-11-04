import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pins,validateImage,loadImage,hashFile} from './images.mjs';
import {waitForPostgres} from './postgres.mjs';
import {internalContainerBase} from './network.mjs';
const internalNetwork=()=>({State:{Running:true},HostConfig:{PortBindings:{}},NetworkSettings:{Ports:{'8080/tcp':null},Networks:{'wbqual-test':{IPAddress:'172.20.0.3'}}}});
test('internal bridge HTTP needs no published 3000/tcp entry',()=>assert.equal(internalContainerBase(internalNetwork(),'wbqual-test'),'http://172.20.0.3:3000'));
test('an internal container cannot request or expose a host port',()=>{
 for(const field of ['requested','published']){const inspect=internalNetwork();if(field==='requested')inspect.HostConfig.PortBindings={'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'5000'}]};else inspect.NetworkSettings.Ports={'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'5000'}]};assert.throws(()=>internalContainerBase(inspect,'wbqual-test'),/forbidden/);}
});
test('internal HTTP rejects stopped, extra-network and non-private destinations',()=>{
 for(const kind of ['stopped','extra','missing','external']){const inspect=internalNetwork();if(kind==='stopped')inspect.State.Running=false;if(kind==='extra')inspect.NetworkSettings.Networks.other={IPAddress:'172.20.0.4'};if(kind==='missing')inspect.NetworkSettings.Networks['wbqual-test'].IPAddress='';if(kind==='external')inspect.NetworkSettings.Networks['wbqual-test'].IPAddress='203.0.113.8';assert.throws(()=>internalContainerBase(inspect,'wbqual-test'));}
});
const fixture=()=>({Id:'sha256:'+'a'.repeat(64),Os:'linux',Architecture:'amd64',RootFS:{Layers:['sha256:'+'b'.repeat(64)]},Config:{User:'node',WorkingDir:'/app',Cmd:['node','dist/server.js'],Entrypoint:['docker-entrypoint.sh'],Labels:{'org.opencontainers.image.revision':pins.candidate},Env:['NODE_ENV=production','BUILD_COMMIT='+pins.candidate]}});
test('valid pinned compiled-server image configuration is accepted',()=>assert.equal(validateImage(fixture(),'candidate'),true));
test('database startup waits past socket-only initialization and requires an authenticated TCP query',async()=>{
 let elapsed=0,attempts=0;
 await waitForPostgres({name:'wbqual-test-pg',database:'wbqual_test',password:'synthetic',now:()=>elapsed,pause:async ms=>{elapsed+=ms;},docker:(args,options)=>{
  assert.ok(options.timeout>0&&options.timeout<=5000);
  assert.deepEqual(args.slice(0,5),['exec','--env','PGPASSWORD=synthetic','wbqual-test-pg','psql']);
  assert.equal(args[args.indexOf('-h')+1],'127.0.0.1');assert.equal(args[args.indexOf('-d')+1],'wbqual_test');
  assert.equal(args.at(-1),'SELECT 1');attempts++;
  if(attempts===1)throw Error('Only initialization socket is ready');
  if(attempts===2)throw Error('Authentication failed');
  if(attempts===3)return 'unexpected';
  return '1\n';
 }});assert.equal(attempts,4);assert.equal(elapsed,750);
});
test('database startup fails within its deadline instead of proceeding to schema loading',async()=>{
 let elapsed=0;
 await assert.rejects(waitForPostgres({name:'wbqual-test-pg',database:'wbqual_test',password:'synthetic',timeoutMs:500,now:()=>elapsed,pause:async ms=>{elapsed+=ms;},docker:()=>{throw Error('Not ready');}}),/authenticated TCP startup timed out/);
 assert.equal(elapsed,500);
});
for(const[field,value]of[['Id','invalid'],['Os','windows'],['Architecture','arm64']])test('reject incorrect '+field,()=>{const image=fixture();image[field]=value;assert.throws(()=>validateImage(image,'candidate'));});
for(const[field,value]of[['User','root'],['WorkingDir','/tmp'],['Cmd',['node','fixture.js']],['Entrypoint',[]],['Labels',{'org.opencontainers.image.revision':'0'.repeat(40)}],['Env',['NODE_ENV=test']]])test('reject incorrect runtime '+field,()=>{const image=fixture();image.Config[field]=value;assert.throws(()=>validateImage(image,'candidate'));});
test('wrong recovery identity is rejected',()=>assert.throws(()=>validateImage(fixture(),'recovery')));
for(const tamper of['archive','schema'])test('reject altered '+tamper+' before invoking Docker',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wb-image-check-'));try{
  writeFileSync(join(dir,'image.tar'),'synthetic image archive');writeFileSync(join(dir,'schema.sql'),'synthetic schema');
  const record={role:'candidate',source:pins.candidate,archiveSha256:hashFile(join(dir,'image.tar')),schemaSha256:hashFile(join(dir,'schema.sql'))};writeFileSync(join(dir,'identity.json'),JSON.stringify(record));
  writeFileSync(join(dir,tamper==='archive'?'image.tar':'schema.sql'),'altered');assert.throws(()=>loadImage(dir,'candidate'),/checksum mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('workflow permits scoped same-repository PR execution without publication or secrets',()=>{
 const local=new URL('./workflow.yml',import.meta.url);const workflow=readFileSync(existsSync(local)?local:new URL('../../.github/workflows/world-boss-image-qualification.yml',import.meta.url),'utf8');assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/pull_request:/);assert.match(workflow,/head\.repo\.full_name == github\.repository/);assert.doesNotMatch(workflow,/pull_request_target:|workflow_run:|push:|secrets\.|packages:|contents: write|railway up|docker push|node-version:/);
 assert.match(workflow,/node-version-file: \.nvmrc/);assert.match(workflow,/actions\/upload-artifact@v7/);assert.match(workflow,/actions\/download-artifact@v8/);assert.match(workflow,/if-no-files-found: error/);
 assert.equal((workflow.match(/uses: actions\/checkout@v7/g)||[]).length,(workflow.match(/persist-credentials: false/g)||[]).length);
 assert.match(workflow,/artifact-ids: \$\{\{ needs\.resolve\.outputs\.candidate_artifact_id \|\| needs\.retain_candidate\.outputs\.artifact_id \}\}/);assert.match(workflow,/artifact-ids: \$\{\{ needs\.resolve\.outputs\.recovery_artifact_id \|\| needs\.retain_recovery\.outputs\.artifact_id \}\}/);
});

function isolatedWorkflow(){const local=new URL('./workflow.yml',import.meta.url);return readFileSync(existsSync(local)?local:new URL('../../.github/workflows/world-boss-image-qualification.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');}
function workflowJobs(){const text=isolatedWorkflow().split('\njobs:\n')[1];assert.ok(text);const headers=[...text.matchAll(/^  ([a-z_]+):$/gm)];return Object.fromEntries(headers.map((header,i)=>[header[1],text.slice(header.index,headers[i+1]?.index??text.length)]));}
test('each newly built role has a separate runner and one immutable artifact output',()=>{
 const jobs=workflowJobs();assert.deepEqual(Object.keys(jobs),['resolve','retain_candidate','retain_recovery','qualify']);
 for(const role of ['candidate','recovery']){const job=jobs['retain_'+role];assert.match(job,/needs: resolve/);assert.match(job,/if: needs\.resolve\.outputs\.reuse != 'true'/);assert.match(job,/runs-on: ubuntu-latest/);assert.equal((job.match(/images\.mjs build /g)??[]).length,1);assert.ok(job.includes('images.mjs build '+role+' source-'+role));assert.ok(job.includes('ref: $'+'{{ needs.resolve.outputs.'+role+' }}'));assert.ok(job.includes('world-boss-image-'+role+'-$'+'{{ github.run_id }}-$'+'{{ github.run_attempt }}'));assert.match(job,/artifact_id: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}/);}
});
test('qualification requires successful resolution and both fresh producers or verified retained mode',()=>{
 const job=workflowJobs().qualify;assert.match(job,/needs: \[resolve, retain_candidate, retain_recovery\]/);
 const expected="if: $"+"{{ !cancelled() && needs.resolve.result == 'success' && (needs.resolve.outputs.reuse == 'true' || (needs.retain_candidate.result == 'success' && needs.retain_recovery.result == 'success')) }}";
 assert.ok(job.includes(expected));assert.doesNotMatch(isolatedWorkflow(),/continue-on-error:/);
});
test('artifact consumers use exact resolver run identity and role-specific uploaded IDs',()=>{
 const job=workflowJobs().qualify;assert.equal((job.match(/run-id: \$\{\{ needs\.resolve\.outputs\.artifact_run_id \}\}/g)??[]).length,2);assert.equal((job.match(/digest-mismatch: error/g)??[]).length,2);
 for(const role of ['candidate','recovery'])assert.ok(job.includes('artifact-ids: $'+'{{ needs.resolve.outputs.'+role+'_artifact_id || needs.retain_'+role+'.outputs.artifact_id }}'));
});
