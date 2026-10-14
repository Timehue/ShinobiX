import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClanWarCampaign,joinClanWarQueue,matchClanWarQueue,readyClanWarMatch,startClanWarMatch,CLAN_WAR_RULES,
    type ClanWarCampaign,type ClanWarCampaignMutation,type ClanWarQueueMode } from '../../../shared/clan-war-campaign.js';
import type { ClanWar } from './_storage.js';

process.env.NODE_ENV='test';process.env.SHINOBIX_QA_MEMORY_KV='1';
let kv:typeof import('../../_storage.js').kv;
let apply:typeof import('./_storage.js').applyFinalResult;
let award:typeof import('./_campaign-rewards.js').awardCampaignMatch;
let reconcile:typeof import('./_campaign-reconcile.js').reconcileClanWarCampaign;
let week:typeof import('../../_clan-points.js').clanPointWeekKey;
before(async()=>{
    ({kv}=await import('../../_storage.js'));({applyFinalResult:apply}=await import('./_storage.js'));
    ({awardCampaignMatch:award}=await import('./_campaign-rewards.js'));
    ({reconcileClanWarCampaign:reconcile}=await import('./_campaign-reconcile.js'));
    ({clanPointWeekKey:week}=await import('../../_clan-points.js'));
});
beforeEach(async()=>{const keys=await kv.keys('*');if(keys.length)await kv.del(...keys);});
function next(result:ClanWarCampaignMutation):ClanWarCampaign {if(!result.ok)throw new Error(result.error);return result.campaign;}
async function fixture(mode:ClanWarQueueMode='pet1v1',nearEnd=false) {
    const now=Date.now(),declared=nearEnd?now-CLAN_WAR_RULES.preparationMs-CLAN_WAR_RULES.conflictMs:now-26*60*60_000;
    let campaign=createClanWarCampaign({instanceId:'cw2-reward-fixture-0001',now:declared,
        rosters:[{clan:'Azure',members:[0,1,2,3].map(i=>({name:`a-${i}`,level:100}))},{clan:'Ember',members:[0,1,2,3].map(i=>({name:`b-${i}`,level:100}))}],
        sectors:Array(6).fill(12),offsets:Array(6).fill(0),modes:['pvp1v1','pet1v1','tilecards','tilecards','pvp1v1','pet1v1']});
    const start=nearEnd?campaign.endsAt-20*60_000:now-60_000;
    for(const [name,clan] of [['a-0','Azure'],['b-0','Ember']] as const) campaign=next(joinClanWarQueue(campaign,{entryId:name,name,clan,mode,scope:'normal',now:start}));
    campaign=next(matchClanWarQueue(campaign,'cwm-rewards-00001',start));
    for(const name of ['a-0','b-0'])campaign=next(readyClanWarMatch(campaign,'cwm-rewards-00001',name,start));
    campaign=next(startClanWarMatch(campaign,'cwm-rewards-00001',start));
    const match=campaign.matches['cwm-rewards-00001'];
    const challenge={id:match.id,campaignMatchId:match.id,mode,fromClan:'Azure',fromPlayer:'a-0',acceptedPlayer:'b-0',
        createdAt:start,acceptedAt:start,status:'accepted' as const,expiresAt:campaign.endsAt};
    const war:ClanWar={id:'azure-vs-ember',clans:['Azure','Ember'],campaign,hp:{Azure:1000,Ember:1000},villages:{},
        startedAt:declared,updatedAt:start,declaredBy:'a-0',pendingChallenges:[challenge],completedChallenges:[]};
    for(const clan of ['Azure','Ember'])await kv.set(`save:clan-${clan.toLowerCase()}`,{name:clan,members:Array.from({length:10},(_,index)=>({name:`${clan==='Azure'?'a':'b'}-${index}`})),xp:0,level:1});
    for(const [name,clan] of [['a-0','Azure'],['b-0','Ember']] as const)await kv.set(`save:${name}`,{_saveVersion:1,character:{name,clan,level:100,clanPoints:0,weeklyClanPoints:0,weeklyClanPointsWeek:week(),lifetimeClanPoints:0}});
    await kv.set(`clan-war:${war.id}`,war);return{war,challenge,now,start,match};
}
async function char(name:string){return (await kv.get<{character:Record<string,any>}>(`save:${name}`))!.character;}

