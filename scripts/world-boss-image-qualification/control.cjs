// Synthetic fixture control, mounted separately; never part of the image or its server entry point.
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const url=new URL(process.env.DATABASE_URL||'');
if(process.env.QUALIFICATION_DISPOSABLE!=='1'||!/^wbqual_[a-f0-9]+$/.test(url.pathname.slice(1))||!(/^(127\.0\.0\.1|wbqual-[a-f0-9]+-pg)$/.test(url.hostname)))throw Error('Disposable qualification database required');
const app=process.env.QUAL_APP_ROOT?resolve(process.env.QUAL_APP_ROOT):'/app';
if(process.env.QUAL_APP_ROOT&&url.hostname!=='127.0.0.1')throw Error('Local control only accepts loopback');
const pg=require(resolve(app,'node_modules/pg'));
const db=new pg.Client({connectionString:url.href,ssl:false});
const {kv,closeStoragePool}=require(resolve(app,'dist/api/_storage.js'));
const tower=require(resolve(app,'dist/api/towers/_tower-store.js'));
const events=require(resolve(app,'dist/api/world-boss-event/_event.js'));
const {withKvLock}=require(resolve(app,'dist/api/_lock.js'));
const {issuePlayerToken}=require(resolve(app,'dist/api/_auth.js'));
const {sagePityKey}=require(resolve(app,'dist/api/_legacy-sage-roll.js'));
async function main(input){
 const put=(k,v)=>db.query('INSERT INTO kv_store(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[k,JSON.stringify(v)]);
 if(input.command==='seed'){
  const {eventId,names}=input,now=Date.now();
  if(!/^qualification-[a-f0-9]+$/.test(eventId)||!names.every(n=>/^fixture-[a-f0-9]+$/.test(n)))throw Error('Synthetic identities required');
  await put('world-boss-event:'+eventId,{version:1,eventId,bossId:'hollow-maze-minotaur',bossName:'Murogane',status:'roaming',startedAt:now-1000,roamEndsAt:now+48*3600000,endsAt:now+72*3600000,endedAt:null,spawnSector:42,targetVillage:'Moonshadow Village',hpMax:600000,hp:600000,participants:{},settledMatchIds:[],updatedAt:now});
  await put('world-boss-event:active',eventId);await put(`world-boss-event:${eventId}:queue`,{tickets:[],activeMatchIds:[],updatedAt:now});
  for(const name of names)await put('save:'+name,{_saveVersion:1,currentSector:42,character:{name,level:100,hp:12000,maxHp:12000,chakra:1000,maxChakra:1000,stamina:1000,maxStamina:1000,village:'Moonshadow Village',clan:'Fixture',specialty:'Taijutsu',inventory:[],ryo:0,unspentStats:500,spentStats:{},examsPassed:[],stats:{strength:1000,speed:1000,taijutsuOffense:2500,taijutsuDefense:2500}}});
  // A normal declined-offer cooldown keeps unrelated Sage randomness outside settlement proof.
  for(const name of names)await put(sagePityKey(name),{declinedUntil:now+86400000});
  return names.map(name=>issuePlayerToken(name));
 }
 if(input.command==='get')return (await db.query('SELECT value,expires_at FROM kv_store WHERE key=$1',[input.key])).rows[0]??null;
 if(input.command==='activate'){
  if(!/^qualification-[a-f0-9]+$/.test(input.eventId))throw Error('Synthetic event required');
  if(!(await db.query('SELECT 1 FROM kv_store WHERE key=$1',['world-boss-event:'+input.eventId])).rows.length)throw Error('Fixture event missing');
  await put('world-boss-event:active',input.eventId);return true;
 }
 if(input.command==='age')return withKvLock(events.worldBossQueueKey(input.eventId),async()=>{const q=await events.readWorldBossQueue(input.eventId);for(const t of q.tickets)t.joinedAt-=31000;await events.writeWorldBossQueue(input.eventId,q);return true;},{failClosed:true});
 if(input.command==='prepare')return withKvLock('tower:'+input.runId,async()=>{
  const s=await tower.readSession(input.runId),p=s.actors.find(a=>a.ownerSlug===input.slug&&!a.ai),boss=s.actors.find(a=>a.id===s.phaseState.bossId);
  for(const a of s.actors){if(a.side==='enemy'&&a!==boss)a.hp=0;if(a.side==='squad'){a.hp=a.maxHp=1000000;a.character.hp=a.character.maxHp=1000000;a.pos=s.map.width*s.map.height-1;}}
  p.pos=20;boss.pos=21;boss.hp=10000;boss.shield=0;s.phaseState.pendingPhases=[];s.phaseState.triggeredPhases=[75,50,25];delete s.towerTactics;
  s.turnQueue=[p.id];s.activeIndex=0;s.activeAp=100;s.actionsThisTurn=0;s.turnStartedAt=Date.now();
  boss.statuses=[{name:'Wound',rounds:3,amount:5000,kind:'negative',activeRound:s.round,...(input.known?{worldBossOwnerSlug:p.ownerSlug}:{})}];await tower.writeSession(s);return true;
 },{failClosed:true});
 if(input.command==='done')return withKvLock('tower:'+input.runId,async()=>{const s=await tower.readSession(input.runId);s.status='done';s.winner='enemy';await tower.writeSession(s);return true;},{failClosed:true});
 if(input.command==='fault'){
  if(!/^[a-z0-9:_-]+$/i.test(input.matchKey))throw Error('Invalid fixture key');
  const checkpoint=input.checkpoint??'bank-receipt';
  if(!['bank-receipt','legacy-publication'].includes(checkpoint))throw Error('Unknown fixture checkpoint');
  const predicate=checkpoint==='legacy-publication'?"NEW.value->>'status'='settled'":"NEW.value->>'status'='active' AND COALESCE((NEW.value->>'teamDamage')::numeric,0)>0";
  await db.query('CREATE TABLE public.wb_qualification_fault_target(key text PRIMARY KEY)');
  await db.query('INSERT INTO public.wb_qualification_fault_target(key) VALUES($1)',[input.matchKey]);
  await db.query("CREATE OR REPLACE FUNCTION public.wb_qualification_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key=(SELECT key FROM public.wb_qualification_fault_target LIMIT 1) AND ("+predicate+") THEN RAISE EXCEPTION 'Synthetic receipt checkpoint interruption'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER wb_qualification_fault BEFORE INSERT OR UPDATE ON public.kv_store FOR EACH ROW EXECUTE FUNCTION public.wb_qualification_fault()');return true;
 }
 if(input.command==='unfault'){await db.query('DROP TRIGGER IF EXISTS wb_qualification_fault ON public.kv_store');await db.query('DROP FUNCTION IF EXISTS public.wb_qualification_fault()');await db.query('DROP TABLE IF EXISTS public.wb_qualification_fault_target');return true;}
 throw Error('Unknown fixture command');
}
const close=async()=>{await closeStoragePool();await db.end();};
if(process.env.QUALIFICATION_CONTROL_IPC==='1'){
 if(!process.send||!process.env.QUAL_APP_ROOT||url.hostname!=='127.0.0.1')throw Error('Private host fixture IPC required');
 (async()=>{
  await db.connect();let work=Promise.resolve();
  process.on('message',message=>{
   work=work.then(async()=>{
    if(message?.type==='shutdown'){await close();process.exit(0);return;}
    if(!Number.isSafeInteger(message?.id)||message.id<1||!message.input||typeof message.input!=='object')throw Error('Invalid private fixture message');
    try{process.send({id:message.id,ok:true,value:await main(message.input)});}
    catch(error){process.send({id:message.id,ok:false,error:String(error.stack??error)});}
   }).catch(error=>{console.error(error);process.exit(1);});
  });
  process.send({ready:true});
 })().catch(error=>{console.error(error);process.exit(1);});
}else{
 (async()=>{try{await db.connect();const input=JSON.parse(readFileSync(0,'utf8'));console.log('QUALIFICATION_RESULT '+JSON.stringify(await main(input)));}finally{await close();}})().catch(error=>{console.error(error);process.exitCode=1;});
}
