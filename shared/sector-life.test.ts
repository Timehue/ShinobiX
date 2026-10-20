import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { SECTOR_ROAD_PAIRS, sectorExits } from './sector-links.js';
import { isWalkableTile, walkPath } from './sector-walk-mask.js';
import { advanceLifeEvent, lifeAnchors, lifeActorsAt, lifeActorPosition, lifeSceneView, LIFE_WORK_SITES, LIFE_WINDOW_MS, LIFE_ACTIVE_MS, lifeWindowAt, lifeEventView, parseLifeState, travelerRoute } from './sector-life.js';
import { WORLD_HOUR_MS } from './world-clock.js';
import { LIFE_EVENTS, LIFE_REGIONS, LIFE_STOP_REGIONS, LIFE_TRAVELERS, lifeRegionFor } from './sector-life-content.js';
import { COURIER_REST_MS } from './sector-life-courier.js';
import {DOCK_SHIPMENT_SCENARIO,DOCK_SHIPMENT_SITES} from './sector-dock-shipment.js';

const now = 100 * LIFE_WINDOW_MS + 60_000;
test('village workers keep their actual jobs while reacting to outsiders, even after an errand',()=>{
    for(const [sector,village] of [[2,'Stormveil Village'],[15,'Ashen Leaf Village'],[21,'Moonshadow Village'],[31,'Frostfang Village']] as const) {
        for(const step of [0,3]) {
            const state={...parseLifeState(null,now),step};
            const plain=lifeSceneView(sector,state,now,'clear');
            const home=lifeSceneView(sector,state,now,'clear',village);
            const rival=lifeSceneView(sector,state,now,'clear',village==='Frostfang Village'?'Ashen Leaf Village':'Frostfang Village');
            assert.match(home.actors[0].line,/Good to see one of ours/);
            assert(rival.actors[0].bark);
            assert(rival.actors[0].line.endsWith(plain.actors[0].line));
            assert.equal(rival.actors[0].workTile,plain.actors[0].workTile);
            assert.equal(rival.actors[0].activity,plain.actors[0].activity);
            assert.equal(rival.actors[0].wanderer.greeting,rival.actors[0].line);
            for(const visitor of rival.actors.filter(a=>a.traveler||a.id.startsWith('visitor:')||a.id.startsWith('courier:')))assert.equal(visitor.bark,undefined);
        }
    }
    assert.equal(lifeSceneView(42,parseLifeState(null,now),now,'clear','Frostfang Village').actors[0].bark,undefined,'neutral tea seller stays neutral');
    assert.equal(lifeSceneView(31,parseLifeState(null,now),now,'clear','forged village').actors[0].bark,undefined);
    assert(!lifeSceneView(26,parseLifeState(null,now),now,'clear','Ashen Leaf Village').actors[0].line.includes('supplies'),'unpainted guide does not claim supplies');
});
test('furniture dialogue belongs to painted workplaces and ordinary road checks use actual road mouths',()=>{
    for(const sector of PLAYABLE_WILD_SECTOR_IDS) {
        const profile=lifeRegionFor(sector);
        if(!LIFE_WORK_SITES[sector]) {
            for(const text of [profile.work,profile.greeting,profile.night,profile.shelter]) assert.doesNotMatch(text,/\b(crates|kettle|cups|stall|brazier|blankets|lamp stand|replacement lamps)\b/i,`${sector}: ${text}`);
            const exits=sectorExits(sector).map(exit=>exit.tile);
            for(const tile of lifeAnchors(sector).slice(0,2))assert(exits.includes(tile),`${sector}: checks must be at painted road approaches`);
        }
    }
    assert.deepEqual(Object.keys(LIFE_STOP_REGIONS),Object.keys(LIFE_WORK_SITES));
});
test('courier events have a present requester, an actual exit walk, and a departure that survives refresh',()=>{
    for(const sector of PLAYABLE_WILD_SECTOR_IDS) {
        let time=now;
        for(let i=0;i<3&&lifeEventView(sector,parseLifeState(null,time),time).kind!=='courier';i++)time+=LIFE_WINDOW_MS;
        if(lifeEventView(sector,parseLifeState(null,time),time).kind!=='courier')continue;
        const state=parseLifeState(null,time),before=lifeSceneView(sector,state,time,'clear');
        const requester=before.actors.find(a=>a.id===`courier:${sector}`);assert(requester);
        assert.equal(requester.activity,'Resting an injured ankle');
        const done={...state,step:3,updatedAt:time},helped=lifeSceneView(sector,done,time,'clear');
        const leaving=helped.actors.find(a=>a.id===requester.id)!;assert(leaving.motion);
        const last=leaving.motion.frames.at(-1)!;assert(sectorExits(sector).some(exit=>exit.tile===last[1]));
        for(let t=0;t<last[0];t+=700) {
            const pos=lifeActorPosition(sector,leaving,time+COURIER_REST_MS+t);
            assert(isWalkableTile(sector,Math.round(pos.row)*12+Math.round(pos.col)));
        }
        const departed=lifeSceneView(sector,done,time+COURIER_REST_MS+last[0]+5000,'clear');
        assert(!departed.actors.some(a=>a.id===requester.id));assert.match(departed.description,/courier has rested/);
        if(LIFE_WORK_SITES[sector])assert.equal(departed.actors[0].restTile,LIFE_WORK_SITES[sector].work);
    }
});
test('painted workplaces stay staffed at the scenery through every errand phase, weather and night',()=>{
    for(const sector of [2,15,31,42]) for(const time of [8*WORLD_HOUR_MS,21*WORLD_HOUR_MS]) for(const weather of ['clear','rain']) for(const step of [0,1,2,3]) {
        const state={...parseLifeState(null,time),step,...(sector===2?{scenario:DOCK_SHIPMENT_SCENARIO,...(step>=2?{shipmentAt:Math.floor(time/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+60_000}:{})}:{})};
        const scene=lifeSceneView(sector,state,time,weather),resident=scene.actors[0];
        const work=LIFE_WORK_SITES[sector].work;
        // Mina uses the original loading edge. The dockhand waits on the paved
        // road beside it, so a delivery never stacks two figures on one point.
        const dockStart=state.shipmentAt??Math.floor(time/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+LIFE_ACTIVE_MS;
        const staffed=sector===2&&time>=dockStart+6000?DOCK_SHIPMENT_SITES.worker:work;
        for(const offset of [0,10_000,60_000]) assert.deepEqual(lifeActorPosition(sector,resident,time+offset),{col:staffed%12,row:Math.floor(staffed/12),walking:false});
        assert.notEqual(resident.activity,'Work postponed');
        if(sector===15||sector===42) {
            assert.equal(scene.kind,'tea');assert.match(resident.name,/Tea Seller/);
            assert.doesNotMatch(scene.description,/packed|open another time/);
            if(step===3)assert(scene.actors.some(a=>a.id===`visitor:${sector}`&&a.restTile!==resident.restTile));
        }
    }
});
test('every work point is reachable and every routine stays on authored walkable ground', () => {
    for (const sector of PLAYABLE_WILD_SECTOR_IDS) {
        const anchors = lifeAnchors(sector);
        assert.equal(new Set(anchors).size, 3, `distinct work points: ${sector}`);
        for (const tile of anchors) { assert(isWalkableTile(sector,tile)); assert(walkPath(sector,anchors[2],tile)); }
        for (const weather of ['clear','rain','ashfall']) {
            const actors = lifeActorsAt(sector,now,weather);
            for (const actor of actors) for (let seconds=0;seconds<180;seconds+=.7) {
                const position = lifeActorPosition(sector,actor,now+seconds*1000);
                assert(isWalkableTile(sector,Math.round(position.row)*12+Math.round(position.col)), `${sector} ${actor.name}`);
                if (weather !== 'clear'&&!actor.traveler) assert.equal(position.walking,false);
            }
        }
    }
});
test('each recurring traveler enters from the previous road, rests, and leaves toward the next stop without cutting terrain',()=>{
    LIFE_TRAVELERS.forEach((traveler,index)=>{
        const route=travelerRoute(index);
        for(let slot=0;slot<route.length;slot++) {
            const stop=(slot+index*2)%route.length,sector=route[stop],start=slot*300_000;
            const actor=lifeActorsAt(sector,start,'clear').find(a=>a.id===traveler.id)!;
            const entry=sectorExits(sector).find(e=>e.destinationSector===route[(stop+route.length-1)%route.length])!;
            const exit=sectorExits(sector).find(e=>e.destinationSector===route[(stop+1)%route.length])!;
            const frames=actor.motion!.frames;
            assert.equal(frames[0][1],entry.tile);assert.equal(frames.at(-1)![1],exit.tile);
            assert.deepEqual(lifeActorPosition(sector,actor,start),{col:entry.tile%12,row:Math.floor(entry.tile/12),walking:frames[1][1]!==entry.tile});
            const resting=lifeActorPosition(sector,actor,start+150_000);
            assert.equal(resting.walking,false);assert.equal(resting.row*12+resting.col,actor.restTile);
            for(let i=1;i<frames.length;i++) {
                const [time,tile]=frames[i],previous=frames[i-1];
                assert(time>previous[0]);assert(isWalkableTile(sector,tile));
                const path=walkPath(sector,previous[1],tile);assert(path&&path.length<=2,`${traveler.name} crosses blocked terrain in ${sector}`);
            }
            for(let elapsed=0;elapsed<300_000;elapsed+=700) {
                const p=lifeActorPosition(sector,actor,start+elapsed);
                assert(isWalkableTile(sector,Math.round(p.row)*12+Math.round(p.col)));
            }
        }
    });
});
test('concurrent and replayed stage requests cannot skip a task, and new rounds start cleanly', () => {
    const first = advanceLifeEvent(15,null,lifeWindowAt(now),0,'Aki',now);
    assert(first.changed); assert.equal(first.state.step,1);
    const replay = advanceLifeEvent(15,first.state,lifeWindowAt(now),0,'Other',now+1);
    assert.equal(replay.changed,false); assert.equal(replay.state.step,1);
    assert.deepEqual(replay.state.contributors,['Aki']);
    const second = advanceLifeEvent(15,replay.state,lifeWindowAt(now),1,'Other',now+2);
    const done = advanceLifeEvent(15,second.state,lifeWindowAt(now),2,'Aki',now+3);
    assert.equal(done.view.phase,'aftermath'); assert.deepEqual(done.state.contributors,['Aki','Other']);
    assert.equal(advanceLifeEvent(15,done.state,lifeWindowAt(now),2,'Other',now+4).changed,false);
    assert.equal(parseLifeState(done.state,now+LIFE_WINDOW_MS).step,0);
    assert.equal(advanceLifeEvent(15,done.state,lifeWindowAt(now),0,'Other',now+LIFE_WINDOW_MS).changed,false);
});
test('unattended events end without awarding completion, while completed aftermath lasts to the next round', () => {
    const late = Math.floor(now/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+LIFE_ACTIVE_MS;
    const state = parseLifeState(null,late);
    assert.equal(lifeEventView(15,state,late).phase,'unattended');
    assert.equal(advanceLifeEvent(15,state,state.window,0,'Aki',late).changed,false);
    assert.equal(lifeEventView(15,{...state,step:3},late).phase,'aftermath');
});
test('work, weather waits and night rests use the same world clock, including completed work',()=>{
    for(const sector of PLAYABLE_WILD_SECTOR_IDS) {
        assert.equal(lifeActorsAt(sector,8*WORLD_HOUR_MS,'rain')[0].activity,sector===9?'Returning to the village':'Waiting out the weather');
        assert.equal(lifeActorsAt(sector,21*WORLD_HOUR_MS,'clear')[0].activity,sector===9?'Returning to the village':sector===52?'Waiting beside the festival building':'Resting at the stop');
        const now=21*WORLD_HOUR_MS,state={...parseLifeState(null,now),step:3,...(sector===2?{scenario:DOCK_SHIPMENT_SCENARIO,shipmentAt:Math.floor(now/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+60_000}:{})};
        const scene=lifeSceneView(sector,state,now,'rain');
        assert.equal(scene.actors[0].atRest,true);
        const visitors=scene.actors.filter(a=>a.id.startsWith('visitor:'));
        assert.equal(visitors.length,sector===2||scene.kind==='courier'||scene.kind==='shrine'?0:1);
        if(visitors[0])assert.notEqual(scene.actors[0].restTile,visitors[0].restTile);
    }
});
test('recurring travelers occupy one sector and follow reciprocal roads through their whole itinerary', () => {
    LIFE_TRAVELERS.forEach((traveler,index)=> {
        const route = travelerRoute(index);
        for(let i=0;i<route.length;i++) {
            const a=route[i],b=route[(i+1)%route.length];
            assert(SECTOR_ROAD_PAIRS.some(([x,y])=>x===a&&y===b||x===b&&y===a),`${traveler.name}: ${a} to ${b}`);
        }
        for (let minute=0;minute<60;minute+=5) {
            const cast=PLAYABLE_WILD_SECTOR_IDS.flatMap(s=>lifeActorsAt(s,now+minute*60_000,'clear'));
            assert.equal(cast.filter(a=>a.traveler===traveler.id).length,1);
        }
    });
});
test('dialogue describes literal actions and every event has a distinct instruction for each stage', () => {
    const strings = [...[...Object.values(LIFE_REGIONS),...Object.values(LIFE_STOP_REGIONS)].flatMap(r=>[r.greeting,r.night,r.shelter]),
        ...Object.values(LIFE_EVENTS).flatMap(e=>[e.intro,...e.tasks,...e.actions,...e.replies,e.aftermath,e.unattended]),
        ...LIFE_TRAVELERS.flatMap(t=>[t.greeting,t.again])];
    for (const text of strings) { assert(text.length<=190,text); assert(!/[—–]/.test(text),text); assert(!/\b(soul|bloodline|chosen one|destiny)\b/i.test(text),text); }
    for (const event of Object.values(LIFE_EVENTS)) assert.equal(new Set(event.tasks).size,3);
});
