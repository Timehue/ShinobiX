import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository='Timehue/ShinobiX',roles=['candidate','recovery'];
export function validateRetainedImages(images,source,pins){
 assert.ok(['build','retained'].includes(source.mode),'Unknown image source mode');
 if(source.mode==='build')return;
 for(const role of roles){const expected=source.artifacts[role],actual=images[role];
  assert.equal(expected.source,pins[role],'Retained source no longer matches reviewed pin');
  for(const field of ['source','imageId','archiveSha256','schemaSha256'])assert.equal(actual[field],expected[field],'Retained '+role+' '+field+' mismatch');
 }
}
export function resolveImages(source,pins,metadata={},now=Date.now(),buildRunId){
 for(const role of roles)assert.match(pins[role],/^[a-f0-9]{40}$/);
 assert.ok(['build','retained'].includes(source.mode),'Unknown image source mode');
 const output={candidate:pins.candidate,recovery:pins.recovery,reuse:String(source.mode==='retained'),artifact_run_id:String(buildRunId??''),candidate_artifact_id:'',recovery_artifact_id:''};
 if(source.mode==='build'){assert.ok(Number.isSafeInteger(Number(buildRunId))&&Number(buildRunId)>0,'Build run ID required');return output;}
 assert.equal(source.repository,repository);assert.ok(Number.isSafeInteger(source.runId)&&source.runId>0);assert.ok(Number.isSafeInteger(source.workflowId)&&source.workflowId>0);assert.match(source.toolingHead,/^[a-f0-9]{40}$/);
 const run=metadata.run;assert.equal(run?.id,source.runId);assert.equal(run.workflow_id,source.workflowId);assert.equal(run.head_sha,source.toolingHead);assert.equal(run.repository?.full_name,repository);
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success','Producer run must have completed successfully');
 for(const role of roles){
  const expected=source.artifacts[role],artifact=metadata.artifacts?.find(a=>a.id===expected.id);
  assert.ok(Number.isSafeInteger(expected.id)&&expected.id>0);assert.equal(expected.source,pins[role],'Retained source no longer matches reviewed pin');assert.match(expected.imageId,/^sha256:[a-f0-9]{64}$/);assert.match(expected.archiveSha256,/^[a-f0-9]{64}$/);assert.match(expected.schemaSha256,/^[a-f0-9]{64}$/);
  assert.match(expected.digest,/^sha256:[a-f0-9]{64}$/);assert.ok(expected.name.startsWith('world-boss-image-'+role+'-'+source.runId+'-'));
  assert.ok(artifact,'Retained artifact missing');assert.equal(artifact.name,expected.name);assert.equal(artifact.digest,expected.digest);assert.equal(artifact.expired,false);assert.ok(Date.parse(artifact.expires_at)>now,'Retained artifact expired');assert.ok(artifact.size_in_bytes>0);
  assert.equal(artifact.workflow_run?.id,source.runId);assert.equal(artifact.workflow_run.head_sha,source.toolingHead);assert.equal(artifact.workflow_run.repository_id,run.repository.id);
  output[role+'_artifact_id']=String(expected.id);
 }
 assert.notEqual(output.candidate_artifact_id,output.recovery_artifact_id);output.artifact_run_id=String(source.runId);return output;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=JSON.parse(readFileSync(new URL('./image-source.json',import.meta.url))),pins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));let metadata={};
 assert.equal(process.env.GITHUB_REPOSITORY,repository,'Only this repository may resolve retained images');
 if(source.mode==='retained'){
  assert.equal(source.repository,repository);assert.ok(Number.isSafeInteger(source.runId)&&source.runId>0);assert.ok(process.env.GITHUB_TOKEN,'Read-only Actions token required');
  const get=async path=>{const response=await fetch('https://api.github.com/repos/'+repository+path,{headers:{accept:'application/vnd.github+json',authorization:'Bearer '+process.env.GITHUB_TOKEN},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,'Retained provenance lookup failed');return response.json();};
  for(const role of roles)assert.ok(Number.isSafeInteger(source.artifacts[role].id)&&source.artifacts[role].id>0);
  const[run,...artifacts]=await Promise.all([get('/actions/runs/'+source.runId),...roles.map(role=>get('/actions/artifacts/'+source.artifacts[role].id))]);metadata={run,artifacts};
 }
 const output=resolveImages(source,pins,metadata,Date.now(),process.env.GITHUB_RUN_ID);assert.ok(process.env.GITHUB_OUTPUT,'Actions output file required');
 appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(output).map(([key,value])=>key+'='+value+'\n').join(''));console.log(JSON.stringify({mode:source.mode,producerRun:output.artifact_run_id,candidate:output.candidate,recovery:output.recovery}));
}