test('leadership surrender settles earned matches and victory rewards once before normal recovery',async()=>{
    const {war,challenge,now}=await fixture('pet1v1');
    const completed=apply(war,challenge,'from-wins',now);
    await kv.set(`clan-war:${war.id}`,completed.war);
    const clan=(await kv.get<Record<string,unknown>>('save:clan-ember'))!;
    await kv.set('save:clan-ember',{...clan,founderName:'b-0'});
    const {manageClanWarCampaign}=await import('./_campaign-management.js');
    await manageClanWarCampaign(war.id,'b-0','surrender',now+1);
    const ended=(await kv.get<ClanWar>(`clan-war:${war.id}`))!;
    assert.equal(ended.campaign!.closeReason,'surrender');assert.equal(ended.winnerClan,'Azure');
    assert.equal((await char('a-0')).clanPoints,125);assert.equal((await char('b-0')).clanPoints,25);
    const xp=(await kv.get<Record<string,unknown>>('save:clan-azure'))!.xp;
    await reconcile(war.id,now+2);
    assert.equal((await char('a-0')).clanPoints,125);assert.equal((await char('b-0')).clanPoints,25);
    assert.equal((await kv.get<Record<string,unknown>>('save:clan-azure'))!.xp,xp);
    assert.ok(await kv.get('clan-war:cooldown:azure-vs-ember'));
});

