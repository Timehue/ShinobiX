import {kv} from '../../_storage.js';
import {withKvLock} from '../../_lock.js';
import {storedValueEquals} from '../../_stored-value.js';
import {clanRecordKey,safeName,clanBareSlug} from '../../_utils.js';
import {clanLeadershipRole} from '../_leadership.js';
import {CLAN_WAR_RULES,clanWarCampaignDay,clanWarOwnValue} from '../../../shared/clan-war-campaign.js';
import {redactClanWarForViewer,type ClanWar} from './_storage.js';
import {ClanWarQueueRefusal} from './_campaign-queue.js';

/** Provisions are an explicit, once-per-war-day shared treasury transaction. */
export async function activateClanWarProvisions(warId:string,playerName:string,now=Date.now()):Promise<Record<string,unknown>> {
    const key=`clan-war:${warId}`,name=safeName(playerName);
    const actor=await kv.get<Record<string,unknown>>(`save:${name}`),actual=String((actor?.character as Record<string,unknown>|undefined)?.clan??'');
    if(!actual)throw new ClanWarQueueRefusal(403,'Clan leadership must authorize the provision expense.');
    const clanKey=clanRecordKey(actual);
    // Match dissolution's clan -> war order. Neither queue nor battle settlement takes a clan lock here.
    return withKvLock(clanKey,async()=>withKvLock(key,async()=>{
        const war=await kv.get<ClanWar>(key);
        if(!war?.campaign||war.endedAt)throw new ClanWarQueueRefusal(409,'This campaign is not active.');
        const roster=war.campaign.rosters.find(side=>clanBareSlug(side.clan)===clanBareSlug(actual)),day=clanWarCampaignDay(war.campaign,now);
        if(!roster||day===null)throw new ClanWarQueueRefusal(409,'Leadership can activate provisions during the fighting phase.');
            const [clan,save]=await Promise.all([kv.get<Record<string,unknown>>(clanKey),kv.get<Record<string,unknown>>(`save:${name}`)]);
            const character=save?.character as Record<string,unknown>|undefined;
            if(!clan||!clanLeadershipRole(clan,name)||clanBareSlug(String(character?.clan??''))!==clanBareSlug(roster.clan))
                throw new ClanWarQueueRefusal(403,'Clan leadership must authorize the provision expense.');
            const scout=Number((clan.upgrades as Record<string,unknown>|undefined)?.scoutNetwork??0);
            const prior=clanWarOwnValue(war.campaign!.provisions,roster.clan)??[];
            if(prior.some(entry=>entry.day===day))return {war:redactClanWarForViewer(war,roster.clan,name,now,scout),serverNow:now};
            const treasury=clan.treasury as Record<string,unknown>|undefined,balance=Number(treasury?.provisions??0);
            if(!Number.isSafeInteger(balance)||balance<CLAN_WAR_RULES.provisionCost)throw new ClanWarQueueRefusal(400,`The clan treasury needs ${CLAN_WAR_RULES.provisionCost} rations.`);
            const nextClan={...clan,treasury:{...treasury,provisions:balance-CLAN_WAR_RULES.provisionCost}};
            const next:ClanWar={...war,campaign:{...war.campaign!,provisions:{...war.campaign!.provisions,
                [roster.clan]:[...prior,{day,activatedAt:now}]}},updatedAt:now};
            try {
                if(!kv.compareSetMany||!(await kv.compareSetMany([{op:'cas',key,expected:war,value:next},
                    {op:'cas',key:clanKey,expected:clan,value:nextClan},{op:'assert',key:`save:${name}`,expected:save}])))
                    throw new Error('Clan provisions changed while payment was being recorded. Retry.');
            }catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
            return {war:redactClanWarForViewer(next,roster.clan,name,now,scout),serverNow:now};
    },{failClosed:true}),{failClosed:true});
}
