import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousWorldSpace,paintedTilePoint,pointAlong,worldDistance,lineLength } from './continuous-world-space';
import { SECTOR_ROAD_PAIRS,sectorExits } from './sector-links';
const space=buildContinuousWorldSpace(),chunks=new Map(space.chunks.map(c=>[c.sector,c]));

test('the entire existing road graph has fixed, non-overlapping world chunks',()=>{
    assert.equal(space.chunks.length,65);assert.equal(space.roads.length,93);
    assert.deepEqual(space.roads.map(r=>[r.a.sector,r.b.sector]),SECTOR_ROAD_PAIRS);
    for(const a of space.chunks)for(const b of space.chunks){
        if(a.sector>=b.sector)continue;
        assert(a.x+a.size<=b.x||b.x+b.size<=a.x||a.y+a.size<=b.y||b.y+b.size<=a.y,`${a.sector}/${b.sector} overlaps`);
    }
    assert(!chunks.has(99));assert(!chunks.has(54));
});
test('all 186 existing road mouths retain their painted coordinates',()=>{
    for(const road of space.roads){
        assert.deepEqual(road.points[0],paintedTilePoint(chunks.get(road.a.sector)!,road.a.tile));
        assert.deepEqual(road.points.at(-1),paintedTilePoint(chunks.get(road.b.sector)!,road.b.tile));
        assert(sectorExits(road.a.sector).some(e=>e.id===road.a.id));
        assert(sectorExits(road.b.sector).some(e=>e.id===road.b.id));
    }
});
test('corridors route around every unrelated painting rather than crossing it',()=>{
    for(const road of space.roads){
        assert(road.length>=1);
        for(let i=1;i<road.points.length;i++){
            const a=road.points[i-1]!,b=road.points[i]!;
            assert(a.x===b.x||a.y===b.y);
            for(const chunk of space.chunks){
                if(chunk.sector===road.a.sector||chunk.sector===road.b.sector)continue;
                const crosses=a.x===b.x?a.x>chunk.x&&a.x<chunk.x+12&&Math.max(a.y,b.y)>chunk.y&&Math.min(a.y,b.y)<chunk.y+12
                    :a.y>chunk.y&&a.y<chunk.y+12&&Math.max(a.x,b.x)>chunk.x&&Math.min(a.x,b.x)<chunk.x+12;
                assert(!crosses,`${road.a.id} cuts through ${chunk.sector}`);
            }
        }
    }
});
test('corridor interpolation is reversible and keeps its endpoints',()=>{
    for(const road of space.roads){
        assert.deepEqual(pointAlong(road.points,0),road.points[0]);
        assert.deepEqual(pointAlong(road.points,road.length),road.points.at(-1));
        assert.equal(lineLength(road.points),lineLength(road.points.toReversed()));
        for(const fraction of [.1,.25,.5,.75,.9])assert(worldDistance(pointAlong(road.points,road.length*fraction),pointAlong(road.points.toReversed(),road.length*(1-fraction)))<1e-8);
    }
});
