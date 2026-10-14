import {kv} from '../_storage.js';
import {withKvLock} from '../_lock.js';
import {storedValueEquals} from '../_stored-value.js';
import {safeName,clanBareSlug,clanRecordKey} from '../_utils.js';
import {clanPointWeekKey} from '../_clan-points.js';
import {clanLeadershipRole} from './_leadership.js';
import {addClanXpServer} from './_mission-catalog.js';
import {CLAN_CONTRACTS,CLAN_PROJECT,type ClanContractId,type ClanProgramView} from '../../shared/clan-program.js';
import {COMMON_GATHER_IDS} from '../../shared/gathering-materials.js';
import {clanProgram,programWeek,programAssignment,projectProgress,projectMemberUse} from './_program-rules.js';
import {isClanWarRowKey,type ClanWar} from './war/_storage.js';
import {clanBossProgressKey,type ClanBossProgress} from '../clan-boss/_storage.js';
import {clanBossEnabled} from '../_release-flags.js';
import {CLAN_PROJECT_SAGA} from '../_save-debit-kinds.js';
import {runSaveDebitSaga,saveDebitTransactionId,SaveDebitRefusal} from '../_save-debit-saga.js';
import {economyTxKey,type EconomyTxRecord} from '../_economy-tx.js';
import {applyTreasuryDonation} from '../_treasury-donate.js';
import {parseSettlementRequestId} from '../_settlement-receipts.js';

function weekClock(now:number):{key:string;startsAt:number;resetsAt:number} {
    const date=new Date(now);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    return {key:clanPointWeekKey(new Date(now)),startsAt:date.getTime(),resetsAt:date.getTime()+7*86_400_000};
}
function names(record:Record<string,unknown>):string[]{return (Array.isArray(record.members)?record.members:[])
    .map(entry=>safeName(String(typeof entry==='string'?entry:(entry as {name?:unknown}|null)?.name??''))).filter(Boolean);}
