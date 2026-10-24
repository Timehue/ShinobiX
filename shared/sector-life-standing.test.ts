import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeSceneView,parseLifeState,lifeHuntSites} from './sector-life.js';
import {lifeRegionFor} from './sector-life-content.js';
import {parseShrineCare} from './sector-life-memory.js';
import {CHRONICLE_STOP_SECTOR,CHRONICLE_STOP_SEATS,CHRONICLE_WATCH_TILES} from './sector-chronicle-stop.js';
import {PLAYABLE_WILD_SECTOR_IDS} from './sector-geo.js';
import {LIFE_STANDING_TILES,lifeStandingTiles} from './sector-life-standing.js';

/** Thirty hours of samples, cycling weather, errand stage and shrine upkeep, catch
 * every traveler stop, crew post, courier, keeper and pilgrim. The 337 s step
 * drifts against the five-minute traveler slots and the world day, so each
 * combination is seen at many times of day. A hunt party and the roadside
 * Chronicle match need state only a player or the server writes, so their stops
 * are added directly. */
function standingTiles(sector:number):number[] {
    const tiles=new Set<number>(),start=Date.UTC(2026,9,1);
    for(let i=0;i<320;i++){
        const now=start+i*337_000,weather=i%2?'rain':'clear',step=Math.floor(i/2)%4,tier=Math.floor(i/8)%3;
        for(const actor of lifeSceneView(sector,{...parseLifeState(null,now),step,updatedAt:now-60_000},now,weather,undefined,undefined,{tier,...parseShrineCare(null,now)}).actors)
            for(const tile of [actor.restTile,actor.workTile,...[...actor.phases??[],...actor.cyclePhases??[]].map(phase=>phase.workTile)])if(tile!==undefined)tiles.add(tile);
    }
    if(lifeRegionFor(sector).event==='tracks'){const stops=lifeHuntSites(sector);tiles.add(stops.scout);tiles.add(stops.tracker);}
    if(sector===CHRONICLE_STOP_SECTOR)for(const tile of [...CHRONICLE_STOP_SEATS,...CHRONICLE_WATCH_TILES])tiles.add(tile);
    return [...tiles].sort((a,b)=>a-b);
}

test('the client table of resident standing tiles matches the live sector-life cast',()=>{
    const expected=Object.fromEntries(PLAYABLE_WILD_SECTOR_IDS.map(sector=>[sector,standingTiles(sector)]));
    assert.deepEqual(LIFE_STANDING_TILES,expected,`Residents moved. Replace LIFE_STANDING_TILES in shared/sector-life-standing.ts with:\n${JSON.stringify(expected).replaceAll('"','')}`);
});

test('sectors without residents reserve nothing',()=>{
    assert.deepEqual(lifeStandingTiles(0),[]);
    assert.deepEqual(lifeStandingTiles(54),[]);
    assert.deepEqual(lifeStandingTiles(55),LIFE_STANDING_TILES[55]);
});
