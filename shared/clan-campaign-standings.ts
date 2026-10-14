import {clanCampaignSeasonKey,type ClanCampaignPrestige} from './clan-campaign-history.js';
export interface ClanStanding {name:string;wins:number;losses:number;draws:number;points:number;rank:number}
/** Competitive standings use earned campaign prestige, never roster size or Hall power. */
export function clanCampaignStandings(clans:Array<{name:string;campaignPrestige?:ClanCampaignPrestige}>,period:'season'|'lifetime',now:number):ClanStanding[] {
    const season=clanCampaignSeasonKey(now),count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0;
    const rows=clans.map(clan=>{
        const result=period==='season'?clan.campaignPrestige?.seasons?.[season]:clan.campaignPrestige;
        const wins=count(result?.wins),losses=count(result?.losses),draws=count(result?.draws);
        return {name:clan.name,wins,losses,draws,points:wins*3+draws,rank:0};
    }).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.draws-a.draws||a.name.localeCompare(b.name));
    rows.forEach((row,index)=>{const previous=rows[index-1];row.rank=previous&&previous.points===row.points&&previous.wins===row.wins&&previous.draws===row.draws?previous.rank:index+1;});
    return rows;
}
