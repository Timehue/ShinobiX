import assert from 'node:assert/strict';
import { before, after, test, mock } from 'node:test';
import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'isolated-world-boss-audit-session-secret-20261103';
process.env.DISABLE_REALTIME = '1';
process.env.DISABLE_SCHEDULED_JOBS = '1';
process.env.DISABLE_SNAPSHOT_CRON = '1';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_POSTGRES_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let kv: any, events: any, queue: any, tower: any, auth: any, world: any;
let server: Server, base: string;
let nextFixtureFailure: Error | undefined;
const evidence: any[] = [];
before(async () => {
  kv = (await import('../_storage.js')).kv;
  events = await import('./_event.js'); queue = await import('./_queue.js');
  tower = await import('../towers/_tower-store.js'); auth = await import('../_auth.js');
  world = await import('../../shared/world-boss-event.js');
  const handlers = new Map([
    ['/api/world-boss-event', (await import('../world-boss-event.js')).default],
    ['/api/world-boss-event/queue', (await import('./queue.js')).default],
    ['/api/world-boss-event/settle', (await import('./settle.js')).default],
    ['/api/towers/action', (await import('../towers/action.js')).default],
    ['/api/towers/state', (await import('../towers/state.js')).default],
  ]);
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    const handler = handlers.get(url.pathname);
    if (!handler) { res.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    (req as any).body = raw ? JSON.parse(raw) : {};
    (req as any).query = Object.fromEntries(url.searchParams);
    (res as any).status = (code: number) => { res.statusCode = code; return res; };
    (res as any).json = (body: any) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    try {
      if (nextFixtureFailure) { const failure = nextFixtureFailure; nextFixtureFailure = undefined; throw failure; }
      await (handler as unknown as (req: any, res: any) => Promise<unknown>)(req, res);
    } catch (e) {
      console.error('[world-boss-audit-fixture]', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Audit fixture handler failed.' }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  if (process.env.WORLD_BOSS_AUDIT_OBSERVATIONS) writeFileSync(resolve(process.env.WORLD_BOSS_AUDIT_OBSERVATIONS), JSON.stringify(evidence, null, 2));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('fixture HTTP failures keep exception details in the test log', async () => {
  const failure = new Error('fixture-only-private-diagnostic');
  const diagnostics = mock.method(console, 'error', () => undefined);
  nextFixtureFailure = failure;
  try {
    const response = await fetch(base + '/api/world-boss-event');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Audit fixture handler failed.' });
    assert.equal(diagnostics.mock.callCount(), 1);
    assert.equal(diagnostics.mock.calls[0].arguments[1], failure);
  } finally {
    nextFixtureFailure = undefined;
    diagnostics.mock.restore();
  }
});
function client(slug: string) {
  const token = auth.issuePlayerToken(slug)!;
  return async (path: string, body?: any, name = slug) => {
    const url = body ? path : `${path}${path.includes('?') ? '&' : '?'}playerName=${encodeURIComponent(name)}`;
    const response = await fetch(base + url, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-player-name': slug, 'x-player-token': token },
      ...(body ? { body: JSON.stringify({ playerName: name, ...body }) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };
}
async function fixture(id: string, names = [`audit-${id.slice(0,20)}-a`, `audit-${id.slice(0,20)}-b`, `audit-${id.slice(0,20)}-c`], hp = 600000) {
  const now = Date.now();
  const event = { version: 1, eventId: `audit-${id}`, bossId: 'hollow-maze-minotaur', bossName: 'Murogane', status: 'roaming', startedAt: now - 1000,
    roamEndsAt: now + 48*3600000, endsAt: now + 72*3600000, endedAt: null, spawnSector: 42, targetVillage: 'Moonshadow Village', hpMax: hp, hp,
    participants: {}, settledMatchIds: [], updatedAt: now };
  await events.writeWorldBossEvent(event); await kv.set(events.WORLD_BOSS_ACTIVE_KEY, event.eventId);
  await events.writeWorldBossQueue(event.eventId, events.emptyWorldBossQueue(now));
  const sector = world.worldBossEventPosition(event, now).currentSector;
  for (const [index, name] of names.entries()) await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character: {
    name, level: 100, hp: 12000, maxHp: 12000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
    village: index === 2 ? 'Stormveil Village' : 'Moonshadow Village', clan: index === 1 ? 'Audit South' : 'Audit North',
    specialty: 'Taijutsu', inventory: [], ryo: 0, unspentStats: 500, spentStats: {}, examsPassed: [],
    stats: { strength: 1000, speed: 1000, taijutsuOffense: 2500, taijutsuDefense: 2500 },
  } });
  return { event, names, clients: names.map(client) };
}
async function join(f: any, index: number) { return f.clients[index]('/api/world-boss-event/queue', { action: 'join' }); }
async function launch(id: string, names?: string[], count = 3, hp = 600000) {
  const f = await fixture(id, names, hp);
  for (let index = 0; index < count; index++) assert.equal((await join(f, index)).status, 200);
  if (count < 3) {
    const q = await events.readWorldBossQueue(f.event.eventId); q.tickets[0].joinedAt -= 31000;
    await events.writeWorldBossQueue(f.event.eventId, q);
  }
  const view = await f.clients[0]('/api/world-boss-event');
  assert.equal(view.body.queue.match?.status, 'active', JSON.stringify(view.body));
  return { ...f, runId: view.body.queue.match.runId, matchId: view.body.queue.match.matchId };
}
async function setupCombat(f: any, hp?: number) {
  const s = await tower.readSession(f.runId); const p = s.actors.find((a: any) => a.ownerSlug === f.names[0] && !a.ai);
  const boss = s.actors.find((a: any) => a.id === s.phaseState.bossId);
  for (const a of s.actors) if (a.side === 'enemy' && a.id !== boss.id) a.hp = 0;
  s.phaseState.pendingPhases = []; s.phaseState.triggeredPhases = [75, 50, 25]; delete s.towerTactics;
  boss.shield = 0; boss.statuses = []; if (hp != null) boss.hp = hp;
  boss.pos = p.pos + (p.pos % s.map.width === s.map.width-1 ? -1 : 1);
  p.character.jutsu = [{ id: 'audit-strike', name: 'Audit strike', type: 'Taijutsu', ap: 60, range: 4, effectPower: 2000 }];
  p.character.jutsuMastery = [{ jutsuId: 'audit-strike', level: 50 }];
  s.activeIndex = s.turnQueue.indexOf(p.id); s.activeAp = 100; s.actionsThisTurn = 0; s.turnStartedAt = Date.now();
  await tower.writeSession(s); return { s, p, boss };
}

test('HTTP: duplicate joins are unique; two clients share a timeout-formed duo and reconnect', async () => {
  const f = await fixture('duo');
  assert.equal((await join(f,0)).status,200); assert.equal((await join(f,0)).status,200);
  let q = await events.readWorldBossQueue(f.event.eventId); assert.equal(q.tickets.length,1);
  assert.equal((await join(f,1)).status,200); q = await events.readWorldBossQueue(f.event.eventId);
  assert.equal(q.tickets.length,2); assert.ok((await events.readWorldBossEvent(f.event.eventId)).movementPausedAt);
  q.tickets[0].joinedAt -= 31000; await events.writeWorldBossQueue(f.event.eventId,q);
  const a = await f.clients[0]('/api/world-boss-event'), b = await f.clients[1]('/api/world-boss-event');
  assert.equal(a.body.queue.match.status,'active'); assert.equal(a.body.queue.match.runId,b.body.queue.match.runId);
  const runId=a.body.queue.match.runId;
  const freshClient=client(f.names[1]); const recovered=await freshClient(`/api/towers/state?runId=${runId}`);
  assert.equal(recovered.status,200); assert.equal(recovered.body.session.partySize,2);
  assert.deepEqual(recovered.body.session.actors,a.body.queue.match.session.actors);
  evidence.push({case:'duo and reconnect',runId,owners:recovered.body.session.actors.filter((a:any)=>!a.ai).map((a:any)=>a.ownerSlug)});
});

test('HTTP: concurrent joins form one trio; ownership, outsider rejection and retry are enforced', async () => {
  const f=await fixture('trio'); const joined=await Promise.all([join(f,0),join(f,1),join(f,2)]);
  assert.ok(joined.every(r=>r.status===200),JSON.stringify(joined));
  const views=await Promise.all(f.clients.map((c:any)=>c('/api/world-boss-event')));
  const runId=views[0].body.queue.match.runId; assert.ok(views.every(r=>r.body.queue.match.runId===runId));
  let s=views[0].body.queue.match.session; assert.equal(s.partySize,3);
  const active=s.actors.find((a:any)=>a.id===s.turnQueue[s.activeIndex]);
  const owner=f.names.indexOf(active.ownerSlug), other=(owner+1)%3;
  assert.equal((await f.clients[other]('/api/towers/action',{runId,type:'wait',actorId:active.id})).status,409);
  assert.ok([401,403,409].includes((await f.clients[other]('/api/towers/action',{runId,type:'wait'},active.ownerSlug)).status));
  assert.equal((await client('audit-outsider')(`/api/towers/state?runId=${runId}`)).status,403);
  assert.equal((await f.clients[owner]('/api/world-boss-event/settle',{runId})).status,409);
  const action={runId,type:'wait',moveToken:'audit_move_token_trio_0001',expectedVersion:s.actionVersion??0};
  const first=await f.clients[owner]('/api/towers/action',action); assert.equal(first.status,200); assert.equal(first.body.applied,true);
  const retry=await f.clients[owner]('/api/towers/action',action); assert.equal(retry.body.replayed,true);
  assert.deepEqual(retry.body.session,first.body.session);
  const states=await Promise.all(f.clients.map((c:any)=>c(`/api/towers/state?runId=${runId}`)));
  assert.ok(states.every(r=>r.status===200)); assert.deepEqual(states[0].body.session,states[1].body.session);
  s=await tower.readSession(runId); const before=s.turnQueue[s.activeIndex]; s.turnStartedAt=Date.now()-76000; await tower.writeSession(s);
  const afk=await f.clients[other](`/api/towers/state?runId=${runId}`); assert.equal(afk.status,200);
  assert.notEqual(afk.body.session.turnQueue[afk.body.session.activeIndex],before);
  assert.ok(afk.body.session.log.some((line:string)=>line.includes('was away')));
  assert.equal((await f.clients[0]('/api/world-boss-event/queue',{action:'leave'})).status,409);
  evidence.push({case:'trio HTTP clients',runId,partySize:3,replay:true,afk:true});
});

test('HTTP: leave releases queue, enforces cooldown, and allows rejoin after expiry',async()=>{
  const f=await fixture('leave'); assert.equal((await join(f,0)).status,200);
  const left=await f.clients[0]('/api/world-boss-event/queue',{action:'leave'}); assert.equal(left.status,200);
  assert.equal(left.body.queue.queued,false); assert.ok(left.body.queue.rejoinAfter>Date.now());
  assert.equal((await join(f,0)).status,429); assert.equal((await events.readWorldBossQueue(f.event.eventId)).tickets.length,0);
  assert.equal((await events.readWorldBossEvent(f.event.eventId)).movementPausedAt,null);
  await kv.del(events.worldBossQueueCooldownKey(f.names[0])); assert.equal((await join(f,0)).status,200);
});

test('HTTP: wrong location, incapacitation and missing credentials cannot join',async()=>{
 const f=await fixture('entry');const save=await kv.get(`save:${f.names[0]}`);
 save.currentSector=43;await kv.set(`save:${f.names[0]}`,save);assert.equal((await join(f,0)).status,409);
 save.currentSector=42;save.character.hospitalized=true;save.character.hospitalStayEnd=Date.now()+60000;
 await kv.set(`save:${f.names[0]}`,save);assert.equal((await join(f,0)).status,409);
 const unauth=await fetch(base+'/api/world-boss-event/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerName:f.names[0],action:'join'})});
 assert.equal(unauth.status,401);assert.equal((await events.readWorldBossQueue(f.event.eventId)).tickets.length,0);
});

test('HTTP: support-only cleansing qualifies, pays once and contributes to leaderboard',async()=>{
 const f=await launch('support',undefined,1);const {s,p}=await setupCombat(f);
 p.statuses=[{name:'Wound',rounds:3,amount:50,kind:'negative',activeRound:s.round},{name:'Poison',rounds:3,percent:5,kind:'negative',activeRound:s.round}];
 await tower.writeSession(s);
 const cast=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'cleanse'});
 assert.equal(cast.body.applied,true,JSON.stringify(cast.body));const end=await tower.readSession(f.runId);
 end.status='done';end.winner='enemy';await tower.writeSession(end);
 const paid=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});assert.equal(paid.status,200);
 assert.equal(paid.body.contribution.cleanses,2);assert.equal(paid.body.contribution.active,true);assert.equal(paid.body.reward.ryo,2500);
 const board=await f.clients[0]('/api/world-boss-event');assert.equal(board.body.personalRank,1);assert.equal(board.body.personal.damage,0);
 evidence.push({case:'support-only cleanse',contribution:paid.body.contribution,points:board.body.personal.points});
});

test('HTTP: shard deposit adds leaderboard points exactly once; tied ranks and top-15 caches are stable',async()=>{
 const names=Array.from({length:17},(_,i)=>`audit-rank-${String(i).padStart(2,'0')}`);const f=await fixture('ranks',names);
 const event=await events.readWorldBossEvent(f.event.eventId);event.hollowShardsHeldByPlayer={[names[0]]:2};await events.writeWorldBossEvent(event);
 const body={action:'depositHollowShards',eventId:event.eventId,requestId:'audit_shard_request_0001'};
 const first=await f.clients[0]('/api/world-boss-event',body),repeat=await f.clients[0]('/api/world-boss-event',body);
 assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.points,2000);assert.equal(repeat.body.replayed,true);
 let fresh=await events.readWorldBossEvent(event.eventId);assert.equal(fresh.participants[names[0]].crystalPoints,2000);
 for(const name of names)fresh.participants[name]={slug:name,name,village:'Moonshadow Village',clan:'Audit Rank',damage:1000,score:0,crystalPoints:name===names[0]?2000:0,hollowShardsDeposited:0,actions:1,matches:1,firstAt:Date.now()};
 fresh.status='victory';fresh.hp=0;fresh.endedAt=Date.now();await events.writeWorldBossEvent(fresh);
 const top=await import('./_top-cache.js');await top.settleWorldBossTopCaches(event.eventId);await top.settleWorldBossTopCaches(event.eventId);
 fresh=await events.readWorldBossEvent(event.eventId);assert.deepEqual(fresh.topCacheRecipients.map((r:any)=>r.slug),names.slice(0,15));
 for(const [i,name]of names.entries()){
  const save=await kv.get(`save:${name}`);const count=save.character.itemStacks?.find((s:any)=>s.itemId==='hollow-beast-cache')?.count??0;
  assert.equal(count,i<15?1:0);
 }
 const board=await f.clients[16]('/api/world-boss-event');assert.equal(board.body.personalRank,17);assert.equal(board.body.standings.individual.length,17);
 evidence.push({case:'shards and ranking',points:first.body.points,cacheRecipients:fresh.topCacheRecipients.length,outsideTop15Rank:board.body.personalRank});
});

