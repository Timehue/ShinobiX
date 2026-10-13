import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClanWarCampaign, CLAN_WAR_RULES } from '../../../shared/clan-war-campaign.js';
import type { ClanWar } from './_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('../../_storage.js').kv;
let act: typeof import('./_campaign-queue.js').actClanWarQueue;
let admission: typeof import('./_campaign-queue.js').campaignBattleAdmissionError;
let online: typeof import('../../_realtime/online-store.js').onlineStore;
before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ actClanWarQueue: act, campaignBattleAdmissionError: admission } = await import('./_campaign-queue.js'));
    ({ onlineStore: online } = await import('../../_realtime/online-store.js'));
});
beforeEach(async () => {
    const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys);
    for (const player of online.list()) online.remove(player.name);
});
const id = 'azure-vs-ember', key = `clan-war:${id}`;
async function seed(now = Date.now()) {
    const rosters = [{ clan: 'Azure', members: ['a-0','a-1','a-2','a-3'].map(name => ({ name, level: 15 })) },
        { clan: 'Ember', members: ['b-0','b-1','b-2','b-3'].map(name => ({ name, level: 15 })) }] as const;
    const campaign = createClanWarCampaign({ instanceId: 'cw2-queue-test-0001', now: now - CLAN_WAR_RULES.preparationMs,
        rosters: [rosters[0], rosters[1]], sectors: Array(6).fill(12), offsets: Array(6).fill(0),
        modes: ['pvp1v1','pet1v1','tilecards','pvp1v1','tilecards','pet1v1'] });
    const war: ClanWar = { id, campaign, clans: ['Azure','Ember'], villages: {}, hp: { Azure: 1000, Ember: 1000 },
        startedAt: campaign.declaredAt, updatedAt: campaign.declaredAt, declaredBy: 'a-0', pendingChallenges: [], completedChallenges: [] };
    await kv.set(key, war);
    for (const roster of rosters) {
        await kv.set(`save:clan-${roster.clan.toLowerCase()}`, { name: roster.clan, members: roster.members });
        for (const member of roster.members) {
            await kv.set(`save:${member.name}`, { _saveVersion: 1, character: { name: member.name, clan: roster.clan, level: 15 } });
        }
    }
    return war;
}
const queue = (playerName: string, action: string, extra: Record<string, unknown> = {}, now?: number) => act({ warId: id, playerName, action, ...extra }, now);

