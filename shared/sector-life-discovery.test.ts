import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wildlifeDiscovery,WILDLIFE_DISCOVERY_WINDOW} from './sector-life-discovery.js';
import {isWorldNight} from './world-phase.js';
import {PLAYABLE_WILD_SECTOR_IDS} from './sector-geo.js';
import {walkPath,isWalkableTile} from './sector-walk-mask.js';
import {lifeAnchors} from './sector-life.js';
import {harvestGroundTile} from './sector-harvest.js';
import {lifeActorPosition} from './sector-life-motion.js';

function occasion(sector:number){let now=1_800_000_000_000;for(let i=0;i<100;i++){now=Math.floor(now/WILDLIFE_DISCOVERY_WINDOW)*WILDLIFE_DISCOVERY_WINDOW;if(!isWorldNight(now)&&(Math.floor(now/WILDLIFE_DISCOVERY_WINDOW)+sector)%4===0)return now;now+=WILDLIFE_DISCOVERY_WINDOW;}throw new Error('No daylight window');}
test('occasional wildlife follows real connected ground, lingers there, and leaves by the same approach',()=>{
    let checked=0;
    for(const sector of PLAYABLE_WILD_SECTOR_IDS){const origin=lifeAnchors(sector)[2],target=Array.from({length:144},(_,tile)=>tile).find(tile=>harvestGroundTile(sector,tile)===tile&&(walkPath(sector,origin,tile)?.length??0)>=3);if(target===undefined)continue;
        const now=occasion(sector),route=wildlifeDiscovery(sector,now,'clear',origin,[[target,undefined,now+3_600_000]]);assert(route);checked++;
        const frames=route.motion.frames;assert.equal(frames[0][1],frames.at(-1)![1]);assert.equal(route.until,route.motion.start+frames.at(-1)![0]);
        for(let i=0;i<frames.length;i++){assert(isWalkableTile(sector,frames[i][1]));if(i){assert(frames[i][0]>frames[i-1][0]);assert((walkPath(sector,frames[i-1][1],frames[i][1])?.length??Infinity)<=2);}}
        const rest=frames.findIndex((frame,i)=>i>0&&frame[1]===target&&frame[1]===frames[i-1][1]);assert(rest>0);assert.equal(frames[rest][0]-frames[rest-1][0],12_000);
        const pose=lifeActorPosition(sector,route,route.motion.start+frames[rest][0]-1000);assert.equal(pose.col,target%12);assert.equal(pose.row,Math.floor(target/12));
        assert.deepEqual(wildlifeDiscovery(sector,route.motion.start+1,'clear',origin,[[target,undefined,now+3_600_000]]),route,'a poll never restarts the flight');
        assert.equal(wildlifeDiscovery(sector,route.until,'clear',origin,[[target,undefined,now+3_600_000]]),undefined);
    }
    assert(checked>=60,`regional coverage ${checked}`);
});
test('most windows, bad weather, darkness, missing/expired/occupied/closed clues leave ordinary wildlife alone',()=>{
    const sector=42,origin=lifeAnchors(sector)[2],now=occasion(sector),target=Array.from({length:144},(_,t)=>t).find(t=>harvestGroundTile(sector,t)===t&&(walkPath(sector,origin,t)?.length??0)>=3)!;
    const marks=[[target,undefined,now+3_600_000]] as const;
    assert(wildlifeDiscovery(sector,now,'clear',origin,marks));
    for(const weather of ['rain','snow','storm','fog'])assert.equal(wildlifeDiscovery(sector,now,weather,origin,marks),undefined);
    assert.equal(wildlifeDiscovery(sector,now,'clear',origin,[]),undefined);
    assert.equal(wildlifeDiscovery(sector,now,'clear',origin,marks,[target]),undefined);
    for(const tile of [-1,144,NaN,1.1])assert.equal(wildlifeDiscovery(sector,now,'clear',origin,[[tile]]),undefined);
    assert.equal(wildlifeDiscovery(sector,now,'clear',origin,[[target,undefined,now-1]]),undefined);
    for(let i=1;i<=3;i++)assert.equal(wildlifeDiscovery(sector,now+i*WILDLIFE_DISCOVERY_WINDOW,'clear',origin,marks),undefined);
    let dark=now;while(!isWorldNight(dark))dark+=WILDLIFE_DISCOVERY_WINDOW;assert.equal(wildlifeDiscovery(sector,dark,'clear',origin,marks),undefined);
});