test('HTTP: moved teammate cancels the formation and releases all battle leases',async()=>{
  const f=await fixture('moved'); await join(f,0); await join(f,1);
  const save=await kv.get(`save:${f.names[1]}`); save.currentSector=43; await kv.set(`save:${f.names[1]}`,save);
  await join(f,2); const view=await f.clients[0]('/api/world-boss-event');
  assert.equal(view.body.queue.match.status,'cancelled');
  for(const name of f.names) assert.equal(await kv.get(`battle-lock:${name}`),null);
  evidence.push({case:'moved teammate',error:view.body.queue.match.error});
});

test('HTTP: direct damage banks once, updates individual/village/clan standings, and repeat raid reward is once per event',async()=>{
  const f=await launch('credit'); const {s,p,boss}=await setupCombat(f);
  const hit=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id});
  assert.equal(hit.body.applied,true,JSON.stringify(hit.body));
  const played=await tower.readSession(f.runId); const damage=played.worldBossContributions[f.names[0]].damage; assert.ok(damage>0);
  played.status='done'; played.winner='enemy'; await tower.writeSession(played);
  const paid=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId}); assert.equal(paid.status,200,JSON.stringify(paid.body));
  assert.equal(paid.body.bankedDamage,damage); assert.equal(paid.body.reward.ryo,2500);
  const before=await kv.get(`save:${f.names[0]}`); assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).status,200);
  assert.deepEqual(await kv.get(`save:${f.names[0]}`),before);
  const board=await f.clients[0]('/api/world-boss-event'); assert.equal(board.body.personalRank,1);
  assert.equal(board.body.standings.individual[0].damage,damage); assert.ok(board.body.standings.individual[0].points>=damage);
  assert.equal(board.body.standings.villages[0].name,'Moonshadow Village'); assert.equal(board.body.standings.clans[0].name,'Audit North');
  assert.equal((await events.readWorldBossEvent(f.event.eventId)).participants[f.names[0]].matches,1);
  for(const name of f.names) assert.equal(await kv.get(`battle-lock:${name}`),null);
  for(let i=0;i<3;i++) assert.equal((await join(f,i)).status,200);
  const next=await f.clients[0]('/api/world-boss-event'); assert.notEqual(next.body.queue.match.runId,f.runId);
  const second={...f,runId:next.body.queue.match.runId}; const prepared=await setupCombat(second);
  const hit2=await f.clients[0]('/api/towers/action',{runId:second.runId,type:'jutsu',jutsuId:'audit-strike',targetId:prepared.boss.id});
  assert.equal(hit2.body.applied,true); const end=await tower.readSession(second.runId);end.status='done';end.winner='enemy';await tower.writeSession(end);
  assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:second.runId})).status,200);
  assert.equal((await kv.get(`save:${f.names[0]}`)).character.ryo,before.character.ryo);
  evidence.push({case:'damage standings once per event',damage,points:board.body.standings.individual[0].points,ryo:before.character.ryo});
});

