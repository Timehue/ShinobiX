import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { SoloPveSession } from '../solo-pve/_session.js';

process.env.NODE_ENV='test';
process.env.SHINOBIX_QA_MEMORY_KV='1';
process.env.SESSION_SECRET='authored-mission-local-test-secret';
type Handler = (req: never,res: never)=>Promise<unknown>;
const routes = new Map<string,Handler>();
let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let fixtures: typeof import('../../scripts/mission-encounter-sim.js');
let engine: typeof import('../solo-pve/_engine.js');
let kits: typeof import('./_authored-mission-kits.js');
before(async()=>{
    ({kv}=await import('../_storage.js'));
    ({issuePlayerToken:token}=await import('../_auth.js'));
    fixtures=await import('../../scripts/mission-encounter-sim.js');
    engine=await import('../solo-pve/_engine.js');
    kits=await import('./_authored-mission-kits.js');
    const {registerApiRoutes}=await import('../../server-api-routes.js');
    registerApiRoutes((path,handler)=>routes.set(path,handler as Handler));
});
async function post(path:string,name:string,body:Record<string,unknown>,authenticated=true) {
    let code=200; let data:Record<string,any>={};
    const res={setHeader:()=>res,status:(n:number)=>{code=n;return res;},json:(b:Record<string,unknown>)=>{data=b;return res;},end:()=>res};
    const handler=routes.get(path); assert.ok(handler,`${path} must be mounted by production registerApiRoutes`);
    await handler({method:'POST',body:{playerName:name,...body},headers:authenticated?{'x-player-token':token(name)}:{},socket:{remoteAddress:'127.0.0.1'}} as never,res as never);
    return {code,data};
}
async function seed(name:string,level:number) {await kv.set(`save:${name}`,fixtures.missionPlayerSave(level,'Ninjutsu',name));}

