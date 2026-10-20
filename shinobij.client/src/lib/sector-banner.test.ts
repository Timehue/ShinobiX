import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {SECTOR_FLOOR_LAYOUTS} from '../../../shared/sector-floor-layouts';
import {sectorBannerRegions,tintSectorBanners} from './sector-banner';
import {setSectorBannerOwners,sectorBannerColor,sectorBannerRevision} from './sector-banner-state';
import {hydrateSharedWorldState,applyAuthoritativeSectorTerritory,loadSectorTerritory,saveSectorTerritory} from './world-state';
import {VILLAGE_ACCENT} from './village-colors';

afterEach(()=>setSectorBannerOwners([],true));
test('server snapshots reconcile capture, removal and invalid villages without refreshing an unchanged raster',()=>{
    hydrateSharedWorldState({territories:[{sector:31,ownerVillage:'Frostfang Village'},{sector:15,ownerVillage:'Ashen Leaf Village'}]});
    assert.equal(sectorBannerColor(31),VILLAGE_ACCENT['Frostfang Village']);
    const before=sectorBannerRevision();
    hydrateSharedWorldState({territories:[{sector:15,ownerVillage:'Ashen Leaf Village'},{sector:31,ownerVillage:'Frostfang Village',hp:1}]});
    assert.equal(sectorBannerRevision(),before,'unrelated HP changes and payload ordering do not dirty the terrain');
    applyAuthoritativeSectorTerritory({...loadSectorTerritory(31),ownerVillage:'Ashen Leaf Village'});
    assert.equal(sectorBannerColor(31),VILLAGE_ACCENT['Ashen Leaf Village']);
    assert.equal(sectorBannerColor(15),VILLAGE_ACCENT['Ashen Leaf Village']);
    hydrateSharedWorldState({territories:[{sector:31,ownerVillage:'__proto__'}]});
    assert.equal(sectorBannerColor(31),'#777777');assert.equal(sectorBannerColor(15),'#777777');
    hydrateSharedWorldState({territories:[]});assert.equal(sectorBannerColor(31),'#777777');
});
test('an optimistic generic territory write cannot recolor server-owned heraldry',async()=>{
    const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');
    try{
        applyAuthoritativeSectorTerritory({...loadSectorTerritory(31),ownerVillage:'Frostfang Village'});
        saveSectorTerritory({...loadSectorTerritory(31),ownerVillage:'Ashen Leaf Village'});
        assert.equal(sectorBannerColor(31),VILLAGE_ACCENT['Frostfang Village']);
    }finally{globalThis.fetch=originalFetch;}
});

/** The production pixel treatment, exercised against actual delivered paintings. */
function pixelContext(data:Buffer,width:number) {
    return {getImageData(x:number,y:number,w:number,h:number){
        const pixels=new Uint8ClampedArray(w*h*4);
        for(let dy=0;dy<h;dy++)pixels.set(data.subarray(((y+dy)*width+x)*4,((y+dy)*width+x+w)*4),dy*w*4);
        return {data:pixels,width:w,height:h};
    },putImageData(pixels:ImageData,x:number,y:number){
        for(let dy=0;dy<pixels.height;dy++)data.set(pixels.data.subarray(dy*pixels.width*4,(dy+1)*pixels.width*4),((y+dy)*width+x)*4);
    }} as CanvasRenderingContext2D;
}
const paintedRoot=new URL('../../public/sector-life/',import.meta.url);
const floors=[...Object.values(SECTOR_FLOOR_LAYOUTS).filter(l=>l.sites.stronghold&&l.sector!==99).map(layout=>({layout,path:`sector-map/s${layout.artKey}.webp`})),
    ...readdirSync(paintedRoot).filter(name=>name.endsWith('.json')).flatMap(name=>{
        const receipt=JSON.parse(readFileSync(new URL(name,paintedRoot),'utf8')),layout=SECTOR_FLOOR_LAYOUTS[receipt.artKey];
        return layout&&sectorBannerRegions(layout.sector).length?[{layout,path:`sector-life/${name.replace('.json','.webp')}`}]:[];
    })];
for(const {layout,path} of floors)test(`${path}: both existing cloths change, protected ground and bright embroidery remain exact`,async()=>{
    const {data,info}=await sharp(fileURLToPath(new URL(`../../public/${path}`,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const original=Buffer.from(data),regions=sectorBannerRegions(layout.sector),allowed=new Uint8Array(info.width*info.height);
    assert.equal(regions.length,2);
    for(const [x,y,w,h] of regions)for(let cy=y;cy<y+h;cy++)allowed.fill(1,cy*info.width+x,cy*info.width+x+w);
    const outputs=new Set<string>();
    for(const ownerVillage of [...Object.keys(VILLAGE_ACCENT),undefined]){
        original.copy(data);setSectorBannerOwners([{sector:layout.sector,ownerVillage}],true);
        tintSectorBanners(pixelContext(data,info.width),layout.sector,info.width);
        const changed=[0,0];
        for(let i=0;i<data.length;i+=4){
            if(data[i]===original[i]&&data[i+1]===original[i+1]&&data[i+2]===original[i+2])continue;
            assert(allowed[i/4],`touched protected pixel ${i/4}`);assert.equal(data[i+3],original[i+3]);
            const light=original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722;
            if(layout.region!=='ashenleaf')assert(light<=95,'white crest remains original');
            const after=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
            assert(Math.abs(light-after)<1.2,'cloth folds retain their source luminance');
            const x=i/4%info.width,y=Math.floor(i/4/info.width);
            changed[regions.findIndex(([left,top,w,h])=>x>=left&&x<left+w&&y>=top&&y<top+h)]++;
        }
        assert(changed.every(n=>n>100),`both cloths must visibly change: ${changed}`);
        outputs.add(createHash('sha256').update(data).digest('hex'));
    }
    assert.equal(outputs.size,5,'four village dyes and neutral are distinct');
});
test('unfortified sectors and the imperial castle do not gain invented village flags',()=>{
    assert.deepEqual(sectorBannerRegions(42),[]);assert.deepEqual(sectorBannerRegions(99),[]);
});