for(const lethal of [false,true]) test(`REGRESSION: ${lethal?'lethal':'nonlethal'} round-end Wound must bank its boss damage`,async()=>{
  const f=await launch(lethal?'dot-kill':'dot',undefined,1); const {s,p,boss}=await setupCombat(f,lethal?1000:undefined);
  s.turnQueue=[p.id];s.activeIndex=0;s.activeAp=100;
  boss.statuses=[{name:'Wound',rounds:3,amount:5000,kind:'negative',activeRound:s.round,source:'audit-player-wound'}];
  await tower.writeSession(s); const before=boss.hp;
  const action=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'wait'}); assert.equal(action.body.applied,true,JSON.stringify(action.body));
  const played=await tower.readSession(f.runId);const actual=before-played.actors.find((a:any)=>a.id===boss.id).hp;assert.ok(actual>0);
  const credited=played.worldBossContributions[f.names[0]]?.damage??0;
  if(!lethal){played.status='done';played.winner='enemy';await tower.writeSession(played);} else assert.equal(played.status,'done');
  const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});
  evidence.push({case:lethal?'lethal round-end Wound':'round-end Wound',actualBossDamage:actual,credited,raidWinner:played.winner,settleStatus:settled.status,bankedDamage:settled.body.bankedDamage,eventHp:settled.body.hpRemaining});
  assert.equal(settled.body.bankedDamage,actual,'Real round-end damage must reduce shared event HP');
});

