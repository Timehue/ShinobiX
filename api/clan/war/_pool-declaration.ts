import { kv, type KvCasOp } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { storedValueEquals } from '../../_stored-value.js';
import { clanRecordKey, safeName, clanBareSlug } from '../../_utils.js';
import { economyTxKey, type EconomyTxRecord } from '../../_economy-tx.js';
import { SaveDebitRefusal } from '../../_save-debit-saga.js';
import { clanLeadershipRole } from '../_leadership.js';
import type { ClanSealPool } from '../seal-pool/_storage.js';
import { clanWarReservationKey, type ClanWarReservation } from './_declaration-reservations.js';
import type { ClanWar } from './_storage.js';

/** Pool funding has no player debit: pool, campaign, claims and journal land together. */
export async function publishPoolDeclaration(input: {war:ClanWar;fromClan:string;playerName:string;cost:number;transactionId:string}): Promise<{
    war:ClanWar;character:Record<string,unknown>;_saveVersion:number;
}> {
    const {war,fromClan,transactionId,cost}=input,player=safeName(input.playerName);
    const poolKey=`clan-seal-pool:${fromClan.toLowerCase()}`,warKey=`clan-war:${war.id}`,journalKey=economyTxKey(transactionId);
    return withKvLock(poolKey,async()=>{
        const [pool,current,clan,save,journal]=await Promise.all([
            kv.get<ClanSealPool>(poolKey),kv.get<ClanWar>(warKey),kv.get<Record<string,unknown>>(clanRecordKey(fromClan)),
            kv.get<Record<string,unknown>>(`save:${player}`),kv.get<EconomyTxRecord>(journalKey),
        ]);
        const character=save?.character as Record<string,unknown>|undefined;
        if(journal){
            if(journal.state==='complete'&&journal.meta?.funding==='pool'&&current?.campaign&&current.campaign.instanceId===journal.meta?.instanceId&&character)
                return {war:current,character,_saveVersion:Number(save?._saveVersion??0)};
            throw new SaveDebitRefusal(409,'This declaration request belongs to another payment. Retry its original funding choice.');
        }
        if(!clan||!character||!clanLeadershipRole(clan,player)||clanBareSlug(String(character.clan??''))!==clanBareSlug(fromClan)) {
            throw new SaveDebitRefusal(403,'Your clan leadership changed before payment.');
        }
        if(current&&!current.endedAt)throw new SaveDebitRefusal(409,'This clan pair already has a war.');
        if(!pool||!Number.isSafeInteger(pool.balance)||pool.balance<cost)throw new SaveDebitRefusal(400,`The clan Seal Pool needs ${cost} Honor Seals to declare war.`);
        const now=Date.now(),nextPool:ClanSealPool={...pool,balance:pool.balance-cost,
            log:[{kind:'war-declare' as const,by:player,to:war.clans.find(clan=>clan!==fromClan),amount:cost,at:now},...pool.log].slice(0,50)};
        const record:EconomyTxRecord={id:transactionId,kind:'clan-war-declare',state:'complete',debitKey:poolKey,creditKey:warKey,
            resource:'honorSeals',amount:cost,createdAt:now,updatedAt:now,completedAt:now,
            meta:{fromClan,toClan:war.clans.find(clan=>clan!==fromClan),funding:'pool',instanceId:war.campaign!.instanceId,playerName:player}};
        const ops:KvCasOp[]=[{op:'cas',key:poolKey,expected:pool,value:nextPool},{op:'cas',key:warKey,expected:current,value:war},
            {op:'cas',key:journalKey,expected:null,value:record},{op:'assert',key:clanRecordKey(fromClan),expected:clan},
            {op:'assert',key:`save:${player}`,expected:save}];
        for(const clanName of war.clans){
            const key=clanWarReservationKey(clanName),held=await kv.get<ClanWarReservation>(key);
            if(!held||held.transactionId!==transactionId||held.instanceId!==war.campaign!.instanceId||held.state!=='pending')
                throw new SaveDebitRefusal(409,'The original clan reservations are required to publish this war.');
            ops.push({op:'cas',key,expected:held,value:{...held,state:'active'}});
        }
        try{
            if(!kv.compareSetMany||!(await kv.compareSetMany(ops)))throw new SaveDebitRefusal(409,'The clan Seal Pool changed before payment. Retry the same declaration.');
        }catch(error){
            const recovered=await kv.get<EconomyTxRecord>(journalKey).catch(()=>null);
            if(!storedValueEquals(recovered,record))throw error;
        }
        return {war,character,_saveVersion:Number(save!._saveVersion??0)};
    },{failClosed:true});
}
