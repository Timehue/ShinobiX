import {isWorldNight} from './world-phase.js';
import {isWalkableTile,walkPath} from './sector-walk-mask.js';
import type {GroundTrail} from './sector-life-courier.js';
import type {LifeMotion} from './sector-life-motion.js';

export const WILDLIFE_DISCOVERY_WINDOW=180_000;
export type WildlifeDiscovery={restTile:number;motion:LifeMotion;until:number};
/** An occasional bird investigates ground that is actually visible in this scene.
 * Its connected approach and departure never create a find, marker or reward.
 * Most scenes and all poor-weather/night scenes keep their ordinary wildlife. */
export function wildlifeDiscovery(sector:number,now:number,weather:string,origin:number,marks:GroundTrail,occupied:readonly number[]=[]):WildlifeDiscovery|undefined {
    const slot=Math.floor(now/WILDLIFE_DISCOVERY_WINDOW),start=slot*WILDLIFE_DISCOVERY_WINDOW+30_000;
    if(weather!=='clear'||isWorldNight(now)||(slot+sector)%4||now>start+45_000)return;
    for(const [tile,,expiry] of marks) {
        if(!Number.isInteger(tile)||!isWalkableTile(sector,tile)||occupied.includes(tile)||expiry!==undefined&&(!Number.isSafeInteger(expiry)||expiry<=start+30_000))continue;
        const route=walkPath(sector,origin,tile)?.slice(-6);
        if(!route||route.length<3)continue;
        const out=route.map((point,i)=>[i*1800,point] as const),arrive=out.at(-1)![0];
        const back=route.slice(0,-1).reverse().map((point,i)=>[arrive+12_000+(i+1)*1800,point] as const);
        const frames=[...out,[arrive+12_000,tile] as const,...back],until=start+frames.at(-1)![0];
        if(now>=until)return;
        return {restTile:route[0],motion:{start,frames},until};
    }
}