test('REGRESSION: retained prototype-shaped account receives finite credit and appears on standings',async()=>{
  const f=await launch('legacy-name',['__proto__','audit-legacy-name-b','audit-legacy-name-c'],1);const {boss}=await setupCombat(f);
  const hit=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id});
  assert.equal(hit.body.applied,true,JSON.stringify(hit.body));const played=await tower.readSession(f.runId);
  const hasOwn=Object.hasOwn(played.worldBossContributions,'__proto__');
  played.status='done';played.winner='enemy';await tower.writeSession(played);
  const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});const board=await f.clients[0]('/api/world-boss-event');
  evidence.push({case:'retained __proto__ identity',hasOwnContribution:hasOwn,settleStatus:settled.status,bankedDamage:settled.body.bankedDamage,contribution:settled.body.contribution,leaderboard:board.body.standings?.individual,personalRank:board.body.personalRank});
  assert.ok(hasOwn,'Contribution must survive storage as an own property');assert.equal(board.body.personalRank,1);
});

test('REGRESSION: summoned pet damage during AI advancement must bank for its owner',async()=>{
  const f=await launch('pet',undefined,1);const {s,p,boss}=await setupCombat(f);
  const {companionActor}=await import('../towers/_companion.js');
  const pet=companionActor({petId:'audit-pet',name:'Audit companion',hp:5000,damage:2200,happiness:100,loyal:true,moves:[],pveGearId:''},boss.pos+1);
  s.actors.push(pet);s.turnQueue=[p.id,pet.id];s.activeIndex=0;s.activeAp=100;
  await tower.writeSession(s);const before=boss.hp;
  const hit=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'wait'});assert.equal(hit.body.applied,true);
  const played=await tower.readSession(f.runId);const damage=before-played.actors.find((a:any)=>a.id===boss.id).hp;assert.ok(damage>0);
  played.status='done';played.winner='enemy';await tower.writeSession(played);
  const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});
  evidence.push({case:'pet AI turn',actualBossDamage:damage,credited:played.worldBossContributions[f.names[0]]?.damage??0,bankedDamage:settled.body.bankedDamage});
  assert.equal(settled.body.bankedDamage,damage,'Verified companion damage must reduce shared HP');
});

test('REGRESSION: match publication failure recovers the same published encounter',async t=>{
  const f=await fixture('publish');await join(f,0);await join(f,1);
  const set=kv.set.bind(kv);let injected=false;
  const stub=t.mock.method(kv,'set',async(...args:any[])=>{
    if(!injected && String(args[0]).includes(':match:') && args[1]?.status==='active'){injected=true;throw new Error('audit injected active match write failure');}
    return set(...args);
  });
  t.mock.method(console,'error',()=>{});await join(f,2);stub.mock.restore();assert.ok(injected);
  const view=await f.clients[0]('/api/world-boss-event');const match=view.body.queue.match;
  const s=await tower.readSession(match.runId);const state=await f.clients[0](`/api/towers/state?runId=${match.runId}`);
  const leases=await Promise.all(f.names.map((name:string)=>kv.get(`battle-lock:${name}`)));
  evidence.push({case:'active match publication failure',matchStatus:match.status,sessionStatus:s?.status,stateStatus:state.status,reacquiredLeases:leases.map(Boolean)});
  assert.equal(match.status,'active');assert.equal(s.status,'active');assert.equal(state.status,200);
  assert.ok(leases.every(Boolean));
  const again=await queue.ensureWorldBossMatchStarted(f.event.eventId,match.matchId);
  assert.equal(again.runId,match.runId);assert.deepEqual((await tower.readSession(match.runId)).actors,s.actors);
});

test('a cast Wound keeps its caster credit when another player closes the round',async()=>{
 const f=await launch('owned-wound',undefined,2);const {s,p,boss}=await setupCombat(f);
 p.character.jutsu[0].tags=[{name:'Wound',percent:25}];await tower.writeSession(s);
 const cast=await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id});assert.equal(cast.body.applied,true);
 const afterCast=await tower.readSession(f.runId);const target=afterCast.actors.find((a:any)=>a.id===boss.id);
 const wound=target.statuses.find((status:any)=>status.name==='Wound');assert.ok(wound);assert.equal(wound.worldBossOwnerSlug,f.names[0]);
 const direct=afterCast.worldBossContributions[f.names[0]].damage;const other=afterCast.actors.find((a:any)=>a.ownerSlug===f.names[1]);
 afterCast.round=Math.max(afterCast.round,wound.activeRound??afterCast.round);afterCast.turnQueue=[other.id];afterCast.activeIndex=0;afterCast.activeAp=100;
 afterCast.turnStartedAt=Date.now();await tower.writeSession(afterCast);const before=target.hp;
 const tick=await f.clients[1]('/api/towers/action',{runId:f.runId,type:'wait',moveToken:'owned_wound_end_turn_0001'});assert.equal(tick.body.applied,true);
 const advanced=await tower.readSession(f.runId);const delta=before-advanced.actors.find((a:any)=>a.id===boss.id).hp;assert.ok(delta>0);
 assert.equal(advanced.worldBossContributions[f.names[0]].damage,direct+delta);assert.equal(advanced.worldBossContributions[f.names[1]].damage,0);
 const replay=await f.clients[1]('/api/towers/action',{runId:f.runId,type:'wait',moveToken:'owned_wound_end_turn_0001'});assert.equal(replay.body.replayed,true);
 assert.deepEqual(replay.body.session.worldBossContributions,advanced.worldBossContributions);
});

test('mixed-owner Wound and Drain ticks clamp overkill without duplicate credit',async()=>{
 const f=await launch('mixed-wound',undefined,2);const {s,boss}=await setupCombat(f,1000);
 boss.statuses=[{name:'Wound',amount:700,rounds:2,kind:'negative',worldBossOwnerSlug:f.names[0]},
  {name:'Drain',amount:5000,rounds:2,kind:'negative',worldBossOwnerSlug:f.names[1]}];
 const closer=s.actors.find((a:any)=>a.ownerSlug===f.names[1]);s.turnQueue=[closer.id];s.activeIndex=0;s.activeAp=100;await tower.writeSession(s);
 const tick=await f.clients[1]('/api/towers/action',{runId:f.runId,type:'wait'});assert.equal(tick.body.applied,true);
 assert.equal(tick.body.session.worldBossContributions[f.names[0]].damage,700);
 assert.equal(tick.body.session.worldBossContributions[f.names[1]].damage,300);
 assert.equal((await f.clients[1]('/api/world-boss-event/settle',{runId:f.runId})).body.bankedDamage,1000);
});