describe('production-mounted ordinary mission journey (normal player authority)',()=>{
    it('enforces authentication, ownership, real admission, and rejects unearned rewards',async()=>{
        const name='authoredadmission'; await seed(name,14);
        assert.equal((await post('/missions/combat-start',name,{missionId:'combat-c-patrol'},false)).code,401);
        assert.equal((await post('/missions/combat-start',name,{missionId:'combat-c-patrol'})).code,403);
        await seed(name,15);
        const started=await post('/missions/combat-start',name,{missionId:'combat-c-patrol',enemy:{hp:1},jutsuIds:[],rules:[],maxChakra:0});
        assert.equal(started.code,200,JSON.stringify(started.data));
        const s=started.data.session as SoloPveSession;
        assert.ok(s.enemy.maxHp>1); assert.ok(s.enemy.chakra>0); assert.ok(s.enemy.character.aiRules);
        const falseWin=await post('/missions/queue-combat-claim',name,{missionId:'combat-c-patrol',runId:s.sessionId,outcome:'win'});
        assert.equal(falseWin.data.queued,false);
        const hijack=await post('/solo-pve/action','authoredintruder',{sessionId:s.sessionId,type:'flee',expectedVersion:s.version,moveToken:randomUUID()});
        assert.notEqual(hijack.code,200);
    });
    for(const [key,min] of [['combat-c-patrol',15],['combat-b-escort',30],['combat-a-hunt',50],['combat-s-crisis',70]] as const) {
        it(`${key}: startup, recovery, actual actions, vitals and exactly-once reward settlement`,async()=>{
            const name=`authored${min}`; await seed(name,min);
            const started=await post('/missions/combat-start',name,{missionId:key});
            assert.equal(started.code,200,JSON.stringify(started.data));
            let s=started.data.session as SoloPveSession;
            assert.equal(s.enemy.character.missionTactics,true);
            const sealedEnemy=structuredClone(s.enemy);
            const original=kits.AUTHORED_MISSION_KITS[key].jutsuIds[0];
            try {
                kits.AUTHORED_MISSION_KITS[key].jutsuIds[0]='missing-after-deploy';
                // Simulate a cold persistence read after content changes. No kit
                // reconstruction occurs on the mounted resume path.
                await kv.set(`solo-pve:${s.sessionId}`,JSON.parse(JSON.stringify(s)));
                const recovered=await post('/missions/combat-start',name,{missionId:key});
                assert.equal(recovered.code,200); assert.equal(recovered.data.resumed,true);
                assert.deepEqual(recovered.data.session.enemy,sealedEnemy);
            } finally {kits.AUTHORED_MISSION_KITS[key].jutsuIds[0]=original;}
            for(let guard=0;guard<150&&s.status==='active';guard++) {
                const action=fixtures.policyActions(s,'damage').find(a=>engine.applySoloPveAction(s,a).applied)!;
                const moveToken=randomUUID();
                const out=await post('/solo-pve/action',name,{sessionId:s.sessionId,expectedVersion:s.version,moveToken,...action,enemy:{hp:0},outcome:'win'});
                assert.equal(out.code,200,JSON.stringify(out.data));
                s=out.data.session;
                assert.ok(s);
            }
            assert.equal(s.outcome,'win');
            assert.ok(s.events.some(e=>e.actor==='enemy'&&e.action==='jutsu'));
            const saved=await kv.get<any>(`save:${name}`);
            assert.equal(saved.character.hp,s.player.hp);
            assert.equal(saved.character.chakra,s.player.chakra);
            assert.equal(saved.character.stamina,s.player.stamina);
            const queued=await post('/missions/queue-combat-claim',name,{missionId:key,runId:s.sessionId});
            assert.equal(queued.data.queued,true,JSON.stringify(queued));
            const claim=await post('/missions/claim-mission',name,{missionType:'combat',missionId:key});
            assert.equal(claim.code,200,JSON.stringify(claim));
            const first=await kv.get<any>(`save:${name}`);
            assert.ok(first.character.ryo>0);
            assert.equal(first.character.dailyMissionsCompleted,1);
            await post('/missions/claim-mission',name,{missionType:'combat',missionId:key});
            const replay=await kv.get<any>(`save:${name}`);
            assert.equal(replay.character.ryo,first.character.ryo);
            assert.equal(replay.character.dailyMissionsCompleted,1);
        });
    }
    it('flee and actual loss settle physical consequences without paying a mission reward',async()=>{
        for(const mode of ['flee','loss'] as const) {
            const name=`authored${mode}`;await seed(name,70);
            const out=await post('/missions/combat-start',name,{missionId:'combat-s-crisis'});
            assert.equal(out.code,200);
            let s=out.data.session as SoloPveSession;
            for(let guard=0;guard<30&&s.status==='active';guard++) {
                const next=await post('/solo-pve/action',name,{sessionId:s.sessionId,expectedVersion:s.version,moveToken:randomUUID(),type:mode==='flee'?'flee':'wait'});
                assert.equal(next.code,200,JSON.stringify(next)); s=next.data.session;
            }
            assert.equal(s.outcome,mode==='flee'?'fled':'loss');
            assert.equal((await post('/missions/queue-combat-claim',name,{missionId:'combat-s-crisis',runId:s.sessionId})).data.queued,false);
            const saved=await kv.get<any>(`save:${name}`);
            assert.equal(saved.character.ryo,0);assert.ok(saved.character.hp<=s.player.maxHp);
        }
    });
    it('a lapsed authored encounter settles the normal abandon cost once on reconnect',async()=>{
        const name='authoredtimeout';await seed(name,50);
        const out=await post('/missions/combat-start',name,{missionId:'combat-a-hunt'});
        assert.equal(out.code,200);
        const s=out.data.session as SoloPveSession;
        await kv.set(`solo-pve:${s.sessionId}`,{...s,expiresAt:Date.now()-1});
        const lapsed=await post('/solo-pve/state',name,{sessionId:s.sessionId});
        assert.equal(lapsed.code,410);assert.equal(lapsed.data.lapsed,true);
        assert.equal(lapsed.data.session.outcome,'loss');
        const first=await kv.get<any>(`save:${name}`);
        assert.equal(first.character.hp,s.player.hp-Math.floor(s.player.maxHp*0.1));
        await post('/solo-pve/state',name,{sessionId:s.sessionId});
        const replay=await kv.get<any>(`save:${name}`);
        assert.equal(replay.character.hp,first.character.hp);assert.equal(replay.character.ryo,0);
    });
});
