import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolveImages,validateRetainedImages} from './resolve-images.mjs';
import {qualificationReport} from './qualification-report.mjs';
const pins={candidate:'c'.repeat(40),recovery:'d'.repeat(40)},now=Date.UTC(2026,10,3);
const source={mode:'retained',repository:'Timehue/ShinobiX',runId:123,workflowId:456,toolingHead:'a'.repeat(40),artifacts:Object.fromEntries(['candidate','recovery'].map((role,i)=>[role,{
 id:11+i,name:'world-boss-image-'+role+'-123-1',digest:'sha256:'+String(5+i).repeat(64),source:pins[role],imageId:'sha256:'+String(3+i).repeat(64),archiveSha256:'1'.repeat(64),schemaSha256:'2'.repeat(64),
}]))};
const metadata=()=>({run:{id:source.runId,workflow_id:source.workflowId,head_sha:source.toolingHead,status:'completed',conclusion:'success',repository:{full_name:source.repository,id:1}},artifacts:['candidate','recovery'].map(role=>({...source.artifacts[role],expired:false,expires_at:'2026-11-17T00:00:00Z',size_in_bytes:100,workflow_run:{id:source.runId,head_sha:source.toolingHead,repository_id:1}}))});

test('current configuration selects valid reviewed pins and an explicit image source mode',()=>{
 const configuredSource=JSON.parse(readFileSync(new URL('./image-source.json',import.meta.url))),configuredPins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));
 for(const role of ['candidate','recovery'])assert.match(configuredPins[role],/^[a-f0-9]{40}$/);
 assert.notEqual(configuredPins.candidate,configuredPins.recovery);
 if(configuredSource.mode==='retained')validateRetainedImages(configuredSource.artifacts,configuredSource,configuredPins);
 else assert.equal(resolveImages(configuredSource,configuredPins,{},now,999).reuse,'false');
});
test('retained resolution returns the two reviewed immutable artifact IDs and original run',()=>{
 const output=resolveImages(source,pins,metadata(),now,999);assert.equal(output.reuse,'true');assert.equal(output.artifact_run_id,String(source.runId));assert.equal(output.candidate_artifact_id,String(source.artifacts.candidate.id));assert.equal(output.recovery_artifact_id,String(source.artifacts.recovery.id));
});
for(const kind of ['failed producer','wrong producer head','wrong repository','wrong workflow','wrong artifact run','wrong artifact head','wrong artifact repository','wrong digest','wrong role name','expired flag','expired time','missing artifact'])test('retained resolution rejects '+kind,()=>{
 const input=metadata(),artifact=input.artifacts[0];
 if(kind==='failed producer')input.run.conclusion='failure';if(kind==='wrong producer head')input.run.head_sha='0'.repeat(40);if(kind==='wrong repository')input.run.repository.full_name='unrelated/repository';if(kind==='wrong workflow')input.run.workflow_id++;
 if(kind==='wrong artifact run')artifact.workflow_run.id++;if(kind==='wrong artifact head')artifact.workflow_run.head_sha='0'.repeat(40);if(kind==='wrong artifact repository')artifact.workflow_run.repository_id++;
 if(kind==='wrong digest')artifact.digest='sha256:'+'0'.repeat(64);if(kind==='wrong role name')artifact.name=input.artifacts[1].name;if(kind==='expired flag')artifact.expired=true;if(kind==='expired time')artifact.expires_at='2026-11-02T00:00:00Z';if(kind==='missing artifact')input.artifacts.shift();
 assert.throws(()=>resolveImages(source,pins,input,now,999));
});
test('changing a candidate pin cannot silently reuse the old candidate',()=>assert.throws(()=>resolveImages(source,{...pins,candidate:'0'.repeat(40)},metadata(),now,999)));
test('build mode still requires an actual run and uses fresh producer output IDs',()=>{
 const output=resolveImages({mode:'build'},pins,{},now,999);assert.equal(output.reuse,'false');assert.equal(output.artifact_run_id,'999');assert.equal(output.candidate_artifact_id,'');assert.throws(()=>resolveImages({mode:'build'},pins,{},now));assert.throws(()=>resolveImages({mode:'unknown'},pins,{},now,999));
});
test('retained downloads must still match the pinned image ID, archive and schema',()=>{
 const images=structuredClone(source.artifacts);validateRetainedImages(images,source,pins);
 for(const field of ['source','imageId','archiveSha256','schemaSha256']){const changed=structuredClone(images);changed.candidate[field]='altered';assert.throws(()=>validateRetainedImages(changed,source,pins));}
});
const names=[
 'two clients join the same encounter; periodic damage retains known and unknown attribution',
 'recovery accepts fresh active combat, naturally defeats the boss and settles once',
 'compatible recovery resumes stored terminal encounters, exact expiry and action receipts',
 'database fault interrupts receipt publication after shared HP was banked',
 'candidate resumes interrupted recovery settlement without banking twice',
 'recovery settles the known owner and exposes leaderboard credit',
 'returning to candidate preserves save versions and settlement receipts on replay',
 'buff tile Reflect retains its caster through movement, recovery and Legacy replay',
];
function result(){const images=Object.fromEntries(['candidate','recovery'].map(role=>[role,{...source.artifacts[role],qualified:false,railwayImage:false}]));return{failed:0,passed:8,productionAccess:false,images,postgres:{passwordAuthenticationRequired:true},cleanup:{complete:true,errors:[]},checks:names.map((name,i)=>({name,passed:true,...(i===1?{activeBeforeHandoff:true,expiryPreservedBeforeNewInput:true,freshActions:1,naturalRaidBossDefeat:true}:{}),...(i===6?{freshRecoveryActionReplayedOnCandidate:true}:{}),...(i===7?{reflectDamage:5000,casterDamage:5000,holderDamage:0,unattributedDamage:5000,unknownLegacyCredit:0,knownLegacyCredit:1,pendingReceiptPresent:true,receiptAcknowledged:true,reward:2500,paidSaveUnchanged:true,replayUnchanged:true,unknownReplayUnchanged:true,freshMovement:true,sameIdRetainedField:true,naturalRaidBossDefeat:true}:{})})),runtime:['candidate','recovery','candidate','recovery','candidate','recovery','candidate'].map(role=>({role,imageId:images[role].imageId,healthCommit:images[role].source,node:'v24.21.0',pid1:{uid:1000,command:['node','dist/server.js'],executable:'/usr/local/bin/node'},defaultCommand:true,user:'node',readOnlyRoot:true,publishedPorts:false,retiredAndNoDatabaseSessions:true}))};}
test('scoped success preserves false build-stage flags and never claims production identity',()=>{
 const input=enabledLegacyResult(),before=structuredClone(input.images),report=qualificationReport(input);assert.equal(report.status,'passed');assert.equal(report.productionReleaseEligible,false);assert.equal(report.railwayImageIdentityVerified,false);assert.deepEqual(input.images,before);
});
function enabledLegacyResult(){const input=result();input.runtimeFlags={legacyEnabled:true};for(const runtime of input.runtime)runtime.legacyEnabled=true;
 input.checks[1].legacyOperationCreditOnce=true;input.checks[3].legacyUnattributedOperations=0;input.checks[4].legacyCreditBeforeInterruptedMatch=1;input.checks[4].legacyPendingReceiptPresent=true;input.checks[5].legacyCredit=1;input.checks[5].legacyReceiptAcknowledged=true;input.checks[5].interruptedPaidSaveUnchanged=true;input.checks[6].legacyStatsUnchanged=true;return input;}