test('concurrent member settlements bank the team once and preserve both rewards',async()=>{
 const f=await launch('two-settle',undefined,2);const first=await setupCombat(f);
 assert.equal((await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:first.boss.id})).body.applied,true);
 const s=await tower.readSession(f.runId);const b=s.actors.find((a:any)=>a.ownerSlug===f.names[1]);const boss=s.actors.find((a:any)=>a.id===s.phaseState.bossId);
 b.character.jutsu=first.p.character.jutsu;b.character.jutsuMastery=first.p.character.jutsuMastery;
 boss.pos=b.pos+(b.pos%s.map.width===s.map.width-1?-1:1);s.activeIndex=s.turnQueue.indexOf(b.id);s.activeAp=100;s.actionsThisTurn=0;s.turnStartedAt=Date.now();await tower.writeSession(s);
 assert.equal((await f.clients[1]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id})).body.applied,true);
 const done=await tower.readSession(f.runId);done.status='done';done.winner='enemy';await tower.writeSession(done);
 const damage=Object.values(done.worldBossContributions).reduce((sum:number,c:any)=>sum+c.damage,0);
 const paid=await Promise.all([f.clients[0]('/api/world-boss-event/settle',{runId:f.runId}),f.clients[1]('/api/world-boss-event/settle',{runId:f.runId})]);
 assert.ok(paid.every(r=>r.status===200),JSON.stringify(paid));assert.ok(paid.every(r=>r.body.bankedDamage===damage));
 assert.equal((await events.readWorldBossEvent(f.event.eventId)).hp,600000-damage);
 for(const name of f.names.slice(0,2))assert.equal((await kv.get(`save:${name}`)).character.ryo,2500);
 const again=await Promise.all([f.clients[0]('/api/world-boss-event/settle',{runId:f.runId}),f.clients[1]('/api/world-boss-event/settle',{runId:f.runId})]);
 assert.ok(again.every(r=>r.status===200));assert.equal((await events.readWorldBossEvent(f.event.eventId)).settledMatchIds.length,1);
});

async function waitingTrio(id:string){
 const f=await fixture(id);const now=Date.now();
 const tickets=f.names.map((slug:string)=>({ticketId:`ticket-${slug}`,slug,name:slug,village:'Moonshadow Village',clan:'Audit Team',joinedAt:now}));
 await events.writeWorldBossQueue(f.event.eventId,{tickets,activeMatchIds:[],updatedAt:now});
 for(const ticket of tickets)await events.writeWorldBossPlayerPointer(f.event.eventId,ticket.slug,{ticketId:ticket.ticketId,status:'queued',updatedAt:now});
 return f;
}

test('repeat join delayed after preflight cannot replace a concurrently formed team pointer',async t=>{
 const f=await waitingTrio('delayed-join');const set=kv.set.bind(kv);let paused=false,release!:()=>void,arrived!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{arrived=resolve});
 const stub=t.mock.method(kv,'set',async(...args:any[])=>{
  if(!paused && args[0]===`lock:${events.worldBossEventKey(f.event.eventId)}` && args[2]?.nx){paused=true;arrived();await gate;}
  return set(...args);
 });
 const delayed=join(f,0);await entered;
 try{await queue.tickWorldBossQueue(f.event.eventId);}finally{release();}
 const result=await delayed;stub.mock.restore();assert.equal(result.status,409);
 const q=await events.readWorldBossQueue(f.event.eventId);assert.equal(q.tickets.length,0);assert.equal(q.activeMatchIds.length,1);
 const pointer=await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]);assert.equal(pointer.status,'active');assert.equal(pointer.matchId,q.activeMatchIds[0]);
});

for(const landed of [false,true])test(`formation transaction ${landed?'lost acknowledgement':'failure before commit'} is recoverable without duplicate teams`,async t=>{
 const f=await waitingTrio(landed?'formation-ack':'formation-fail');const commit=kv.compareSetMany.bind(kv);let fail=true;
 const stub=t.mock.method(kv,'compareSetMany',async(ops:any[])=>{
  if(fail && ops.some(op=>op.key===events.worldBossQueueKey(f.event.eventId))){fail=false;if(landed)await commit(ops);throw new Error('audit formation transaction fault');}
  return commit(ops);
 });
 await assert.rejects(()=>queue.tickWorldBossQueue(f.event.eventId));stub.mock.restore();
 const prior=await events.readWorldBossQueue(f.event.eventId);assert.equal(prior.tickets.length,landed?0:3);assert.equal(prior.activeMatchIds.length,landed?1:0);
 await queue.tickWorldBossQueue(f.event.eventId);const recovered=await events.readWorldBossQueue(f.event.eventId);
 assert.equal(recovered.tickets.length,0);assert.equal(recovered.activeMatchIds.length,1);
 assert.equal((await kv.keys(`${events.worldBossEventKey(f.event.eventId)}:match:*`)).length,1);
 for(const name of f.names){const pointer=await events.readWorldBossPlayerPointer(f.event.eventId,name);assert.equal(pointer.status,'active');assert.equal(pointer.matchId,recovered.activeMatchIds[0]);}
});

for(const where of ['session-ack','active-match-persistent','active-pointer'])test(`${where} publication fault retains one resumable encounter`,async t=>{
 const f=await waitingTrio(`publication-${where}`);const set=kv.set.bind(kv);let injected=false,attempts=0;
 const stub=t.mock.method(kv,'set',async(...args:any[])=>{
  const key=String(args[0]);const matches=where==='session-ack'?key.startsWith('tower:')&&args[1]?.worldBossEvent?.eventId===f.event.eventId
   :where==='active-pointer'?key.includes(f.event.eventId)&&key.includes(':player:')&&args[1]?.status==='active'
   :key.includes(f.event.eventId)&&key.includes(':match:')&&args[1]?.status==='active';
  if(matches && (!injected || where==='active-match-persistent')){injected=true;attempts++;if(where==='session-ack')await set(...args);throw new Error('audit publication fault');}
  return set(...args);
 });
 const pointerCas=kv.compareSet.bind(kv);
 const pointerStub=t.mock.method(kv,'compareSet',async(...args:any[])=>{
  if(where==='active-pointer'&&!injected&&String(args[0]).includes(f.event.eventId)&&String(args[0]).includes(':player:')&&args[2]?.status==='active'){injected=true;throw new Error('audit pointer CAS fault');}
  return pointerCas(...args);
 });
 if(where==='active-match-persistent')await assert.rejects(()=>queue.tickWorldBossQueue(f.event.eventId));else await queue.tickWorldBossQueue(f.event.eventId);
 assert.ok(injected);const prior=await events.readWorldBossQueue(f.event.eventId);const match=await events.readWorldBossMatch(f.event.eventId,prior.activeMatchIds[0]);
 const session=await tower.readSession(match.runId);assert.ok(session);assert.notEqual(match.status,'cancelled');
 for(const name of f.names)assert.ok(await kv.get(`battle-lock:${name}`));
 stub.mock.restore();pointerStub.mock.restore();await queue.tickWorldBossQueue(f.event.eventId);
 const view=await f.clients[0]('/api/world-boss-event');assert.equal(view.body.queue.match.status,'active');assert.equal(view.body.queue.match.runId,match.runId);
 assert.deepEqual(view.body.queue.match.session.actors,session.actors);assert.equal((await kv.keys(`${events.worldBossEventKey(f.event.eventId)}:match:*`)).length,1);
});