test('a clan named constructor can fund provisions once without inheriting another clan’s receipt',async()=>{
    const now=Date.now(),war=await seed(now),campaign=war.campaign!;
    const clan='constructor',warId='constructor-vs-ember';
    campaign.rosters[0]={...campaign.rosters[0],clan};
    campaign.scores={constructor:0,Ember:0};
    for(const day of campaign.days)day.clanUses={constructor:0,Ember:0};
    campaign.provisions={Ember:[{day:0,activatedAt:now}]};
    await kv.set(`clan-war:${warId}`,{...war,id:warId,clans:[clan,'Ember'],campaign});
    await kv.set('save:clan-constructor',{name:clan,founderName:'a-0',members:campaign.rosters[0].members,treasury:{provisions:100}});
    const save=(await kv.get<Record<string,any>>('save:a-0'))!;
    await kv.set('save:a-0',{...save,character:{...save.character,clan}});
    const {activateClanWarProvisions}=await import('./_campaign-provisions.js');
    await activateClanWarProvisions(warId,'a-0',now);await activateClanWarProvisions(warId,'a-0',now+1);
    assert.equal((await kv.get<Record<string,any>>('save:clan-constructor'))!.treasury.provisions,70);
    assert.equal((await kv.get<ClanWar>(`clan-war:${warId}`))!.campaign!.provisions!.constructor.length,1);
});
test('the 2v2 service switch refuses queues and confirmations before spending budgets and refunds an unpublished admitted match',async()=>{
    const prior=process.env.DISABLE_CLAN_WAR_PVP_2V2,now=Date.now();await seed(now);
    try{
        process.env.DISABLE_CLAN_WAR_PVP_2V2='1';
        await assert.rejects(queue('a-0','join',{mode:'pvp2v2'},now),/temporarily unavailable/);
        delete process.env.DISABLE_CLAN_WAR_PVP_2V2;
        for(const [first,second] of [['a-0','a-1'],['b-0','b-1']]){
            await queue(first,'join',{mode:'pvp2v2'},now);
            const partnerEntryId=(await kv.get<ClanWar>(key))!.campaign!.queue.find(entry=>entry.players.includes(first))!.id;
            await queue(second,'join',{mode:'pvp2v2',partnerEntryId},now);
        }
        const match=Object.values((await kv.get<ClanWar>(key))!.campaign!.matches)[0];
        process.env.DISABLE_CLAN_WAR_PVP_2V2='1';await assert.rejects(queue('a-0','ready',{matchId:match.id},now+1),/temporarily unavailable/);
        assert.equal((await kv.get<ClanWar>(key))!.campaign!.days[0].clanUses.Azure,0);
        delete process.env.DISABLE_CLAN_WAR_PVP_2V2;
        for(const name of ['a-0','a-1','b-0','b-1'])await queue(name,'ready',{matchId:match.id},now+2);
        process.env.DISABLE_CLAN_WAR_PVP_2V2='1';
        const {reconcileClanWarCampaign}=await import('./_campaign-reconcile.js');await reconcileClanWarCampaign(id,now+3);
        const current=(await kv.get<ClanWar>(key))!;
        assert.equal(current.campaign!.matches[match.id].cancellation,'2v2-service-disabled');
        assert.equal(current.campaign!.days[0].clanUses.Azure,0);assert.equal(current.campaign!.days[0].clanUses.Ember,0);
        assert.equal(current.campaign!.days[0].memberUses['a-0'],0);assert.equal(current.pendingChallenges.length,0);
    }finally{if(prior===undefined)delete process.env.DISABLE_CLAN_WAR_PVP_2V2;else process.env.DISABLE_CLAN_WAR_PVP_2V2=prior;}
});
async function pair(mode = 'pvp1v1', extra: Record<string, unknown> = {}, now?: number) {
    await queue('a-0','join',{ mode, ...extra },now); await queue('b-0','join',{ mode, ...extra },now);
    const war = await kv.get<ClanWar>(key); return Object.values(war!.campaign!.matches)[0];
}
test('a confirmed four-player campaign starts its reused combat engine without an unreachable public-arena ready check',async()=>{
    const now=Date.now();await seed(now);
    for(const [first,second] of [['a-0','a-1'],['b-0','b-1']]){
        await queue(first,'join',{mode:'pvp2v2'},now);
        const partnerEntryId=(await kv.get<ClanWar>(key))!.campaign!.queue.find(entry=>entry.players.includes(first))!.id;
        await queue(second,'join',{mode:'pvp2v2',partnerEntryId},now);
    }
    const match=Object.values((await kv.get<ClanWar>(key))!.campaign!.matches)[0];
    for(const name of ['a-0','a-1','b-0','b-1'])await queue(name,'ready',{matchId:match.id},now+1);
    const {startClanWar2v2Match}=await import('./_mpvp.js');
    const start=await startClanWar2v2Match({warId:id,challengeId:match.id,actor:'a-0'});
    assert.equal(start.ok,true);if(!start.ok)return;
    assert.equal(start.match.status,'active');assert.ok(start.match.roster.every(member=>member.ready));
    assert.ok(start.match.combat.turnStartedAt);
    const reopened=await startClanWar2v2Match({warId:id,challengeId:match.id,actor:'b-1'});
    assert.equal(reopened.ok,true);if(reopened.ok)assert.equal(reopened.match.matchId,start.match.matchId);
});

