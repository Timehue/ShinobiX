import {kv} from '../../_storage.js';
import {withKvLock} from '../../_lock.js';
import {storedValueEquals} from '../../_stored-value.js';
import {clanRecordKey,clanBareSlug,safeName} from '../../_utils.js';
import {clanLeadershipRole} from '../_leadership.js';
import {closeClanWarCampaign,clanWarCampaignPhase} from '../../../shared/clan-war-campaign.js';
import {finalizeClanWarEnd,redactClanWarForViewer,type ClanWar} from './_storage.js';
import {reconcileClanWarCampaign} from './_campaign-reconcile.js';
import {ClanWarQueueRefusal} from './_campaign-queue.js';

export async function manageClanWarCampaign(warId:string,playerName:string,action:'withdraw'|'surrender',now=Date.now()):Promise<Record<string,unknown>> {
    await reconcileClanWarCampaign(warId,now);
    const key=`clan-war:${warId}`,name=safeName(playerName);
    const closed=await withKvLock(key,async()=>{
        const [war,save]=await Promise.all([kv.get<ClanWar>(key),kv.get<Record<string,unknown>>(`save:${name}`)]);
        if(!war?.campaign)throw new ClanWarQueueRefusal(404,'Campaign not found.');
        const actual=String((save?.character as Record<string,unknown>|undefined)?.clan??''),clan=war.clans.find(side=>clanBareSlug(side)===clanBareSlug(actual));
        const record=clan?await kv.get<Record<string,unknown>>(clanRecordKey(clan)):null;
        if(!clan||!record||!clanLeadershipRole(record,name))throw new ClanWarQueueRefusal(403,'Only current clan leadership can end a campaign.');
        if(war.endedAt)return {war,clan,scout:Number((record.upgrades as Record<string,unknown>|undefined)?.scoutNetwork??0)};
        const preparing=clanWarCampaignPhase(war.campaign,now)==='preparing';
        if(action==='withdraw'&&(!preparing||war.campaign.rosters[0].clan!==clan))
            throw new ClanWarQueueRefusal(409,'Only the declaring clan can withdraw during preparation.');
        const campaign=closeClanWarCampaign(war.campaign,now,preparing?'withdrawal':'surrender',preparing?undefined:clan);
        const next=finalizeClanWarEnd({...war,campaign},{endedAt:now,reason:'timeout'});
        try{if(!(await kv.compareSet(key,war,next)))throw new Error('Campaign changed before its closure. Retry.');}
        catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
        return {war:next,clan,scout:Number((record.upgrades as Record<string,unknown>|undefined)?.scoutNetwork??0)};
    },{failClosed:true});
    const war=await reconcileClanWarCampaign(warId,now)??closed.war;
    return {war:redactClanWarForViewer(war,closed.clan,name,now,closed.scout),serverNow:now};
}