test('a second teammate summons and owns its pet damage rather than crediting the first member',async()=>{
 const f=await launch('second-pet',undefined,2);const {s,p,boss}=await setupCombat(f);
 const b=s.actors.find((a:any)=>a.ownerSlug===f.names[1]);s.turnQueue=[b.id,p.id];s.activeIndex=0;s.activeAp=100;
 boss.pos=b.pos+(b.pos%s.map.width===s.map.width-1?-1:1);
 s.pendingCompanion={petId:'audit-owned-pet',name:'Owned audit pet',hp:5000,damage:2200,happiness:100,loyal:true,moves:[],pveGearId:''};await tower.writeSession(s);
 const summoned=await f.clients[1]('/api/towers/action',{runId:f.runId,type:'summon'});assert.equal(summoned.body.applied,true,JSON.stringify(summoned.body));
 const pet=summoned.body.session.actors.find((a:any)=>a.character.companion===true);assert.equal(pet.ownerSlug,f.names[1]);
 const before=summoned.body.session.actors.find((a:any)=>a.id===boss.id).hp;
 const turn=await f.clients[1]('/api/towers/action',{runId:f.runId,type:'wait'});assert.equal(turn.body.applied,true);
 const damage=before-turn.body.session.actors.find((a:any)=>a.id===boss.id).hp;assert.ok(damage>0);
 assert.equal(turn.body.session.worldBossContributions[f.names[1]].damage,damage);
 assert.equal(turn.body.session.worldBossContributions[f.names[0]]?.damage??0,0);
});

test('on-spend Poison credits its known owner when the boss casts and clamps its lethal damage',async()=>{
 const f=await launch('poison-spend',undefined,2);const {s,p,boss}=await setupCombat(f,7);
 boss.statuses=[{name:'Poison',percent:15,rounds:3,activeRound:s.round,kind:'negative',worldBossOwnerSlug:f.names[0]}];
 boss.character.jutsu=[{id:'poison-spend-buff',name:'Poison spend buff',type:'Ninjutsu',target:'SELF',ap:60,chakraCost:350,range:0,effectPower:0,tags:[{name:'Increase Damage Given',percent:20}]}];
 boss.character.jutsuMastery=[{jutsuId:'poison-spend-buff',level:50}];s.turnQueue=[boss.id,p.id];s.activeIndex=0;s.activeAp=100;
 const {applyAction}=await import('../towers/_engine.js');const result=applyAction(s,s.encounterFloor,{actorId:boss.id,type:'jutsu',jutsuId:'poison-spend-buff',targetId:boss.id},()=>.5);
 assert.equal(result.applied,true);assert.equal(boss.hp,0);assert.equal(s.worldBossContributions[f.names[0]].damage,7);
 assert.equal(s.worldBossContributions[f.names[1]]?.damage??0,0);await tower.writeSession(s);
 const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});assert.equal(settled.status,200);assert.equal(settled.body.bankedDamage,7);
});

test('an invalid action does not mutate retained effect metadata',async()=>{
 const f=await launch('invalid-effect',undefined,1);const {s,p,boss}=await setupCombat(f);
 boss.statuses=[{name:'Wound',amount:50,rounds:2,kind:'negative'}];const before=structuredClone(boss.statuses);
 const {applyAction}=await import('../towers/_engine.js');
 assert.equal(applyAction(s,s.encounterFloor,{actorId:p.id,type:'jutsu',jutsuId:'missing-jutsu'},()=>.5).applied,false);
 assert.deepEqual(boss.statuses,before);
});

// Independent review regressions. Race gates observe CAS rather than the retired unconditional writer.
for (const kind of ['Reflect', 'Recoil', 'itemReflect']) test(`INDEPENDENT: ${kind} damage on a boss action is attributed`, async () => {
  const f=await launch(`reactive-${kind.toLowerCase()}`,undefined,1);const {s,p,boss}=await setupCombat(f);
  p.hp=p.maxHp=100000;p.character.hp=p.character.maxHp=100000;p.shield=0;
  if(kind==='itemReflect') p.character.itemReflectPct=30;
  else p.character.jutsu=[{id:'audit-reactive',name:'Audit reactive',type:'Ninjutsu',target:kind==='Reflect'?'SELF':'OPPONENT',ap:60,range:4,effectPower:0,tags:[{name:kind,percent:30}]}];
  p.character.jutsuMastery=[{jutsuId:'audit-reactive',level:50}];await tower.writeSession(s);
  if(kind!=='itemReflect') assert.equal((await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-reactive',targetId:kind==='Reflect'?p.id:boss.id})).body.applied,true);
  const active=await tower.readSession(f.runId);const bp=active.actors.find((a:any)=>a.id===boss.id);const pp=active.actors.find((a:any)=>a.id===p.id);
  bp.character.jutsu=[{id:'audit-boss-hit',name:'Audit boss hit',type:'Taijutsu',ap:60,range:4,effectPower:2000}];
  bp.character.jutsuMastery=[{jutsuId:'audit-boss-hit',level:50}];active.turnQueue=[bp.id,pp.id];active.activeIndex=0;active.activeAp=100;active.actionsThisTurn=0;
  active.round=Math.max(active.round,...[...bp.statuses,...pp.statuses].map((x:any)=>x.activeRound??0));
  const before=bp.hp;const creditedBefore=active.worldBossContributions?.[f.names[0]]?.damage??0;
  const {applyAction}=await import('../towers/_engine.js');
  assert.equal(applyAction(active,active.encounterFloor,{actorId:bp.id,type:'jutsu',jutsuId:'audit-boss-hit',targetId:pp.id},()=>.5).applied,true);
  const actual=before-bp.hp;assert.ok(actual>0,JSON.stringify(active.log.slice(-10)));
  const credited=(active.worldBossContributions?.[f.names[0]]?.damage??0)-creditedBefore;
  console.log('INDEPENDENT_REACTIVE',JSON.stringify({kind,actual,credited,unknown:active.worldBossUnattributedDamage??0,log:active.log.slice(-6)}));
  active.status='done';active.winner='enemy';await tower.writeSession(active);
  const paid=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});
  console.log('INDEPENDENT_REACTIVE_SETTLE',JSON.stringify({kind,status:paid.status,banked:paid.body.bankedDamage,actual,creditedBefore}));
  assert.equal(credited,actual,'Actual boss HP loss must belong to the source player');
});

