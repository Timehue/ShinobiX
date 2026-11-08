import { VILLAGE_ACCENT } from './village-colors';
let owners = new Map<number, string>(), revision = 0;
export const sectorBannerRevision = () => revision;
export const sectorBannerColor = (sector:number) => owners.get(sector)??'#777777';
/** Only server snapshots/command replies call this. Missing/invalid owners are neutral. */
export function setSectorBannerOwners(rows: readonly {sector:number;ownerVillage?:string}[], replace=false) {
    const next = replace ? new Map<number,string>() : new Map(owners);
    for(const row of rows) {
        const color=Object.hasOwn(VILLAGE_ACCENT,row.ownerVillage??'')?VILLAGE_ACCENT[row.ownerVillage!]:undefined;
        if(color)next.set(row.sector,color);else next.delete(row.sector);
    }
    if(next.size===owners.size&&[...next].every(([sector,color])=>owners.get(sector)===color))return;
    owners=next;revision++;
}
/** Restored ruins for every sector, from the same public world snapshot. Kept in this
 * startup module so the lazy floor painter reads it without a new startup chunk. */
export type RestoredRuinFeedRow={id:string;sector:number;intactUntil:number};
let ruins:readonly RestoredRuinFeedRow[]=[],ruinRevision=0,ruinFeedAt=0,ruinStamp=0;
export const restoredRuinFeed=()=>ruins;
export const restoredRuinFeedRevision=()=>ruinRevision;
/** One increasing stamp shared by the feed and the counter view: event order, not wall clock. */
export const nextRestoredRuinStamp=()=>++ruinStamp;
/** The stamp of the feed's last change, so a fresher counter view can be told from a stale one. */
export const restoredRuinFeedAt=()=>ruinFeedAt;
export function setRestoredRuinFeed(rows:unknown){
    if(!Array.isArray(rows))return;
    const next=rows.filter((r):r is RestoredRuinFeedRow=>!!r&&typeof r.id==='string'&&Number.isInteger(r.sector)&&Number.isFinite(r.intactUntil));
    if(JSON.stringify(next)===JSON.stringify(ruins))return;
    ruins=next;ruinRevision++;ruinFeedAt=nextRestoredRuinStamp();
}
