import { sectorWalkMask,walkPath } from './sector-walk-mask.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { sectorArtKey,isPlayableWildSector } from './sector-geo.js';

/** A cosmetic record of actual gathering, independent of resource availability. */
export const HARVEST_GROUND_MS=6*60*60_000;
export type HarvestGround={tile:number;at:number};
// Keep the four painted workplaces and their immediate ground intact.
const workplaces:Record<number,number>={2:100,15:104,31:102,42:99};
const distance=(a:number,b:number)=>Math.abs(a%12-b%12)+Math.abs(Math.floor(a/12)-Math.floor(b/12));
export function harvestGroundTile(sector:number,origin:number):number|undefined {
    if(!isPlayableWildSector(sector)||!Number.isInteger(origin)||origin<0||origin>=144)return;
    const mask=sectorWalkMask(sector),layout=SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)];
    if(!mask)return;
    return Array.from({length:144},(_,tile)=>tile).filter(tile=>mask[Math.floor(tile/12)]?.[tile%12]==='.'&&distance(tile,origin)<=2
        &&(workplaces[sector]===undefined||distance(tile,workplaces[sector])>2)
        &&Object.values(layout.sites).every(site=>!site||distance(tile,site.approach)>1)
        &&(walkPath(sector,origin,tile)?.length??Infinity)<=3)
        .sort((a,b)=>distance(a,origin)-distance(b,origin)||a-b)[0];
}
export function validHarvestGround(sector:number,ground:HarvestGround|undefined,now:number):ground is HarvestGround {
    return !!ground&&Number.isSafeInteger(ground.at)&&ground.at>0&&ground.at<=now&&now-ground.at<HARVEST_GROUND_MS
        &&harvestGroundTile(sector,ground.tile)===ground.tile;
}