test('queues publish accepted battle capabilities only after both sides confirm, with budgets spent once', async () => {
    const now = Date.now(); await seed(now); const match = await pair('pvp1v1',{},now);
    assert.equal((await kv.get<ClanWar>(key))!.pendingChallenges.length,0);
    assert.ok((await queue('a-0','heartbeat',{mode:'pvp1v1'},now+1)).war,'a stale heartbeat adopts the ready check rather than claiming it expired');
    await queue('a-0','ready',{matchId:match.id},now+1);
    let war = (await kv.get<ClanWar>(key))!;
    assert.equal(war.pendingChallenges.length,0); assert.equal(war.campaign!.days[0].clanUses.Azure,0);
    await queue('b-0','ready',{matchId:match.id},now+2);
    war = (await kv.get<ClanWar>(key))!;
    assert.equal(war.pendingChallenges.length,1); assert.equal(war.pendingChallenges[0].campaignMatchId,match.id);
    assert.equal(war.campaign!.days[0].clanUses.Azure,1); assert.equal(war.campaign!.days[0].clanUses.Ember,1);
    assert.equal(await admission(war,war.pendingChallenges[0],now+3),null);
    await assert.rejects(queue('b-0','ready',{matchId:match.id},now+3),/ready check/);
    assert.equal((await kv.get<ClanWar>(key))!.campaign!.days[0].clanUses.Azure,1);
});
test('a departure between queuing and confirmation cannot publish a scored battle', async () => {
    await seed(); const match = await pair(); await queue('a-0','ready',{matchId:match.id});
    await kv.set('save:b-0',{character:{name:'b-0',clan:'Jade',level:15}});
    await assert.rejects(queue('b-0','ready',{matchId:match.id}),/eligible member/);
    assert.equal((await kv.get<ClanWar>(key))!.pendingChallenges.length,0);
});
test('a leave/rejoin cannot recover a sealed war eligibility slot',async()=>{
    const now=Date.now();await seed(now);
    const clan=await kv.get<Record<string,unknown>>('save:clan-azure');
    await kv.set('save:clan-azure',{...clan,memberJoinedAt:{'a-0':now}});
    await assert.rejects(queue('a-0','join',{mode:'pvp1v1'},now+1),/rejoined/);
});
test('ready declines and expiry retain attempts and offer no player-reported result path', async () => {
    const now = Date.now(); await seed(now); const match = await pair('pvp1v1',{},now);
    await assert.rejects(queue('a-1','decline',{matchId:match.id},now+1),/ready check/);
    await queue('a-0','decline',{matchId:match.id},now+1);
    await assert.rejects(queue('a-0','complete',{matchId:match.id,result:'from-wins'},now+2),/Unknown/);
    await queue('a-0','state',{},now+90_000);
    const war = (await kv.get<ClanWar>(key))!;
    assert.equal(war.campaign!.days[0].clanUses.Azure,0); assert.equal(war.pendingChallenges.length,0);
});
test('four-player queues require two consenting clanmates on each side', async () => {
    await seed(); await queue('a-0','join',{mode:'pvp2v2'}); await queue('b-0','join',{mode:'pvp2v2'});
    let war = (await kv.get<ClanWar>(key))!; const a = war.campaign!.queue.find(entry=>entry.clan==='Azure')!;
    const b = war.campaign!.queue.find(entry=>entry.clan==='Ember')!;
    await assert.rejects(queue('a-1','join',{mode:'pvp2v2',partnerEntryId:b.id}),/partner/);
    await queue('a-1','join',{mode:'pvp2v2',partnerEntryId:a.id});
    await queue('b-1','join',{mode:'pvp2v2',partnerEntryId:b.id});
    war = (await kv.get<ClanWar>(key))!; const match = Object.values(war.campaign!.matches)[0];
    for (const name of ['a-0','b-0','a-1']) await queue(name,'ready',{matchId:match.id});
    assert.equal((await kv.get<ClanWar>(key))!.pendingChallenges.length,0);
    await queue('b-1','ready',{matchId:match.id});
    war = (await kv.get<ClanWar>(key))!;
    assert.equal(war.campaign!.days[0].clanUses.Azure,2); assert.equal(war.campaign!.days[0].memberUses['a-1'],1);
    const finalMatch=war.campaign!.matches[match.id];
    assert.deepEqual(finalMatch.fromClan==='Ember'?finalMatch.fromPlayers:finalMatch.toPlayers,['b-0','b-1']);
});
test('shrine queues need a server-issued visit by both players at the sealed location and mode', async () => {
    const now = Date.now(); await seed(now);
    await assert.rejects(queue('a-0','join',{mode:'pvp1v1',scope:'shrine',windowIndex:0},now),/Travel/);
    for (const name of ['a-0','b-0']) online.upsert({name,sector:12,character:null});
    await assert.rejects(queue('a-0','join',{mode:'pvp1v1',scope:'shrine',windowIndex:0},now),/Enter/);
    for (const name of ['a-0','b-0']) await queue(name,'shrine-enter',{scope:'shrine',windowIndex:0},now);
    await assert.rejects(queue('a-0','join',{mode:'pvp2v2',scope:'shrine',windowIndex:0},now),/announced/);
    const match = await pair('pvp1v1',{scope:'shrine',windowIndex:0},now);
    for (const name of ['a-0','b-0']) await queue(name,'ready',{matchId:match.id},now+1);
    const war = (await kv.get<ClanWar>(key))!;
    assert.equal(war.campaign!.shrines[0].usedMatches,1); assert.equal(war.campaign!.days[0].clanUses.Azure,0);
    assert.equal(await admission(war,war.pendingChallenges[0],now+2),null);
    online.setInBattle('a-0',true); online.setInBattle('a-0',false);
    assert.match((await admission(war,war.pendingChallenges[0],now+3))!,/Enter/);
});
test('unavailable pets, unknown rosters, active battles and forged admission records are refused', async () => {
    await seed(); await assert.rejects(queue('a-0','join',{mode:'pet1v1'}),/carried pet/);
    await assert.rejects(queue('stranger','join',{mode:'pvp1v1'}),/eligible roster/);
    online.upsert({name:'a-0',sector:0,character:null}); online.setInBattle('a-0',true);
    await assert.rejects(queue('a-0','join',{mode:'pvp1v1'}),/active battle/);
    const war = (await kv.get<ClanWar>(key))!;
    assert.match((await admission(war,{id:'forged',mode:'pvp1v1',fromClan:'Azure',fromPlayer:'a-0',acceptedPlayer:'b-0',
        createdAt:Date.now(),expiresAt:Date.now()+60_000,status:'accepted'}))!,/queue admission/);
});
test('a committed queue write with a lost reply is recovered using its JSON storage representation',async()=>{
    await seed();const single=kv.compareSet,get=kv.get;let landed=false;
    kv.compareSet=async(k,expected,value,options)=>{
        const result=await single.call(kv,k,expected,value,options);
        if(k===key&&result&&!landed){landed=true;throw new Error('lost queue reply');}return result;
    };
    kv.get=(async(k:string)=>{const value=await get.call(kv,k);return landed&&k===key?JSON.parse(JSON.stringify(value)):value;}) as typeof kv.get;
    try {const response=await queue('a-0','join',{mode:'pvp1v1'});assert.ok(response.war);}
    finally {kv.compareSet=single;kv.get=get;}
    assert.equal((await kv.get<ClanWar>(key))!.campaign!.queue.length,1);
});
test('shrine movement is adjacent, room-bound and cannot use an ordinary stronghold visit as entry',async()=>{
    const now=Date.now(),war=await seed(now);const presence=await import('../../_stronghold-presence.js');
    online.upsert({name:'a-0',sector:12,character:null});
    presence.touchStrongholdPresence('a-0',12,126,now);
    await assert.rejects(queue('a-0','shrine-enter',{scope:'shrine',windowIndex:0},now),/Leave your current interior/);
    presence.leaveStrongholdPresence('a-0');
    await queue('a-0','shrine-enter',{scope:'shrine',windowIndex:0},now);
    assert.equal(presence.strongholdLocation('a-0',12,now)?.room,`clan-shrine:${war.campaign!.instanceId}:0`);
    const moved=await queue('a-0','shrine-walk',{scope:'shrine',windowIndex:0,tile:114},now+1);
    assert.equal((moved.room as {players:Array<{tile:number}>}).players[0].tile,114);
    await assert.rejects(queue('a-0','shrine-walk',{scope:'shrine',windowIndex:0,tile:15},now+2),/adjacent/);
    await assert.rejects(queue('a-0','shrine-state',{scope:'shrine',windowIndex:0},now+100_000),/Enter/);
});
test('coincident shrine appearances and ordinary field players occupy distinct attack/presence rooms',async()=>{
    const now=Date.now(),war=await seed(now);const presence=await import('../../_stronghold-presence.js');
    online.upsert({name:'a-0',sector:12,character:null});await queue('a-0','shrine-enter',{scope:'shrine',windowIndex:0},now);
    online.upsert({name:'rival',sector:12,character:null});presence.touchStrongholdPresence('rival',12,126,now,'clan-shrine:another-campaign:0',now+3600_000);
    online.upsert({name:'field',sector:12,character:null});
    assert.equal(presence.sameStrongholdLocation({name:'a-0',sector:12},{name:'rival',sector:12},now),false);
    assert.equal(presence.sameStrongholdLocation({name:'a-0',sector:12},{name:'field',sector:12},now),false);
    const own=await queue('a-0','shrine-state',{scope:'shrine',windowIndex:0},now);
    assert.deepEqual((own.room as {players:Array<{name:string}>}).players.map(player=>player.name),['a-0']);
    assert.ok(war.campaign);
});
test('optional provisions spend 30 treasury rations once per war day, require leadership and freeze only future match bonuses',async()=>{
    const now=Date.now();await seed(now);
    const record=await kv.get<Record<string,unknown>>('save:clan-azure');
    await kv.set('save:clan-azure',{...record,founderName:'a-0',treasury:{provisions:100}});
    await assert.rejects(queue('a-1','provisions',{},now),/leadership/);
    await queue('a-0','provisions',{},now);await queue('a-0','provisions',{},now+1);
    assert.equal((await kv.get<{treasury:{provisions:number}}>('save:clan-azure'))!.treasury.provisions,70);
    const match=await pair('pvp1v1',{},now+2);for(const name of ['a-0','b-0'])await queue(name,'ready',{matchId:match.id},now+3);
    assert.deepEqual((await kv.get<ClanWar>(key))!.campaign!.matches[match.id].provisionedClans,['Azure']);
    await queue('a-0','provisions',{},now+CLAN_WAR_RULES.dayMs+1);
    assert.equal((await kv.get<{treasury:{provisions:number}}>('save:clan-azure'))!.treasury.provisions,40);
    assert.equal((await kv.get<ClanWar>(key))!.campaign!.days[0].clanUses.Azure,1);
});
