import {FRONTIER_SITES,frontierRestSpot} from '../../../shared/sector-frontier-work';
import {isWalkableTile,nearestWalkableTile} from '../../../shared/sector-walk-mask';
import {loiterRouteClearsTiles} from './wanderer-loiter';

// Gen's resting shoulder, the original keeper's work points and painted gear
// stay fixed. A generated emissary must leave them clear throughout its walk.
const site=FRONTIER_SITES[55];
const reserved=[frontierRestSpot(55,79),site.stop,site.inspection,...site.clearance];
const interior=(tile:number)=>tile%12>=2&&tile%12<=9&&Math.floor(tile/12)>=2&&Math.floor(tile/12)<=9;

export function frontierEmissaryHomeTile(sector:number,id:string,homeTile:number):number {
    if(sector!==55)return homeTile;
    const walkable=(tile:number)=>isWalkableTile(sector,tile),home=nearestWalkableTile(sector,homeTile);
    const clear=(tile:number)=>interior(tile)&&walkable(tile)&&loiterRouteClearsTiles(id,tile,walkable,reserved);
    if(clear(home))return home;
    const distance=(tile:number)=>Math.abs(tile%12-home%12)+Math.abs(Math.floor(tile/12)-Math.floor(home/12));
    return Array.from({length:144},(_,tile)=>tile).filter(tile=>interior(tile)&&walkable(tile))
        .sort((a,b)=>distance(a)-distance(b)||a-b).find(clear)??home;
}
