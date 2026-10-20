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
