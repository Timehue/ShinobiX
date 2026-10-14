import {kv} from '../../_storage.js';
import {withKvLock} from '../../_lock.js';
import {storedValueEquals} from '../../_stored-value.js';
import {clanRecordKey} from '../../_utils.js';
import {clanCampaignSeasonKey,type ClanCampaignRecord,type ClanCampaignPrestige} from '../../../shared/clan-campaign-history.js';
import {computeMvpByClan,type ClanWar} from './_storage.js';

/** Results survive pair-row rematches and cannot be rewritten by generic clan saves. */
export async function recordClanCampaignHistory(war:ClanWar):Promise<void> {
    if(!war.campaign||!war.endedAt)return;
    const mvp=computeMvpByClan(war),season=clanCampaignSeasonKey(war.endedAt);
    const competitive=Object.values(war.campaign.contributions).some(member=>member.played>0)
        &&!['service','withdrawal'].includes(war.campaign.closeReason??'');
    for(const clan of war.clans){
        const key=clanRecordKey(clan);
        await withKvLock(key,async()=>{
            const record=await kv.get<Record<string,unknown>>(key);if(!record)return;
            const history=Array.isArray(record.campaignHistory)?record.campaignHistory as ClanCampaignRecord[]:[];
            if(history.some(entry=>entry.instanceId===war.campaign!.instanceId))return;
            const enemy=war.clans.find(side=>side!==clan)!,matches=Object.values(war.campaign!.matches).filter(match=>match.status==='completed'&&match.scoreEligible);
            const modes:ClanCampaignRecord['modes']={};let normalPoints=0,shrinePoints=0;
            for(const match of matches){
                modes[match.mode]=(modes[match.mode]??0)+1;
                const won=match.result==='from-wins'?match.fromClan===clan:match.result==='to-wins'?match.toClan===clan:false;
                if(won){if(match.scope==='shrine')shrinePoints+=match.points??0;else normalPoints+=match.points??0;}
            }
            const result:ClanCampaignRecord['result']=!competitive?'Closed':war.winnerClan===clan?'Won':war.winnerClan?'Lost':'Draw';
            const entry:ClanCampaignRecord={instanceId:war.campaign!.instanceId,opponent:enemy,endedAt:war.endedAt!,result,
                points:war.campaign!.scores[clan]??0,enemyPoints:war.campaign!.scores[enemy]??0,normalPoints,shrinePoints,
                played:matches.length,mvp:mvp[clan],modes,...(result==='Won'?{warCrateId:war.warCrateId}:{})};
            let prestige=(record.campaignPrestige as ClanCampaignPrestige|undefined)??{wins:0,losses:0,draws:0,participations:0,seasons:{},earnedBanners:[]};
            if(competitive){
                const prior=prestige.seasons[season]??{wins:0,losses:0,draws:0,points:0};
                const scores={wins:prior.wins+Number(result==='Won'),losses:prior.losses+Number(result==='Lost'),draws:prior.draws+Number(result==='Draw'),points:prior.points+(result==='Won'?3:result==='Draw'?1:0)};
                const seasons=Object.fromEntries(Object.entries({...prestige.seasons,[season]:scores}).sort(([a],[b])=>b.localeCompare(a)).slice(0,8));
                prestige={...prestige,wins:prestige.wins+Number(result==='Won'),losses:prestige.losses+Number(result==='Lost'),draws:prestige.draws+Number(result==='Draw'),
                    participations:prestige.participations+1,seasons,earnedBanners:[...new Set([...prestige.earnedBanners,...(scores.wins>=3?[`campaign-victor:${season}`]:[])])].slice(-32)};
            }
            const next={...record,campaignHistory:[entry,...history].slice(0,24),campaignPrestige:prestige};
            try{if(!(await kv.compareSet(key,record,next)))throw new Error('Clan campaign history changed during recording. Retry.');}
            catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
        },{failClosed:true});
    }
}
