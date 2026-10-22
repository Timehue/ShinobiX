import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeSceneView,parseLifeState} from './sector-life.js';
import {lifeActorPosition,lifeActivityAtPosition} from './sector-life-motion.js';
import {chronicleStopActors,chronicleStopPlan,nextChronicleStop,CHRONICLE_WATCH_TILES} from './sector-chronicle-stop.js';
import {stopChronicleGame} from '../api/sector/_life-chronicle-game.js';
import {addChronicleStop} from '../api/sector/_life-chronicle.js';
import {WORLD_HOUR_MS} from './world-clock.js';
import {isWalkableTile,walkPath} from './sector-walk-mask.js';

test('existing tea visitors watch the actual seeded turn/result from clear ground, then return around the table',()=>{
    for(const window of [0,4,20,24,28,44,48,52,68]){
        const game=stopChronicleGame(window),state={window},plan=chronicleStopPlan(state,game),at=plan.matchAt+10_000;
        const base=lifeSceneView(42,{...parseLifeState(null,at),step:3,updatedAt:window*WORLD_HOUR_MS-1000},at,'clear'),view=addChronicleStop(base,state,game,at);
        assert(view.actors.length<=5);const visitor=view.actors.find(a=>a.id==='visitor:42')!;assert(visitor);assert.equal(visitor.workTile,136);
        const p=lifeActorPosition(42,visitor,at),phase=lifeActivityAtPosition(visitor,p,at);assert.equal(phase.activity,'Watching Chronicle');
        const turn=game.turns[Math.min(game.turns.length-1,Math.floor((at-plan.matchAt)/plan.turnMs))];assert(phase.line.includes(`${turn.player} is taking turn ${turn.turn}`));
        assert.equal(lifeActivityAtPosition(visitor,{col:0,row:0},at).activity,'Walking to watch the match');
        for(const [i,[time,tile]]of visitor.motion!.frames.entries()){assert(isWalkableTile(42,tile));if(i){const before=visitor.motion!.frames[i-1];assert(time>before[0]);assert(walkPath(42,before[1],tile)!.length<=2);}assert(![99,111,112].includes(tile));}
        assert(visitor.motion!.start+visitor.motion!.frames.at(-1)![0]<(window+1)*WORLD_HOUR_MS,'the visitor returns before the source window ends');
        for(const player of chronicleStopActors(state,game,at))assert(player.motion!.frames.every(([,t])=>!(CHRONICLE_WATCH_TILES as readonly number[]).includes(t)));
        const result=lifeActivityAtPosition(visitor,{col:4,row:11},plan.packAt+1);assert(result.line.includes(game.winner?`${game.winner} won`:'draw'));
        const wet=nextChronicleStop(state,at,'rain',game)!,stopped=addChronicleStop(base,wet,game,at+1).actors.find(a=>a.id===visitor.id)!;
        assert(!/won|draw/.test(lifeActivityAtPosition(stopped,{col:4,row:11},at+1).line));
    }
});

test('Gen keeps his visit identity, recognition and actual departure while watching when his itinerary reaches the match',()=>{
    let found=false;
    for(let day=0;day<30&&!found;day++){
        const window=day*24+20,game=stopChronicleGame(window),plan=chronicleStopPlan({window},game),at=plan.matchAt+1000;
        const base=lifeSceneView(42,{...parseLifeState(null,at),step:3,updatedAt:window*WORLD_HOUR_MS-1000},at,'clear');if(!base.actors.some(a=>a.id==='gen'))continue;
        const gen=addChronicleStop(base,{window},game,at).actors.find(a=>a.id==='gen')!;assert.equal(gen.restTile,138);assert.equal(gen.traveler,'gen');assert(gen.phases!.some(p=>p.returnGreeting));
        const exit=lifeActorPosition(42,gen,gen.hideAt!+1);assert.equal(exit.row*12+exit.col,gen.hideTile);assert.equal(gen.motion!.start+300_000,gen.hideAt);found=true;
    }
    assert(found);
});
