import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
// Adapter starts the actual server command; fixture control runs in a separate process.
export async function qualify(adapter){
 const checks=[];let runtime;
 const check=async(name,fn)=>{console.log('CHECK '+name);const detail=await fn();checks.push({name,passed:true,...detail});console.log('PASS '+name);};
 const ctl=input=>adapter.control(runtime,input);
 const get=key=>ctl({command:'get',key});
 const legacyEnabled=adapter.legacyEnabled===true,legacyStats=f=>get('legacy:stats:'+f.names[0]);
 const legacyOnce=async f=>{if(!legacyEnabled)return;const record=await legacyStats(f);assert.equal(record?.value?.worldBossOperations,1,'Each completed operation must be credited once');return record;};
 const legacyReceipt=f=>'world-boss-operation:'+f.runId+':'+f.names[0];
 const legacyAcknowledged=async f=>{const record=await legacyOnce(f);if(legacyEnabled)for(const field of ['activityReceipts','durableActivityReceipts'])assert.ok(!(record.value[field]??[]).includes(legacyReceipt(f)),'Published operation must retire its '+field+' proof');return record;};
 // Fixture control can block this driver's event loop past the server's idle timeout.
 // Use explicit per-request connections so that cold control startup cannot reuse a stale socket.
 const call=async(f,i,path,body)=>{const response=await (adapter.fetch??fetch)(runtime.base+path+(body?'':`${path.includes('?')?'&':'?'}playerName=${f.names[i]}`),{method:body?'POST':'GET',headers:{connection:'close','content-type':'application/json','x-player-name':f.names[i],'x-player-token':f.tokens[i]},...(body?{body:JSON.stringify({playerName:f.names[i],...body})}:{}),signal:AbortSignal.timeout(15000)});return{status:response.status,body:await response.json()};};
 const start=async role=>{runtime=await adapter.start(role);};
 const stop=async()=>{if(runtime){await adapter.stop(runtime);runtime=undefined;}};
 async function fixture(known,finish=true){
  const f={eventId:'qualification-'+randomBytes(5).toString('hex'),names:[0,1].map(()=>`fixture-${randomBytes(6).toString('hex')}`)};
  f.tokens=await ctl({command:'seed',eventId:f.eventId,names:f.names});
  const joined=await Promise.all(f.names.map((_,i)=>call(f,i,'/api/world-boss-event/queue',{action:'join'})));f.initialJoinStatuses=joined.map(r=>r.status);f.joinRetries=0;
  // Fail-closed lock contention is retryable; preserve the initial evidence and bound retries.
  for(let i=0;i<joined.length;i++)for(let n=0;joined[i].status===503&&n<3;n++){await new Promise(done=>setTimeout(done,250));joined[i]=await call(f,i,'/api/world-boss-event/queue',{action:'join'});f.joinRetries++;}
  assert.ok(joined.every(r=>r.status===200),JSON.stringify(joined));
  const q=await get(`world-boss-event:${f.eventId}:queue`);for(const name of f.names)assert.ok(q.value.tickets.filter(t=>t.slug===name).length<=1,'Duplicate queue ticket after retry');
  await ctl({command:'age',eventId:f.eventId});
  const views=await Promise.all(f.names.map((_,i)=>call(f,i,'/api/world-boss-event')));f.initialViewStatuses=views.map(r=>r.status);f.viewRetries=0;
  for(let i=0;i<views.length;i++)for(let n=0;views[i].status===503&&n<3;n++){await new Promise(done=>setTimeout(done,250));views[i]=await call(f,i,'/api/world-boss-event');f.viewRetries++;}
  assert.ok(views.every(r=>r.status===200),JSON.stringify(views.map(r=>({status:r.status,error:r.body.error}))));
  const match=views[0].body.queue.match;assert.equal(match.status,'active');assert.equal(views[1].body.queue.match.runId,match.runId);Object.assign(f,{runId:match.runId,matchId:match.matchId});
  await ctl({command:'prepare',runId:f.runId,slug:f.names[0],known});
  const before=await get('tower:'+f.runId),bossId=before.value.phaseState.bossId;
  f.action={runId:f.runId,type:'wait',moveToken:'qualification_action_'+randomBytes(8).toString('hex')};
  const action=await call(f,0,'/api/towers/action',f.action);assert.equal(action.status,200,JSON.stringify(action));assert.equal(action.body.applied,true);
  const after=await get('tower:'+f.runId);assert.equal(before.value.actors.find(a=>a.id===bossId).hp-after.value.actors.find(a=>a.id===bossId).hp,5000);
  if(known)assert.equal(after.value.worldBossContributions[f.names[0]].damage,5000);else assert.equal(after.value.worldBossUnattributedDamage,5000);
  if(finish){await ctl({command:'done',runId:f.runId});f.raw=await get('tower:'+f.runId);}
  else{assert.equal(after.value.status,'active','The handoff fixture must still be fighting');f.raw=after;}
  return f;
 }
 try{
  await start('candidate');let unknown,known,paid,active,activePaid,knownPaidBeforePublication,knownLegacy,activeLegacy;
  await check('two clients join the same encounter; periodic damage retains known and unknown attribution',async()=>{unknown=await fixture(false);known=await fixture(true);active=await fixture(true,false);return{independentClients:2,knownDamage:5000,unattributedDamage:5000,initialJoinStatuses:[active.initialJoinStatuses,unknown.initialJoinStatuses,known.initialJoinStatuses],joinRetries:active.joinRetries+unknown.joinRetries+known.joinRetries,initialViewStatuses:[active.initialViewStatuses,unknown.initialViewStatuses,known.initialViewStatuses],viewRetries:active.viewRetries+unknown.viewRetries+known.viewRetries};});
  await stop();await start('recovery');
  await check('recovery accepts fresh active combat, naturally defeats the boss and settles once',async()=>{
   assert.equal((await call(active,1,'/api/towers/state?runId='+active.runId)).status,200);
   let record=await get('tower:'+active.runId),freshActions=0;assert.deepEqual(record,active.raw,'Handoff must preserve active state and expiry before new input');
   const handoffAgeMs=Date.now()-record.value.turnStartedAt;
   console.log('ACTIVE_HANDOFF '+JSON.stringify({status:record.value.status,handoffAgeMs,storedExpiryPreserved:true}));
   while(record.value.status==='active'&&freshActions<8){
    const s=record.value,actor=s.actors.find(a=>a.id===s.turnQueue[s.activeIndex]),client=active.names.indexOf(actor?.ownerSlug);
    assert.ok(client>=0&&!actor.ai,'Fresh action must belong to an authenticated human turn');
    const command={runId:active.runId,type:'wait',moveToken:'qualification_fresh_'+randomBytes(8).toString('hex')};
    const action=await call(active,client,'/api/towers/action',command);assert.equal(action.status,200,JSON.stringify(action));assert.equal(action.body.applied,true);assert.notEqual(action.body.replayed,true);
    record=await get('tower:'+active.runId);const replay=await call(active,client,'/api/towers/action',command);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(await get('tower:'+active.runId),record);
    active.freshAction=command;active.freshClient=client;freshActions++;
   }
   assert.ok(freshActions>0);assert.equal(record.value.status,'done');assert.equal(record.value.winner,'squad');
   const boss=record.value.actors.find(a=>a.id===record.value.phaseState.bossId);assert.equal(boss.hp,0);assert.equal(record.value.worldBossContributions[active.names[0]].damage,10000);
   console.log('ACTIVE_COMBAT_WIN '+JSON.stringify({freshActions,winner:record.value.winner,bossHp:boss.hp,contribution:10000}));
   let settled;const settlementStatuses=[];
   for(let attempt=0;attempt<4;attempt++){
    settled=await call(active,0,'/api/world-boss-event/settle',{runId:active.runId});settlementStatuses.push(settled.status);assert.ok([200,503].includes(settled.status),JSON.stringify(settled));
    const event=(await get('world-boss-event:'+active.eventId)).value,save=(await get('save:'+active.names[0])).value;
    assert.ok([600000,590000].includes(event.hp),'Settlement retry banked damage more than once');assert.ok([0,2500].includes(save.character.ryo),'Settlement retry paid more than once');
    const receipts=event.settledMatchIds.filter(id=>id===active.matchId).length;assert.equal(receipts,event.hp===590000?1:0);
    if(receipts){assert.equal(event.bankedDamageByMatch[active.matchId],10000);assert.equal(event.participants[active.names[0]].damage,10000);assert.equal(event.participants[active.names[0]].matches,1);}
    if(save.character.ryo===2500)assert.equal(event.hp,590000);
    console.log('ACTIVE_SETTLEMENT_ATTEMPT '+JSON.stringify({attempt:attempt+1,status:settled.status,hp:event.hp,ryo:save.character.ryo,receipts}));
    if(settled.status!==503)break;await new Promise(done=>setTimeout(done,250));
   }
   assert.equal(settled.status,200,JSON.stringify(settled));assert.equal(settled.body.bankedDamage,10000);assert.equal((await get('world-boss-event:'+active.eventId)).value.hp,590000);
   activePaid=await get('save:'+active.names[0]);assert.equal(activePaid.value.character.ryo,2500);activeLegacy=await legacyAcknowledged(active);await ctl({command:'activate',eventId:known.eventId});
   return{activeBeforeHandoff:true,expiryPreservedBeforeNewInput:true,handoffAgeMs,freshActions,naturalRaidBossDefeat:true,settlementStatuses,settlementRetries:settlementStatuses.length-1,contribution:10000,bankedDamage:10000,reward:2500,legacyOperationCreditOnce:legacyEnabled||undefined};
  });
  await check('compatible recovery resumes stored terminal encounters, exact expiry and action receipts',async()=>{
   for(const f of[unknown,known]){assert.equal((await call(f,1,'/api/towers/state?runId='+f.runId)).status,200);assert.deepEqual(await get('tower:'+f.runId),f.raw);const replay=await call(f,0,'/api/towers/action',f.action);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(await get('tower:'+f.runId),f.raw);}return{retainedExpiry:true,replayedActions:2};
  });
  await check('database fault interrupts receipt publication after shared HP was banked',async()=>{
   const matchKey=`world-boss-event:${unknown.eventId}:match:${unknown.matchId}`;
   await ctl({command:'fault',matchKey});const failed=await call(unknown,0,'/api/world-boss-event/settle',{runId:unknown.runId});assert.equal(failed.status,503,JSON.stringify(failed));assert.equal((await get('world-boss-event:'+unknown.eventId)).value.hp,595000);assert.equal((await get(matchKey)).value.status,'active');await ctl({command:'unfault'});
   if(legacyEnabled)assert.equal((await legacyStats(unknown))?.value?.worldBossOperations??0,0,'Unattributed damage must not invent eligible player credit');
   return{status:503,bankedOnceBeforeRetry:5000,legacyUnattributedOperations:legacyEnabled?0:undefined};
  });
  await stop();await start('candidate');
  await check('candidate resumes interrupted recovery settlement without banking twice',async()=>{
   const settled=await call(unknown,0,'/api/world-boss-event/settle',{runId:unknown.runId});assert.equal(settled.status,200,JSON.stringify(settled));assert.equal(settled.body.bankedDamage,5000);assert.equal((await get('world-boss-event:'+unknown.eventId)).value.hp,595000);
   if(legacyEnabled){
    assert.equal((await legacyStats(unknown))?.value?.worldBossOperations??0,0);
    assert.equal((await legacyStats(known))?.value?.worldBossOperations??0,0,'Eligible operation must not be credited before settlement');
    const matchKey=`world-boss-event:${known.eventId}:match:${known.matchId}`;await ctl({command:'fault',matchKey,checkpoint:'legacy-publication'});
    const pending=await call(known,0,'/api/world-boss-event/settle',{runId:known.runId});assert.equal(pending.status,503,JSON.stringify(pending));const stats=await legacyOnce(known);
    assert.ok((stats.value.durableActivityReceipts??[]).includes(legacyReceipt(known)),'Interrupted operation must retain its exact durable proof');
    knownPaidBeforePublication=await get('save:'+known.names[0]);assert.equal(knownPaidBeforePublication.value.character.ryo,2500);
    assert.equal((await get('world-boss-event:'+known.eventId)).value.hp,595000);assert.equal((await get(matchKey)).value.status,'active');await ctl({command:'unfault'});
   }
   return{bankedOnce:5000,legacyCreditBeforeInterruptedMatch:legacyEnabled?1:undefined,legacyPendingReceiptPresent:legacyEnabled||undefined};
  });
  await stop();await start('recovery');
  await check('recovery settles the known owner and exposes leaderboard credit',async()=>{const settled=await call(known,0,'/api/world-boss-event/settle',{runId:known.runId});assert.equal(settled.status,200,JSON.stringify(settled));paid=await get('save:'+known.names[0]);assert.equal(paid.value.character.ryo,2500);knownLegacy=await legacyAcknowledged(known);if(legacyEnabled)assert.deepEqual(paid,knownPaidBeforePublication,'Recovery must preserve the interrupted operation paid save/version');const view=await call(known,0,'/api/world-boss-event');assert.equal(view.status,200);assert.equal(view.body.standings.individual.find(p=>p.name===known.names[0]).damage,5000);return{reward:2500,leaderboardDamage:5000,legacyCredit:legacyEnabled?1:undefined,legacyReceiptAcknowledged:legacyEnabled||undefined,interruptedPaidSaveUnchanged:legacyEnabled||undefined};});
  await stop();await start('candidate');
  await check('returning to candidate preserves save versions and settlement receipts on replay',async()=>{for(const f of[unknown,known]){assert.equal((await call(f,0,'/api/world-boss-event/settle',{runId:f.runId})).status,200);assert.equal((await get('world-boss-event:'+f.eventId)).value.hp,595000);}assert.deepEqual(await get('save:'+known.names[0]),paid);
   assert.equal((await call(active,0,'/api/world-boss-event/settle',{runId:active.runId})).status,200);assert.equal((await get('world-boss-event:'+active.eventId)).value.hp,590000);assert.deepEqual(await get('save:'+active.names[0]),activePaid);
   const beforeReplay=await get('tower:'+active.runId),beforeReplayEvent=await get('world-boss-event:'+active.eventId);const replay=await call(active,active.freshClient,'/api/towers/action',active.freshAction);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
   assert.deepEqual(await get('tower:'+active.runId),beforeReplay);assert.deepEqual(await get('world-boss-event:'+active.eventId),beforeReplayEvent);assert.equal(beforeReplayEvent.value.hp,590000);assert.deepEqual(await get('save:'+active.names[0]),activePaid);
   if(legacyEnabled){for(const[f,expected]of[[known,knownLegacy],[active,activeLegacy]]){await legacyAcknowledged(f);assert.deepEqual(await legacyStats(f),expected,'Settlement replay must not rewrite Legacy stats');}assert.equal((await legacyStats(unknown))?.value?.worldBossOperations??0,0);}
   return{saveAndVersionUnchanged:true,noDuplicateReward:true,freshRecoveryActionReplayedOnCandidate:true,legacyStatsUnchanged:legacyEnabled||undefined};});
  return{checks,passed:checks.length,failed:0};
 }catch(error){error.qualificationChecks=checks;throw error;}finally{await stop();}
}