test('enabled Legacy qualification requires credit, interrupted delivery, retirement and exact replay proof',()=>{
 const report=qualificationReport(enabledLegacyResult());assert.equal(report.status,'passed');assert.equal(report.legacyEnabled,true);assert.equal(report.productionReleaseEligible,false);
});
for(const kind of ['runtime flag','active credit','unattributed credit','interrupted credit','pending proof','known credit','acknowledgement','paid save','replay stats'])test('enabled Legacy report rejects missing '+kind,()=>{
 const input=enabledLegacyResult();if(kind==='runtime flag')input.runtime[0].legacyEnabled=false;if(kind==='active credit')delete input.checks[1].legacyOperationCreditOnce;if(kind==='unattributed credit')input.checks[3].legacyUnattributedOperations=1;if(kind==='interrupted credit')input.checks[4].legacyCreditBeforeInterruptedMatch=2;if(kind==='pending proof')input.checks[4].legacyPendingReceiptPresent=false;if(kind==='known credit')input.checks[5].legacyCredit=0;if(kind==='acknowledgement')input.checks[5].legacyReceiptAcknowledged=false;if(kind==='paid save')input.checks[5].interruptedPaidSaveUnchanged=false;if(kind==='replay stats')input.checks[6].legacyStatsUnchanged=false;assert.equal(qualificationReport(input).status,'failed');
});
for(const kind of ['setup failure','partial scenarios','duplicate scenario','no fresh action','no cross-image replay','runtime mismatch','unretired runtime','cleanup failure','production access','missing identity'])test('scoped report stays failed for '+kind,()=>{
 const input=enabledLegacyResult();if(kind==='setup failure'){input.failed=1;input.error='Setup failed';}if(kind==='partial scenarios'){input.passed=7;input.checks.pop();}if(kind==='duplicate scenario')input.checks[2]=input.checks[0];if(kind==='no fresh action')input.checks[1].freshActions=0;if(kind==='no cross-image replay')input.checks[6].freshRecoveryActionReplayedOnCandidate=false;if(kind==='runtime mismatch')input.runtime[0].imageId='sha256:'+'0'.repeat(64);if(kind==='unretired runtime')input.runtime[0].retiredAndNoDatabaseSessions=false;if(kind==='cleanup failure')input.cleanup.complete=false;if(kind==='production access')input.productionAccess=true;if(kind==='missing identity')delete input.images.candidate.archiveSha256;
 assert.equal(qualificationReport(input).status,'failed');
});
for(const field of ['reflectDamage','casterDamage','holderDamage','unattributedDamage','unknownLegacyCredit','knownLegacyCredit','pendingReceiptPresent','receiptAcknowledged','reward','paidSaveUnchanged','replayUnchanged','unknownReplayUnchanged','freshMovement','sameIdRetainedField','naturalRaidBossDefeat'])test('tile qualification rejects missing '+field,()=>{
 const input=enabledLegacyResult();delete input.checks[7][field];assert.equal(qualificationReport(input).status,'failed');
});
test('tile qualification requires Legacy enabled and both additional runtime handoffs',()=>{
 const disabled=enabledLegacyResult();disabled.runtimeFlags.legacyEnabled=false;assert.equal(qualificationReport(disabled).status,'failed');
 const shortened=enabledLegacyResult();shortened.runtime.splice(-2);assert.equal(qualificationReport(shortened).status,'failed');
});
