import {kv,type KvCasOp} from '../../_storage.js';
import {withKvLock} from '../../_lock.js';
import {storedValueEquals} from '../../_stored-value.js';
import {economyTxKey,type EconomyTxRecord} from '../../_economy-tx.js';
import {closeClanWarCampaign} from '../../../shared/clan-war-campaign.js';
import {CLAN_DECLARATION_LOCK,releaseEndedClanWarReservations} from './_declaration-reservations.js';
import {finalizeClanWarEnd,clanWarCooldownKey,type ClanWar} from './_storage.js';
import {ClanWarQueueRefusal} from './_campaign-queue.js';
import {refundCampaignPersonalFee} from './_campaign-rewards.js';
import {reconcileClanWarCampaign,reconcileClanWarBattleResults} from './_campaign-reconcile.js';
import type {ClanSealPool} from '../seal-pool/_storage.js';

/** Administrative service recovery only. The route checks existing admin auth.
 * Freeze first, compensate the sealed source, then release both clan claims.
 * Never hold the war lock while writing a player's save.
 */
export async function cancelClanWarForService(input:{warId:string;instanceId:string;reason:string},now=Date.now()):Promise<ClanWar> {
    if(!/^[a-z0-9-]{3,100}$/.test(input.warId)||!/^[a-z0-9-]{8,80}$/.test(input.instanceId)
        ||typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.length>240
        ||/[\u0000-\u001f]/.test(input.reason))throw new ClanWarQueueRefusal(400,'Choose the campaign instance and describe the service failure (8–240 characters).');
    return withKvLock(CLAN_DECLARATION_LOCK,async()=>{
        const key=`clan-war:${input.warId}`;
        const observed=await kv.get<ClanWar>(key);
        if(observed?.campaign?.instanceId===input.instanceId&&!observed.endedAt)await reconcileClanWarBattleResults(observed,now);
        let war=await withKvLock(key,async()=>{
            const current=await kv.get<ClanWar>(key);
            if(!current?.campaign||current.campaign.instanceId!==input.instanceId)throw new ClanWarQueueRefusal(409,'This is not the requested campaign instance.');
            if(current.endedAt&&current.campaign.closeReason!=='service')throw new ClanWarQueueRefusal(409,'A concluded competitive campaign cannot be service-canceled.');
            const payment=current.campaign.declarationPayment;
            if(!payment||!Number.isSafeInteger(payment.amount)||payment.amount<=0||payment.amount>100
                ||!current.clans.includes(payment.clan)||payment.payerName!==current.declaredBy)
                throw new ClanWarQueueRefusal(503,'The original payment proof is unavailable. No fee has been refunded.');
            const proof=await kv.get<EconomyTxRecord>(economyTxKey(payment.transactionId));
            const proofInstance=payment.funding==='pool'?proof?.meta?.instanceId
                :(proof?.meta?.plan as {war?:ClanWar}|undefined)?.war?.campaign?.instanceId;
            const debitKey=payment.funding==='pool'?`clan-seal-pool:${payment.clan.toLowerCase()}`:`save:${payment.payerName}`;
            if(!proof||proof.state!=='complete'||proof.kind!=='clan-war-declare'||proof.amount!==payment.amount
                ||proof.resource!=='honorSeals'||proof.debitKey!==debitKey||proof.creditKey!==key||proofInstance!==input.instanceId)
                throw new ClanWarQueueRefusal(503,'The completed declaration payment could not be proven. No fee has been refunded.');
            if(current.endedAt)return current;
            const campaign=closeClanWarCampaign(current.campaign,now,'service');
            campaign.serviceCancellation={reason:input.reason.trim(),requestedAt:now};
            const next=finalizeClanWarEnd({...current,campaign},{endedAt:now,reason:'timeout'});
            try{if(!(await kv.compareSet(key,current,next)))throw new Error('Campaign changed during cancellation. Retry the same instance.');}
            catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
            return next;
        },{failClosed:true});
        if(!war.campaign!.serviceCancellation?.feeRefundedAt){
            const payment=war.campaign!.declarationPayment!;
            if(payment.funding==='personal')await refundCampaignPersonalFee(war);
            const finish=async()=>withKvLock(key,async()=>{
                const current=await kv.get<ClanWar>(key);
                if(current?.campaign?.instanceId!==input.instanceId||current.campaign.closeReason!=='service')throw new Error('Canceled campaign was replaced before compensation.');
                if(current.campaign.serviceCancellation?.feeRefundedAt)return current;
                const journalKey=economyTxKey(payment.transactionId),journal=await kv.get<EconomyTxRecord>(journalKey);
                if(!journal||journal.state!=='complete')throw new Error('Declaration payment journal disappeared before compensation.');
                const next:ClanWar={...current,campaign:{...current.campaign,serviceCancellation:{...current.campaign.serviceCancellation!,feeRefundedAt:now}}};
                const ops:KvCasOp[]=[{op:'cas',key,expected:current,value:next},
                    {op:'cas',key:journalKey,expected:journal,value:{...journal,updatedAt:now,note:'Declaration fee returned after an administrative service cancellation.',
                        meta:{...journal.meta,serviceCancellation:{instanceId:input.instanceId,reason:current.campaign.serviceCancellation!.reason,refundedAt:now}}}}];
                if(payment.funding==='pool'){
                    const poolKey=`clan-seal-pool:${payment.clan.toLowerCase()}`,pool=await kv.get<ClanSealPool>(poolKey);
                    if(!pool||!Number.isSafeInteger(pool.balance)||pool.balance<0||!Number.isSafeInteger(pool.balance+payment.amount))
                        throw new Error('The original Seal Pool is unavailable. Its fee refund remains pending.');
                    ops.push({op:'cas',key:poolKey,expected:pool,value:{...pool,balance:pool.balance+payment.amount,
                        log:[{kind:'war-refund',by:'admin',to:payment.clan,amount:payment.amount,at:now},...pool.log].slice(0,50)}});
                }
                try{if(!kv.compareSetMany||!(await kv.compareSetMany(ops)))throw new Error('Campaign fee compensation was contended. Retry the same instance.');}
                catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
                return next;
            },{failClosed:true});
            war=payment.funding==='pool'?await withKvLock(`clan-seal-pool:${payment.clan.toLowerCase()}`,finish,{failClosed:true}):await finish();
        }
        await releaseEndedClanWarReservations(war);
        const cooldownKey=clanWarCooldownKey(...war.clans),cooldown=await kv.get(cooldownKey);
        if(cooldown===war.endedAt&&kv.compareSetMany)await kv.compareSetMany([{op:'delete',key:cooldownKey,expected:cooldown}]);
        return await reconcileClanWarCampaign(war.id,now)??war;
    },{failClosed:true,ttlSec:30});
}