test('all battle families use the same exactly-once campaign credit and mark it on the war',async()=>{
    for(const mode of ['pet1v1','tilecards','pvp1v1'] as const){
        const {war,challenge,now}=await fixture(mode);const result=apply(war,challenge,'from-wins',now);
        await kv.set(`clan-war:${war.id}`,result.war);const match=result.war.campaign!.matches[challenge.id];
        await award(result.war,match);await award(result.war,match);
        assert.equal((await char('a-0')).clanPoints,50);assert.equal((await char('b-0')).clanPoints,25);
        assert.ok((await kv.get<ClanWar>(`clan-war:${war.id}`))!.campaign!.matches[challenge.id].rewardsSettledAt);
        const keys=await kv.keys('*');if(keys.length)await kv.del(...keys);
    }
});
test('earned points survive departure and use the current weekly cap without resetting an older week',async()=>{
    const {war,challenge,now}=await fixture();const result=apply(war,challenge,'draw',now);
    await kv.set(`clan-war:${war.id}`,result.war);
    const save=await kv.get<Record<string,any>>('save:a-0');save!.character.clan='';save!.character.weeklyClanPoints=990;await kv.set('save:a-0',save);
    await award(result.war,result.war.campaign!.matches[challenge.id]);
    assert.equal((await char('a-0')).clan,'');assert.equal((await char('a-0')).clanPoints,0);assert.equal((await char('a-0')).weeklyClanPoints,990);
    const paid=await kv.get<Record<string,any>>('save:a-0');paid!.character.weeklyClanPointsWeek='2099-W01';paid!.character.weeklyClanPoints=0;await kv.set('save:a-0',paid);
    await award(result.war,result.war.campaign!.matches[challenge.id]);assert.equal((await char('a-0')).clanPoints,0);
    assert.equal((await char('b-0')).clanPoints,25);
});
test('payout repair credits the missing player after a failed commit, without duplicating the paid player',async()=>{
    const {war,challenge,now}=await fixture();const result=apply(war,challenge,'from-wins',now);await kv.set(`clan-war:${war.id}`,result.war);
    const original=kv.compareSetMany!;
    const originalSingle=kv.compareSet;
    kv.compareSetMany=async ops=>{if(ops.some(op=>op.key==='save:b-0'))throw new Error('injected payout failure');return original.call(kv,ops);};
    kv.compareSet=async (key,expected,value,options)=>{if(key==='save:b-0')throw new Error('injected payout failure');return originalSingle.call(kv,key,expected,value,options);};
    try{await assert.rejects(award(result.war,result.war.campaign!.matches[challenge.id]),/injected/);}finally{kv.compareSetMany=original;kv.compareSet=originalSingle;}
    assert.equal((await char('a-0')).clanPoints,50);assert.equal((await char('b-0')).clanPoints,0);
    await reconcile(war.id);assert.equal((await char('a-0')).clanPoints,50);assert.equal((await char('b-0')).clanPoints,25);
});
test('closure reconciles a durable pre-deadline pet result before choosing the winner and pays every end reward once',async()=>{
    const {war,challenge,now,start}=await fixture('pet1v1',true);
    const {clanWarPetSessionKey}=await import('./_pet-duel.js');
    await kv.set(clanWarPetSessionKey(war.id,challenge.id),{warId:war.id,challengeId:challenge.id,mode:'pet1v1',seed:42,
        from:[{name:'a-0',pet:{id:'pet-a'}}],to:[{name:'b-0',pet:{id:'pet-b'}}],status:'done',winner:'from-wins',engine:'showdown',createdAt:start,updatedAt:now-60_000});
    let closed=await reconcile(war.id,now+1);assert.equal(closed!.winnerClan,'Azure');assert.equal(closed!.campaign!.scores.Azure,100);
    assert.equal((await char('a-0')).clanPoints,125);assert.equal((await char('b-0')).clanPoints,25);
    const firstXp=(await kv.get<Record<string,unknown>>('save:clan-azure'))!.xp;
    closed=await reconcile(war.id,now+2);assert.equal((await char('a-0')).clanPoints,125);assert.equal((await kv.get<Record<string,unknown>>('save:clan-azure'))!.xp,firstXp);
    assert.ok(closed!.campaign!.endRewardsSettledAt);
    const clan=await kv.get<Record<string,any>>('save:clan-azure');
    assert.equal(clan!.campaignHistory.length,1);assert.equal(clan!.campaignHistory[0].result,'Won');
    assert.equal(clan!.campaignPrestige.wins,1);assert.equal(clan!.campaignPrestige.participations,1);
});
test('preparation withdrawal gives no free victory, personal payout or seasonal prestige',async()=>{
    const {war,now}=await fixture();war.campaign!.startsAt=now+3600_000;war.campaign!.endsAt=war.campaign!.startsAt+CLAN_WAR_RULES.conflictMs;
    war.campaign!.matches={};war.pendingChallenges=[];
    await kv.set(`clan-war:${war.id}`,war);
    const record=await kv.get<Record<string,unknown>>('save:clan-azure');await kv.set('save:clan-azure',{...record,founderName:'a-0'});
    const {manageClanWarCampaign}=await import('./_campaign-management.js');
    await assert.rejects(manageClanWarCampaign(war.id,'a-1','withdraw',now),/leadership/);
    await manageClanWarCampaign(war.id,'a-0','withdraw',now);
    const ended=await kv.get<ClanWar>(`clan-war:${war.id}`);assert.equal(ended!.winnerClan,undefined);assert.equal(ended!.campaign!.closeReason,'withdrawal');
    assert.equal((await char('a-0')).clanPoints,0);
    const clan=await kv.get<Record<string,any>>('save:clan-azure');assert.equal(clan!.campaignHistory[0].result,'Closed');assert.equal(clan!.campaignPrestige.participations,0);
});
test('an abandoned admitted match consumes attempts but never grants participation or war victory rewards',async()=>{
    const {war,now}=await fixture('pvp1v1');await reconcile(war.id,now+3*60_000);
    const fresh=(await kv.get<ClanWar>(`clan-war:${war.id}`))!;
    assert.equal(fresh.campaign!.matches['cwm-rewards-00001'].status,'cancelled');assert.equal(fresh.campaign!.days[0].clanUses.Azure,1);
    assert.equal((await char('a-0')).clanPoints,0);assert.equal(Object.keys(fresh.campaign!.contributions).length,0);
});
test('provisions sealed at admission boost personal rewards without changing War Points or the weekly cap',async()=>{
    const {war,challenge,now}=await fixture();
    war.campaign!.matches[challenge.id].provisionedClans=['Azure'];
    const result=apply(war,challenge,'from-wins',now);await kv.set(`clan-war:${war.id}`,result.war);
    await award(result.war,result.war.campaign!.matches[challenge.id]);
    assert.equal((await char('a-0')).clanPoints,55);assert.equal((await char('b-0')).clanPoints,25);
    assert.equal(result.war.campaign!.scores.Azure,100);
    const {finalizedWarPointTotals}=await import('./_war-points.js');
    assert.deepEqual(finalizedWarPointTotals({war:result.war,challenge:result.completed}),{'a-0':55,'b-0':25});
});
