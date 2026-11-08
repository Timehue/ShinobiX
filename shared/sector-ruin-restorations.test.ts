import test from 'node:test';
import assert from 'node:assert/strict';
import { RUIN_RESTORATIONS, RUIN_TILE_PX, restorationArtBounds, restoredArtFile, ruinRestoration } from './sector-ruin-restorations.js';
import { RUIN_RESTORATION_BOUNDS } from './sector-ruin-restoration-bounds.js';
import { SECTOR_BUILDINGS, sectorBuilding } from './sector-buildings.js';
import { sectorPlace } from './sector-geo.js';
import { sectorWalkMask } from './sector-walk-mask.js';

test('the client draw boxes match the baked layout exactly',()=>{
    assert.deepEqual(Object.keys(RUIN_RESTORATION_BOUNDS).sort(),RUIN_RESTORATIONS.map(spec=>spec.buildingId).sort());
    for(const spec of RUIN_RESTORATIONS){const b=restorationArtBounds(spec);assert.deepEqual(RUIN_RESTORATION_BOUNDS[spec.buildingId],[b.x,b.y,b.width,b.height],spec.buildingId);}
    assert.equal(restoredArtFile('gorgewatch'),'/sector-buildings/restored-gorgewatch-v1.webp');
});

test('every ruin has exactly one painted restoration on its own floor',()=>{
    const ruins=SECTOR_BUILDINGS.filter(b=>b.kind==='ruin').map(b=>b.id).sort();
    assert.deepEqual(RUIN_RESTORATIONS.map(spec=>spec.buildingId).sort(),ruins);
    for(const spec of RUIN_RESTORATIONS)assert.equal(spec.artKey,sectorPlace(sectorBuilding(spec.buildingId)!.sector)!.artKey,spec.buildingId);
    assert.equal(ruinRestoration('stronghold-2'),undefined);
});

test('restored buildings stand only on solid tiles and cleared ground never covers a road or water',()=>{
    for(const spec of RUIN_RESTORATIONS){
        const mask=sectorWalkMask(sectorBuilding(spec.buildingId)!.sector)!;
        for(const {source,tile:[c,r,w,h]} of spec.pieces){
            assert.ok(c>=0&&r>=0&&c+w<=12&&r+h<=12,`${spec.buildingId} ${source} stays on the floor`);
            for(let row=r;row<r+h;row++)for(let col=c;col<c+w;col++)
                assert.ok('#B'.includes(mask[row][col]),`${spec.buildingId}: ${source} would cover walkable tile ${row*12+col}`);
        }
        for(const [x0,y0,x1,y1] of spec.clear){
            assert.ok(x0>=0&&y0>=0&&x1<=1024&&y1<=1024&&x0<x1&&y0<y1,spec.buildingId);
            for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
                const ch=mask[Math.floor(y/RUIN_TILE_PX)][Math.floor(x/RUIN_TILE_PX)];
                if('=~'.includes(ch))assert.fail(`${spec.buildingId}: cleared ground covers road or water at ${x},${y}`);
            }
        }
        const [gx0,gy0,gx1,gy1]=spec.ground;
        for(let y=gy0;y<gy1;y+=8)for(let x=gx0;x<gx1;x+=8)assert.equal(mask[Math.floor(y/RUIN_TILE_PX)][Math.floor(x/RUIN_TILE_PX)],'.',`${spec.buildingId} ground patch samples plain walkable ground`);
        const box=restorationArtBounds(spec);
        assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1024&&box.y+box.height<=1024,spec.buildingId);
    }
});

test('no tile looks walkable while the mask blocks it: every solid tile in a cleared plot carries a piece',()=>{
    for(const spec of RUIN_RESTORATIONS){
        const mask=sectorWalkMask(sectorBuilding(spec.buildingId)!.sector)!;
        const covered=new Set(spec.pieces.flatMap(({tile:[c,r,w,h]})=>Array.from({length:w*h},(_,k)=>(r+Math.floor(k/w))*12+c+k%w)));
        for(const [x0,y0,x1,y1] of spec.clear)for(let row=0;row<12;row++)for(let col=0;col<12;col++){
            // A tile counts as cleared when the rectangle covers most of it.
            const ix=Math.max(0,Math.min(x1,(col+1)*RUIN_TILE_PX)-Math.max(x0,col*RUIN_TILE_PX)),iy=Math.max(0,Math.min(y1,(row+1)*RUIN_TILE_PX)-Math.max(y0,row*RUIN_TILE_PX));
            if(ix*iy<RUIN_TILE_PX*RUIN_TILE_PX*.6||!'#B'.includes(mask[row][col]))continue;
            assert.ok(covered.has(row*12+col),`${spec.buildingId}: solid tile ${row*12+col} would be cleared to bare ground`);
        }
    }
});
