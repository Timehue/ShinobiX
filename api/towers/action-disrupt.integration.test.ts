import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createTowerSession, type TowerActor } from './_tower-session.js';
import { initializeTowerTactics } from './_combat-tactics.js';

process.env.NODE_ENV='test';
process.env.SHINOBIX_QA_MEMORY_KV='1';
process.env.ADMIN_PASSWORD='tower-disrupt-test-admin';
delete process.env.SESSION_SECRET;
let handler: (req: never, res: never) => Promise<unknown>;
let store: typeof import('./_tower-store.js');
before(async()=>{store=await import('./_tower-store.js');handler=(await import('./action.js')).default as unknown as typeof handler;});

test('the HTTP action path persists disruption, replays a lost response, and binds its target',async()=>{
    const actor:TowerActor={id:'sq',name:'Rill',side:'squad',ai:false,ownerSlug:'rill',pos:34,hp:1000,maxHp:1000,chakra:100,maxChakra:100,stamina:100,maxStamina:100,shield:0,statuses:[],cooldowns:{},character:{}};
    const session=createTowerSession({towerId:'celestial',runId:'disrupt-http',floor:1,seed:1,partySize:1,now:Date.now(),objectiveKind:'defeat-all',map:{width:16,height:10,blockedTiles:[],hazardTiles:[],objectiveTiles:[],features:[{kind:'pylon',tiles:[35],percent:20,element:'Fire',weakenElement:'Wind'}]},actors:[actor,{...structuredClone(actor),id:'enemy',name:'Enemy',side:'enemy',ai:true,ownerSlug:null,pos:60}]});
    initializeTowerTactics(session);session.round=1;session.turnQueue=['sq','enemy'];session.activeIndex=0;session.activeAp=100;Object.assign(session,{actionVersion:0});
    await store.writeSession(session);
    async function post(tile:number,token='disrupt-token-0001',type='disrupt',expectedVersion=0) {
        const output:{status:number;body?:Record<string,any>}={status:200};
        const res={setHeader:()=>res,status:(n:number)=>{output.status=n;return res;},json:(value:Record<string,any>)=>{output.body=value;return res;},end:()=>res};
        await handler({method:'POST',body:{runId:session.runId,playerName:'Rill',type,tile,moveToken:token,expectedVersion},headers:{'x-admin-password':process.env.ADMIN_PASSWORD},socket:{remoteAddress:'127.0.0.1'}} as never,res as never);return output;
    }
    const first=await post(35);assert.equal(first.status,200);assert.equal(first.body?.applied,true);assert.equal(first.body?.session.activeAp,60);
    const replay=await post(35);assert.equal(replay.status,200);assert.equal(replay.body?.replayed,true);assert.equal(replay.body?.session.activeAp,60);
    const changed=await post(36);assert.equal(changed.status,409);assert.equal(changed.body?.applied,false);
    const saved=await store.readSession(session.runId);assert.equal(saved?.activeAp,60);assert.deepEqual(saved?.towerTactics?.disruptedPylons,[35]);
    const internal=await post(35,'disrupt-token-0002','support',1);assert.equal(internal.status,400);
});
