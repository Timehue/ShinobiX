import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
// Adapter starts the actual server command; fixture control runs in a separate process.
export async function qualify(adapter){
 const checks=[];let runtime;
 const check=async(name,fn)=>{console.log('CHECK '+name);const detail=await fn();checks.push({name,passed:true,...detail});console.log('PASS '+name);};
 const ctl=input=>adapter.control(runtime,input);
 const get=key=>ctl({command:'get',key});
 // Fixture control can block this driver's event loop past the server's idle timeout.
 // Use explicit per-request connections so that cold control startup cannot reuse a stale socket.
 const call=async(f,i,path,body)=>{const response=await fetch(runtime.base+path+(body?'':`${path.includes('?')?'&':'?'}playerName=${f.names[i]}`),{method:body?'POST':'GET',headers:{connection:'close','content-type':'application/json','x-player-name':f.names[i],'x-player-token':f.tokens[i]},...(body?{body:JSON.stringify({playerName:f.names[i],...body})}:{}),signal:AbortSignal.timeout(15000)});return{status:response.status,body:await response.json()};};
 const start=async role=>{runtime=await adapter.start(role);};
 const stop=async()=>{if(runtime){await adapter.stop(runtime);runtime=undefined;}};
 async function fixture(known){
  const f={eventId:'qualification-'+randomBytes(5).toString('hex'),names:[0,1].map(()=>`fixture-${randomBytes(6).toString('hex')}`)};
  f.tokens=await ctl({command:'seed',eventId:f.eventId,names:f.names});
  const joined=await Promise.all(f.names.map((_,i)=>call(f,i,'/api/world-boss-event/queue',{action:'join'})));f.initialJoinStatuses=joined.map(r=>r.status);f.joinRetries=0;
  // Fail-closed lock contention is retryable; preserve the initial evidence and bound retries.
  for(let i=0;i<joined.length;i++)for(let n=0;joined[i].status===503&&n<3;n++){await new Promise(done=>setTimeout(done,250));joined[i]=await call(f,i,'/api/world-boss-event/queue',{action:'join'});f.joinRetries++;}
  assert.ok(joined.every(r=>r.status===200),JSON.stringify(joined));
  const q=await get(`world-boss-event:${f.eventId}:queue`);for(const name of f.names)assert.ok(q.value.tickets.filter(t=>t.slug===name).length<=1,'Duplicate queue ticket after retry');
  await ctl({command:'age',eventId:f.eventId});
  const views=await Promise.all(f.names.map((_,i)=>call(f,i,'/api/world-boss-event')));assert.ok(views.every(r=>r.status===200),JSON.stringify(views));
  const match=views[0].body.queue.match;assert.equal(match.status,'active');assert.equal(views[1].body.queue.match.runId,match.runId);Object.assign(f,{runId:match.runId,matchId:match.matchId});
  await ctl({command:'prepare',runId:f.runId,slug:f.names[0],known});
  const before=await get('tower:'+f.runId),bossId=before.value.phaseState.bossId;
  f.action={runId:f.runId,type:'wait',moveToken:'qualification_action_'+randomBytes(8).toString('hex')};
  const action=await call(f,0,'/api/towers/action',f.action);assert.equal(action.status,200,JSON.stringify(action));assert.equal(action.body.applied,true);
  const after=await get('tower:'+f.runId);assert.equal(before.value.actors.find(a=>a.id===bossId).hp-after.value.actors.find(a=>a.id===bossId).hp,5000);
  if(known)assert.equal(after.value.worldBossContributions[f.names[0]].damage,5000);else assert.equal(after.value.worldBossUnattributedDamage,5000);
  await ctl({command:'done',runId:f.runId});f.raw=await get('tower:'+f.runId);return f;
 }
 try{
  await start('candidate');let unknown,known,paid;
  await check('two clients join the same encounter; periodic damage retains known and unknown attribution',async()=>{unknown=await fixture(false);known=await fixture(true);return{independentClients:2,knownDamage:5000,unattributedDamage:5000,initialJoinStatuses:[unknown.initialJoinStatuses,known.initialJoinStatuses],joinRetries:unknown.joinRetries+known.joinRetries};});
  await stop();await start('recovery');
  await check('compatible recovery resumes stored encounters, exact expiry and action receipts',async()=>{
   for(const f of[unknown,known]){assert.equal((await call(f,1,'/api/towers/state?runId='+f.runId)).status,200);assert.deepEqual(await get('tower:'+f.runId),f.raw);const replay=await call(f,0,'/api/towers/action',f.action);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(await get('tower:'+f.runId),f.raw);}return{retainedExpiry:true,replayedActions:2};
  });
  await check('database fault interrupts receipt publication after shared HP was banked',async()=>{
   await ctl({command:'fault',matchKey:`world-boss-event:${unknown.eventId}:match:${unknown.matchId}`});const failed=await call(unknown,0,'/api/world-boss-event/settle',{runId:unknown.runId});assert.equal(failed.status,503,JSON.stringify(failed));assert.equal((await get('world-boss-event:'+unknown.eventId)).value.hp,595000);assert.equal((await get(`world-boss-event:${unknown.eventId}:match:${unknown.matchId}`)).value.status,'active');await ctl({command:'unfault'});return{status:503,bankedOnceBeforeRetry:5000};
  });
  await stop();await start('candidate');
  await check('candidate resumes interrupted recovery settlement without banking twice',async()=>{const settled=await call(unknown,0,'/api/world-boss-event/settle',{runId:unknown.runId});assert.equal(settled.status,200,JSON.stringify(settled));assert.equal(settled.body.bankedDamage,5000);assert.equal((await get('world-boss-event:'+unknown.eventId)).value.hp,595000);return{bankedOnce:5000};});
  await stop();await start('recovery');
  await check('recovery settles the known owner and exposes leaderboard credit',async()=>{const settled=await call(known,0,'/api/world-boss-event/settle',{runId:known.runId});assert.equal(settled.status,200,JSON.stringify(settled));paid=await get('save:'+known.names[0]);assert.equal(paid.value.character.ryo,2500);const view=await call(known,0,'/api/world-boss-event');assert.equal(view.status,200);assert.equal(view.body.standings.individual.find(p=>p.name===known.names[0]).damage,5000);return{reward:2500,leaderboardDamage:5000};});
  await stop();await start('candidate');
  await check('returning to candidate preserves save versions and settlement receipts on replay',async()=>{for(const f of[unknown,known]){assert.equal((await call(f,0,'/api/world-boss-event/settle',{runId:f.runId})).status,200);assert.equal((await get('world-boss-event:'+f.eventId)).value.hp,595000);}assert.deepEqual(await get('save:'+known.names[0]),paid);return{saveAndVersionUnchanged:true,noDuplicateReward:true};});
  return{checks,passed:checks.length,failed:0};
 }catch(error){error.qualificationChecks=checks;throw error;}finally{await stop();}
}