for(const landed of [false,true]) test(`INDEPENDENT: settlement event write ${landed?'lost acknowledgement':'precommit failure'} retries once`,async t=>{
 const f=await launch(`settle-fault-${landed}`,undefined,1);const {boss}=await setupCombat(f);
 assert.equal((await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id})).body.applied,true);
 const done=await tower.readSession(f.runId);done.status='done';done.winner='enemy';await tower.writeSession(done);
 const expected=done.worldBossContributions[f.names[0]].damage;const set=kv.set.bind(kv);let injected=false;
 const stub=t.mock.method(kv,'set',async(...args:any[])=>{
  if(!injected&&args[0]===events.worldBossEventKey(f.event.eventId)&&args[1]?.settledMatchIds?.includes(f.matchId)){injected=true;if(landed)await set(...args);throw new Error('independent settlement fault');}
  return set(...args);
 });
 const first=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});stub.mock.restore();assert.ok(injected);assert.notEqual(first.status,200);
 const second=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});assert.equal(second.status,200,JSON.stringify(second));
 const event=await events.readWorldBossEvent(f.event.eventId);assert.equal(event.hp,600000-expected);assert.equal(event.participants[f.names[0]].matches,1);
 assert.equal((await kv.get(`save:${f.names[0]}`)).character.ryo,2500);assert.equal(second.body.bankedDamage,expected);
});

for(const landed of [false,true])test(`INDEPENDENT: action write ${landed?'lost acknowledgement':'precommit failure'} replays once`,async t=>{
 const f=await launch(`action-fault-${landed}`,undefined,1);const {boss}=await setupCombat(f);const set=kv.set.bind(kv);let injected=false;
 const action={runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id,moveToken:`independent_action_write_${landed}`};
 const stub=t.mock.method(kv,'set',async(...args:any[])=>{
  if(!injected&&args[0]===`tower:${f.runId}`&&args[1]?.worldBossContributions?.[f.names[0]]?.damage>0){injected=true;if(landed)await set(...args);throw new Error('independent action write fault');}
  return set(...args);
 });
 const first=await f.clients[0]('/api/towers/action',action);stub.mock.restore();assert.ok(injected);assert.notEqual(first.status,200);
 const second=await f.clients[0]('/api/towers/action',action);assert.equal(second.status,200,JSON.stringify(second));assert.equal(second.body.applied,true);
 const state=await tower.readSession(f.runId);assert.equal(state.worldBossContributions[f.names[0]].actions,1);assert.equal(state.worldBossContributions[f.names[0]].damage,boss.hp-state.actors.find((a:any)=>a.id===boss.id).hp);
});

for(const name of ['constructor','tostring'])test(`INDEPENDENT: retained ${name} identity survives the lifecycle`,async()=>{
 const f=await launch(`proto-${name}`,[name,`audit-${name}-b`,`audit-${name}-c`],1);const {boss}=await setupCombat(f);
 assert.equal((await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id})).body.applied,true);
 const done=await tower.readSession(f.runId);done.status='done';done.winner='enemy';await tower.writeSession(done);
 assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).status,200);
 assert.equal((await f.clients[0]('/api/world-boss-event')).body.personalRank,1);
});

test('INDEPENDENT: stale publication pointer repair cannot erase a newer match',async t=>{
 const f=await launch('pointer-repair-race',undefined,1);const prepared=await setupCombat(f);
 await events.writeWorldBossPlayerPointer(f.event.eventId,f.names[0],{matchId:f.matchId,status:'preparing',updatedAt:Date.now()});
 const set=kv.compareSet.bind(kv);let paused=false,release!:()=>void,arrive!:()=>void;
 const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrive=r});
 const stub=t.mock.method(kv,'compareSet',async(...args:any[])=>{
  if(!paused&&args[0]===events.worldBossPlayerKey(f.event.eventId,f.names[0])&&args[2]?.status==='active'&&args[2]?.matchId===f.matchId){paused=true;arrive();await gate;}
  return set(...args);
 });
 const stale=queue.worldBossQueueView(f.event,f.names[0]);await entered;
 let newId:string;
 try{
  prepared.s.status='done';prepared.s.winner='enemy';await tower.writeSession(prepared.s);
  assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).status,200);
  assert.equal((await join(f,0)).status,200);
  const waiting=await events.readWorldBossQueue(f.event.eventId);waiting.tickets[0].joinedAt-=31000;await events.writeWorldBossQueue(f.event.eventId,waiting);
  await queue.tickWorldBossQueue(f.event.eventId);
  const newer=await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]);newId=newer.matchId;assert.notEqual(newId,f.matchId);
 }finally{release();}
 await stale;stub.mock.restore();const actual=await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]);
 console.log('INDEPENDENT_POINTER_RACE',JSON.stringify({oldMatch:f.matchId,newMatch:newId!,actualPointer:actual}));
 assert.equal(actual.matchId,newId!,'A stale repair must not replace the new active run pointer');
});

test('INDEPENDENT: delayed settlement pointer write cannot erase a newer match',async t=>{
 const f=await launch('settle-pointer-race',undefined,1);const {s}=await setupCombat(f);s.status='done';s.winner='enemy';await tower.writeSession(s);
 const set=kv.compareSet.bind(kv);let paused=false,release!:()=>void,arrive!:()=>void;
 const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrive=r});
 const stub=t.mock.method(kv,'compareSet',async(...args:any[])=>{
  if(!paused&&args[0]===events.worldBossPlayerKey(f.event.eventId,f.names[0])&&args[2]?.status==='settled'&&args[2]?.matchId===f.matchId){paused=true;arrive();await gate;}
  return set(...args);
 });
 const settling=f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});await entered;let newId:string;
 try{
  assert.equal((await join(f,0)).status,200);
  const waiting=await events.readWorldBossQueue(f.event.eventId);waiting.tickets[0].joinedAt-=31000;await events.writeWorldBossQueue(f.event.eventId,waiting);
  await queue.tickWorldBossQueue(f.event.eventId);newId=(await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0])).matchId;assert.notEqual(newId,f.matchId);
 }finally{release();}
 assert.equal((await settling).status,200);stub.mock.restore();const actual=await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]);
 console.log('INDEPENDENT_SETTLE_POINTER_RACE',JSON.stringify({oldMatch:f.matchId,newMatch:newId!,actualPointer:actual}));
 assert.equal(actual.matchId,newId!,'An old settlement must not replace the new active run pointer');
});


async function reactiveFixture(id:string,count=2,hp=100000) {
 const f=await launch(id,undefined,count);const {s,p,boss}=await setupCombat(f,hp);
 for(const a of s.actors.filter((a:any)=>a.side==='squad'&&!a.ai)){a.hp=a.maxHp=1000000;a.character.hp=a.character.maxHp=1000000;a.shield=0;}
 boss.character.jutsu=[{id:'review-boss-hit',name:'Review boss hit',type:'Taijutsu',ap:60,range:4,effectPower:2000}];
 boss.character.jutsuMastery=[{jutsuId:'review-boss-hit',level:50}];s.turnQueue=[boss.id,...s.actors.filter((a:any)=>a.side==='squad'&&!a.ai).map((a:any)=>a.id)];s.activeIndex=0;s.activeAp=100;s.actionsThisTurn=0;
 return {f,s,p,boss};
}

