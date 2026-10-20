import { isPlayableWildSector } from '../../shared/sector-geo.js';
import { isWalkableTile } from '../../shared/sector-walk-mask.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import type { DuelWitness } from '../../shared/sector-scars.js';

export type DuelGround={sector:number;tile:number;witnesses?:DuelWitness[]};
type Presence={sector:number;tile?:number;worldPosition?:unknown;lastSeenAt:number;travelingUntil?:number};

/** Cosmetic evidence only. Never derive a fight site from a claim request or
 * from where its winner happens to be standing after the battle. */
export function sealDuelGround(verified:boolean,sector:number,first:Presence|null|undefined,second:Presence|null|undefined,now:number):DuelGround|undefined {
    if(!verified||!isPlayableWildSector(sector)||!first||!second)return;
    const model=worldPositionModel();
    const location=(presence:Presence)=>{
        if(presence.sector!==sector||!Number.isFinite(presence.lastSeenAt)||now-presence.lastSeenAt<0||now-presence.lastSeenAt>30_000||(presence.travelingUntil??0)>now)return;
        if(presence.worldPosition!==undefined) {
            const position=model.read(presence.worldPosition);if(!position)return;
            const site=model.location(position);if(site.sector===sector&&Number.isInteger(site.tile)&&isWalkableTile(sector,site.tile!))return site.tile;
            return;
        }
        if(Number.isInteger(presence.tile)&&isWalkableTile(sector,presence.tile!))return presence.tile;
    };
    if(location(first)===undefined)return;
    const tile=location(second);if(tile!==undefined)return {sector,tile};
}