async function context(name:string):Promise<{clan:string;record:Record<string,unknown>}> {
    const save=await kv.get<Record<string,unknown>>(`save:${name}`),character=save?.character as Record<string,unknown>|undefined;
    const clan=String(character?.clan??'');
    const record=clan?await kv.get<Record<string,unknown>>(clanRecordKey(clan)):null;
    if(!record||!names(record).includes(name)||clanBareSlug(String(record.name??''))!==clanBareSlug(clan))
        throw new SaveDebitRefusal(403,'Join a clan to use its shared goals.');
    return {clan:String(record.name),record};
}
/** Derive exact weekly activity from battle/assault authorities, never contribution proxies. */
async function contractProof(clan:string,now:number):Promise<Record<ClanContractId,{progress:number;contributors:string[]}>> {
    const week=weekClock(now),warKeys=(await kv.keys('clan-war:*')).filter(isClanWarRowKey);
    const [wars,boss]=await Promise.all([warKeys.length?kv.mget<ClanWar[]>(...warKeys):Promise.resolve([]),
        kv.get<ClanBossProgress>(clanBossProgressKey(week.key,clan))]);
    const campaignMembers=new Set<string>(),operationMembers=new Set<string>();let campaign=0,operation=0;
    for(const war of wars)if(war?.campaign&&war.clans.includes(clan)){
        for(const match of Object.values(war.campaign.matches))if(match.status==='completed'&&match.scoreEligible
            &&match.completedAt!>=week.startsAt&&match.completedAt!<week.resetsAt){
            const side=match.fromClan===clan?match.fromPlayers:match.toClan===clan?match.toPlayers:[];
            if(!side.length)continue;campaign+=1;side.forEach(name=>campaignMembers.add(safeName(name)));
        }
    }
    for(const assault of boss?.assaults??[])if(assault.at>=week.startsAt&&assault.at<week.resetsAt&&assault.damage>0){
        const active=[...new Set(assault.party.map(safeName))].filter(name=>assault.contributions?.[name]?.active);
        if(active.length<2)continue;operation+=1;active.forEach(name=>operationMembers.add(name));
    }
    return {campaign:{progress:campaign,contributors:[...campaignMembers].sort()},operation:{progress:operation,contributors:[...operationMembers].sort()}};
}
export async function clanProgramView(playerName:string,now=Date.now()):Promise<ClanProgramView> {
    const name=safeName(playerName),{clan,record}=await context(name),clock=weekClock(now);
    const program=clanProgram(record),week=programWeek(program,clock.key),proof=await contractProof(clan,now);
    const members=new Set(names(record));
    return {weekKey:clock.key,resetsAt:clock.resetsAt,serverNow:now,clan,
        contracts:(Object.keys(CLAN_CONTRACTS) as ClanContractId[]).map(id=>({id,
            progress:week.claimed[id]?CLAN_CONTRACTS[id].target:Math.min(CLAN_CONTRACTS[id].target,proof[id].progress),
            contributors:week.claimed[id]?.contributors??proof[id].contributors,claimed:!!week.claimed[id],available:id!=='operation'||clanBossEnabled()})),
        project:{progress:projectProgress(week),memberUsed:projectMemberUse(week,name),completed:!!week.projectCompletedAt,
            completedProjects:program.completedProjects,hallRestored:program.hallRestored},
        assignments:Object.fromEntries(Object.entries(program.assignments).filter(([member])=>members.has(member)))};
}
export async function actClanProgram(playerName:string,input:Record<string,unknown>,now=Date.now()):Promise<Record<string,unknown>> {
    const name=safeName(playerName),clock=weekClock(now);
    if(input.action==='fund'){
        const requestId=parseSettlementRequestId(input.requestId),itemId=String(input.itemId??''),count=Number(input.count);
        if(!requestId||!COMMON_GATHER_IDS.some(id=>id===itemId)||!Number.isSafeInteger(count)||count<1||count>CLAN_PROJECT.memberLimit)
            throw new SaveDebitRefusal(400,'Choose 1–10 Field Herb, Binding Fiber or Iron Sand and retain the project request.');
        const retained=await kv.get<EconomyTxRecord>(economyTxKey(saveDebitTransactionId(CLAN_PROJECT_SAGA.kind,name,requestId)));
        const clan=retained?String(retained.meta?.clan??''):(await context(name)).clan;
        if(!clan||(input.clan!==undefined&&input.clan!==clan))throw new SaveDebitRefusal(409,'Retry the contribution with its original clan.');
        const key=clanRecordKey(clan);
        const settled=await runSaveDebitSaga({definition:CLAN_PROJECT_SAGA,playerName:name,requestId,
            identity:{clan:clanBareSlug(clan),itemId,count},sharedKey:key,resource:`item:${itemId}`,amount:count,meta:{clan,project:'hall-restoration'},
            decide:({character,shared})=>{
                if(!shared||!names(shared).includes(name)||clanBareSlug(String(character.clan??''))!==clanBareSlug(clan))
                    return {ok:false,status:403,error:'Your clan membership changed before funding.'};
                const program=clanProgram(shared),week=programWeek(program,clock.key);
                if(week.projectCompletedAt||projectMemberUse(week,name)+count>CLAN_PROJECT.memberLimit||projectProgress(week)+count>CLAN_PROJECT.target)
                    return {ok:false,status:409,error:'This contribution exceeds the remaining project or your 10-material weekly allowance.'};
                const spent=applyTreasuryDonation({},character,{kind:'item',itemId,count},{allowedCurrencies:[],currencyCaps:{},itemCountCap:CLAN_PROJECT.memberLimit});
                if(!spent.ok)return spent;
                return {ok:true,character:spent.nextDonorChar,plan:{weekKey:clock.key,name,count,itemId},result:{}};
            },messages:{pending:'Your materials are recorded. Retry the same contribution to finish the Hall project.',refunded:'The project could not save. Your materials were returned; make a new contribution when ready.'}});
        const liveClan=String(settled.character.clan??'');
        return {view:liveClan?await clanProgramView(name,now):null,character:settled.character,_saveVersion:settled._saveVersion};
    }
    const {clan}=await context(name),key=clanRecordKey(clan);
    const proof=input.action==='claim'?await contractProof(clan,now):undefined;
    await withKvLock(key,async()=>{
        const fresh=await context(name);if(fresh.clan!==clan)throw new SaveDebitRefusal(409,'Your clan changed. Reopen the Hall.');
        const current=fresh.record,program=clanProgram(current),week=programWeek(program,clock.key);let next:Record<string,unknown>={...current,program};
        if(input.action==='claim'){
            if(!Object.hasOwn(CLAN_CONTRACTS,String(input.contractId)))throw new SaveDebitRefusal(400,'Choose a clan contract.');
            const id=input.contractId as ClanContractId,terms=CLAN_CONTRACTS[id];
            if(week.claimed[id])return;
            if(proof![id].progress<terms.target)throw new SaveDebitRefusal(409,'This contract needs more verified activity.');
            week.claimed[id]={at:now,contributors:proof![id].contributors};
            next={...next,...addClanXpServer(Number(current.xp)||0,Number(current.level)||1,terms.clanXp)};
        }else if(input.action==='assign'){
            const target=safeName(String(input.member??name));
            if(!names(current).includes(target))throw new SaveDebitRefusal(400,'Choose a current clanmate.');
            if(target!==name&&!clanLeadershipRole(current,name))throw new SaveDebitRefusal(403,'Only leadership can coordinate another member’s assignment.');
            if(input.assignment!==null&&!programAssignment(input.assignment))throw new SaveDebitRefusal(400,'Choose a clan assignment or clear it.');
            program.assignments=Object.fromEntries(Object.entries(program.assignments).filter(([member])=>names(current).includes(member)));
            if(input.assignment===null)delete program.assignments[target];else program.assignments={...program.assignments,[target]:input.assignment};
        }else throw new SaveDebitRefusal(400,'Unknown clan goal action.');
        try{if(!(await kv.compareSet(key,current,next)))throw new Error('Clan goal changed before saving. Retry.');}
        catch(error){if(!storedValueEquals(await kv.get(key).catch(()=>null),next))throw error;}
    },{failClosed:true});
    return {view:await clanProgramView(name,now)};
}