test('reactive overkill divides Reflect between its casters and does not count later reactions after zero HP',async()=>{
 const {f,s,p,boss}=await reactiveFixture('reflect-overkill',2,9000);
 p.statuses=[{name:'Reflect',rounds:2,percent:10,kind:'positive',worldBossOwnerSlug:f.names[0]},{name:'Reflect',rounds:2,percent:20,kind:'positive',worldBossOwnerSlug:f.names[1]}];
 p.character.itemReflectPct=30;boss.statuses=[{name:'Recoil',rounds:2,percent:30,kind:'negative',worldBossOwnerSlug:f.names[1]}];
 const {applyAction}=await import('../towers/_engine.js');
 assert.equal(applyAction(s,s.encounterFloor,{actorId:boss.id,type:'jutsu',jutsuId:'review-boss-hit',targetId:p.id},()=>.5).applied,true);
 assert.equal(boss.hp,0);assert.equal(s.worldBossContributions[f.names[0]].damage,3000);assert.equal(s.worldBossContributions[f.names[1]].damage,6000);
 s.status='done';s.winner='squad';await tower.writeSession(s);
 const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});assert.equal(settled.status,200);assert.equal(settled.body.bankedDamage,9000);
});

test('boss AOE equipment reflection credits each defender once and excludes the speculative primary receipt',async()=>{
 const {f,s,p,boss}=await reactiveFixture('reflect-aoe');const other=s.actors.find((a:any)=>!a.ai&&a.ownerSlug===f.names[1]);
 p.pos=20;other.pos=21;boss.pos=10;s.map.blockedTiles=[];s.map.hazardTiles=[];
 p.character.itemReflectPct=30;other.character.itemReflectPct=30;boss.character.jutsu[0].method='AOE_BURST';
 const before=boss.hp;const {applyAction}=await import('../towers/_engine.js');
 assert.equal(applyAction(s,s.encounterFloor,{actorId:boss.id,type:'jutsu',jutsuId:'review-boss-hit',targetId:p.id},()=>.5).applied,true);
 const a=s.worldBossContributions[f.names[0]]?.damage??0,b=s.worldBossContributions[f.names[1]]?.damage??0;
 assert.ok(a>0&&b>0,JSON.stringify(s.log.slice(-12)));assert.equal(a+b,before-boss.hp);
 s.status='done';s.winner='enemy';await tower.writeSession(s);assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).body.bankedDamage,a+b);
});

test('retained unknown Reflect banks damage separately from the defender equipment owner',async()=>{
 const {f,s,p,boss}=await reactiveFixture('reflect-retained',1);
 p.statuses=[{name:'Reflect',rounds:2,percent:30,kind:'positive'}];p.character.itemReflectPct=30;
 const before=boss.hp;const {applyAction}=await import('../towers/_engine.js');
 assert.equal(applyAction(s,s.encounterFloor,{actorId:boss.id,type:'jutsu',jutsuId:'review-boss-hit',targetId:p.id},()=>.5).applied,true);
 const known=s.worldBossContributions[f.names[0]].damage,unknown=s.worldBossUnattributedDamage;
 assert.ok(known>0&&unknown>0);assert.equal(known+unknown,before-boss.hp);
 s.status='done';s.winner='enemy';await tower.writeSession(s);assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).body.bankedDamage,known+unknown);
});

for(const status of ['active','settled','cancelled'])test(`delayed ${status} match repair preserves a newer queued ticket`,async t=>{
 const f=await launch(`pointer-queued-${status}`,undefined,1);const prior=await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]);
 const cas=kv.compareSet.bind(kv);let release!:()=>void,arrive!:()=>void;const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrive=r});
 const stub=t.mock.method(kv,'compareSet',async(...args:any[])=>{if(args[0]===events.worldBossPlayerKey(f.event.eventId,f.names[0])){arrive();await gate;}return cas(...args);});
 const delayed=events.updateWorldBossMatchPointer(f.event.eventId,f.names[0],{matchId:f.matchId,status,updatedAt:Date.now()},prior);await entered;
 const ticket={ticketId:'review-new-ticket',status:'queued',updatedAt:Date.now()};await events.writeWorldBossPlayerPointer(f.event.eventId,f.names[0],ticket);release();
 assert.equal(await delayed,false);stub.mock.restore();assert.deepEqual(await events.readWorldBossPlayerPointer(f.event.eventId,f.names[0]),ticket);
});

test('settlement validates terminal state under the match lock after a stale active preflight',async t=>{
 const f=await launch('settle-stale-cache',undefined,1);const {boss}=await setupCombat(f);
 assert.equal((await f.clients[0]('/api/towers/action',{runId:f.runId,type:'jutsu',jutsuId:'audit-strike',targetId:boss.id})).body.applied,true);
 const done=await tower.readSession(f.runId);done.status='done';done.winner='enemy';await tower.writeSession(done);
 const damage=done.worldBossContributions[f.names[0]].damage;const get=kv.get.bind(kv);let stale=false;
 const stub=t.mock.method(kv,'get',async(...args:any[])=>{if(!stale&&args[0]===`tower:${f.runId}`){stale=true;return {...structuredClone(done),status:'active'};}return get(...args);});
 const settled=await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId});stub.mock.restore();assert.ok(stale);assert.equal(settled.status,200,JSON.stringify(settled));
 assert.equal(settled.body.bankedDamage,damage);assert.equal((await events.readWorldBossEvent(f.event.eventId)).hp,600000-damage);
 assert.equal((await f.clients[0]('/api/world-boss-event/settle',{runId:f.runId})).body.bankedDamage,damage);
});

test('queue admission reads battle leases under its lock and still refuses a genuinely active fight',async t=>{
 const f=await fixture('queue-stale-lease');const get=kv.get.bind(kv);const {currentKvLockContext}=await import('../_kv-lock-context.js');
 const old={battleId:'completed-old-run',kind:'battleTowers',screen:'battleTowers',startedAt:Date.now(),meta:{runId:'completed-old-run'}};let fresh=0,stale=0;
 const stub=t.mock.method(kv,'get',async(...args:any[])=>{if(args[0]===`battle-lock:${f.names[0]}`){if(!currentKvLockContext()){stale++;return old;}fresh++;}return get(...args);});
 const joined=await join(f,0);stub.mock.restore();assert.equal(joined.status,200,JSON.stringify(joined));assert.ok(fresh>0);assert.equal(stale,0);
 await kv.set(`battle-lock:${f.names[0]}`,old);assert.equal((await join(f,0)).status,409);
 assert.equal((await events.readWorldBossQueue(f.event.eventId)).tickets.length,1);
});
