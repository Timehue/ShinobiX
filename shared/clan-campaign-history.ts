import type {ClanWarQueueMode} from './clan-war-campaign.js';
export type ClanCampaignRecord={instanceId:string;opponent:string;endedAt:number;result:'Won'|'Lost'|'Draw'|'Closed';
    points:number;enemyPoints:number;normalPoints:number;shrinePoints:number;played:number;mvp?:string;
    modes:Partial<Record<ClanWarQueueMode,number>>;warCrateId?:string};
export type ClanCampaignSeason={wins:number;losses:number;draws:number;points:number};
export type ClanCampaignPrestige={wins:number;losses:number;draws:number;participations:number;seasons:Record<string,ClanCampaignSeason>;earnedBanners:string[]};
export function clanCampaignSeasonKey(now:number):string {const date=new Date(now);return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth()/3)+1}`;}
