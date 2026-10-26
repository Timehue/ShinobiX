import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClanWar } from './_storage.js';
import { CLAN_WAR_RULES } from '../../../shared/clan-war-campaign.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('../../_storage.js').kv;
let declare: typeof import('./_campaign-declare.js').declareClanWarCampaign;
let roster: typeof import('./_campaign-declare.js').loadClanWarEligibleRoster;
let claim: typeof import('./_declaration-reservations.js').claimClanWarReservations;
let key: typeof import('./_declaration-reservations.js').clanWarReservationKey;
before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ declareClanWarCampaign: declare, loadClanWarEligibleRoster: roster } = await import('./_campaign-declare.js'));
    ({ claimClanWarReservations: claim, clanWarReservationKey: key } = await import('./_declaration-reservations.js'));
});
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); });

test('elapsed legacy wars close before declaration and preserve only the remaining rematch cooldown', async () => {
    await seedClan('Azure','azure'); await seedClan('Ember','ember');
    const { clanWarKey, clanWarCooldownKey, CLAN_WAR_MAX_DURATION_MS } = await import('./_storage.js');
    const now = Date.now();
    const old: ClanWar = { id:'azure-vs-ember', clans:['Azure','Ember'],villages:{},hp:{Azure:1000,Ember:1000},
        startedAt:now-CLAN_WAR_MAX_DURATION_MS-4*86400000,updatedAt:now-1000,declaredBy:'azure-0',pendingChallenges:[],completedChallenges:[] };
    await kv.set(clanWarKey(...old.clans),old);
    await assert.rejects(declare({playerName:'azure-0',toClan:'Ember',requestId:'legacy-cooldown-001'}),/seven days/);
    const closed = (await kv.get<ClanWar>(clanWarKey(...old.clans)))!;
    assert.equal(closed.endedAt,old.startedAt+CLAN_WAR_MAX_DURATION_MS);
    assert.equal(closed.updatedAt,old.updatedAt);
    assert.equal(await kv.get(clanWarCooldownKey(...old.clans)),closed.endedAt);
    const aged = {...old,startedAt:now-CLAN_WAR_MAX_DURATION_MS-8*86400000};
    await kv.set(clanWarKey(...old.clans),aged);await kv.del(clanWarCooldownKey(...old.clans));
    const fresh=await declare({playerName:'azure-0',toClan:'Ember',requestId:'legacy-expired-001'});
    assert.equal(fresh.war.campaign?.version,2); assert.equal(fresh.character.honorSeals,400);
});

test('service cancellation refunds the sealed personal fee once and allows immediate declaration without competitive rewards',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    const first=await declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-personal-001'});
    const {cancelClanWarForService}=await import('./_campaign-service-cancel.js');
    const request={warId:first.war.id,instanceId:first.war.campaign!.instanceId,reason:'Verified battle service outage.'};
    const closed=await cancelClanWarForService(request);
    assert.equal(closed.campaign!.closeReason,'service');assert.equal(closed.winnerClan,undefined);
    assert.ok(closed.campaign!.serviceCancellation!.feeRefundedAt);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.clanPoints??0,0);
    await cancelClanWarForService(request);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
    for(const clan of first.war.clans)assert.equal((await kv.get<Record<string,any>>(key(clan)))!.recoveryUntil,0);
    assert.equal(await kv.get('clan-war:cooldown:azure-vs-ember'),null);
    const next=await declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-rematch-001'});
    assert.notEqual(next.war.campaign!.instanceId,request.instanceId);assert.equal(next.character.honorSeals,400);
    await assert.rejects(cancelClanWarForService(request),/requested campaign/);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,400);
});

test('a lost pool refund response cannot duplicate compensation or credit a personal wallet',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    await kv.set('clan-seal-pool:azure',{clanName:'Azure',balance:500,log:[]});
    const first=await declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-pool-001',funding:'pool'});
    const {cancelClanWarForService}=await import('./_campaign-service-cancel.js');
    const original=kv.compareSetMany!,request={warId:first.war.id,instanceId:first.war.campaign!.instanceId,reason:'Verified shrine service outage.'};let armed=true;
    kv.compareSetMany=async ops=>{const done=await original.call(kv,ops);if(done&&armed&&ops.some(op=>op.key==='clan-seal-pool:azure')){armed=false;throw new Error('lost refund response');}return done;};
    try{await cancelClanWarForService(request);}finally{kv.compareSetMany=original;}
    await cancelClanWarForService(request);
    const pool=await kv.get<Record<string,any>>('clan-seal-pool:azure');
    assert.equal(pool!.balance,500);assert.equal(pool!.log.filter((entry:{kind:string})=>entry.kind==='war-refund').length,1);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
});

test('personal fee compensation survives failure of the later shared stamp without a second credit',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    const first=await declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-stamp-001'});
    const {cancelClanWarForService}=await import('./_campaign-service-cancel.js');
    const request={warId:first.war.id,instanceId:first.war.campaign!.instanceId,reason:'Verified match publication outage.'};
    const original=kv.compareSetMany!;let armed=true;
    kv.compareSetMany=async ops=>{if(armed&&ops.some(op=>op.key.startsWith('economy-tx:'))){armed=false;throw new Error('stamp transport failure');}return original.call(kv,ops);};
    try{await assert.rejects(cancelClanWarForService(request),/stamp transport/);}finally{kv.compareSetMany=original;}
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
    await assert.rejects(declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-unfinished-001'}),/recovering/);
    await cancelClanWarForService(request);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
    assert.ok((await kv.get<ClanWar>(`clan-war:${first.war.id}`))!.campaign!.serviceCancellation!.feeRefundedAt);
});

test('service cancellation refuses missing original payment proof and completed competitive records',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    const first=await declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-service-proof-001'});
    const {cancelClanWarForService}=await import('./_campaign-service-cancel.js');
    const request={warId:first.war.id,instanceId:first.war.campaign!.instanceId,reason:'Verified battle service outage.'};
    const journalKey=`economy-tx:${first.war.campaign!.declarationPayment!.transactionId}`,journal=await kv.get(journalKey);
    await kv.del(journalKey);await assert.rejects(cancelClanWarForService(request),/could not be proven/);
    assert.equal((await kv.get<ClanWar>(`clan-war:${first.war.id}`))!.endedAt,undefined);
    await kv.set(journalKey,journal);
    await kv.set(`clan-war:${first.war.id}`,{...first.war,endedAt:Date.now(),campaign:{...first.war.campaign,closedAt:Date.now(),closeReason:'time'}});
    await assert.rejects(cancelClanWarForService(request),/competitive campaign/);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,400);
});

async function seedClan(name: string, prefix: string, seals = 500): Promise<Record<string, unknown>> {
    const now = Date.now(), createdAt = now - 10 * 86_400_000;
    const names = Array.from({ length: 4 }, (_, i) => `${prefix}-${i}`);
    const record = { name, founderName: names[0], village: 'Stormveil Village', createdAt, serverCreatedAt: createdAt,
        members: names.map(member => ({ name: member, level: 1 })), memberJoinedAt: Object.fromEntries(names.map(member => [member, createdAt])) };
    await kv.set(`save:clan-${name.toLowerCase()}`, record);
    const registry = await kv.get<Record<string, unknown>>('player:registry') ?? {};
    for (const member of names) {
        await kv.set(`save:${member}`, { _saveVersion: 1, character: { name: member, clan: name, level: 100,
            honorSeals: seals, ryo: 0, inventory: [], itemStacks: [] } });
        registry[member] = { lastSeen: now };
    }
    await kv.set('player:registry', registry);
    return record;
}

test('real declarations publish v2 campaigns, both clan claims, a unique crate and one sealed payment', async () => {
    await seedClan('Azure', 'azure'); await seedClan('Ember', 'ember');
    const input = { playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-declare-normal-0001' };
    const first = await declare(input);
    assert.equal(first.war.campaign?.version, 2);
    assert.equal(first.war.campaign?.rosters[0].members.length, 4);
    assert.equal(first.war.campaign?.rosters[0].members[0].name, 'azure-0');
    assert.ok(first.war.warCrateId?.includes(first.war.campaign!.instanceId));
    assert.equal(first.character.honorSeals, 400);
    assert.ok(first._saveVersion > 1);
    for (const clan of first.war.clans) assert.equal((await kv.get<Record<string, unknown>>(key(clan)))?.state, 'active');
    const second = await declare(input);
    assert.equal(second.war.campaign?.instanceId, first.war.campaign?.instanceId);
    assert.equal(second.war.startedAt, first.war.startedAt);
    assert.equal(second.character.honorSeals, 400);
});

test('eligibility uses server saves, membership age and activity rather than client roster levels', async () => {
    const record = await seedClan('Azure', 'azure');
    const registry = await kv.get<Record<string, { lastSeen: number }>>('player:registry');
    assert.equal((await roster(record, registry!, Date.now())).members.length, 4);
    const cutoff = { ...record, memberJoinedAt: { ...(record.memberJoinedAt as object), 'azure-1': Date.now() } };
    assert.equal((await roster(cutoff, registry!, Date.now())).members.length, 3);
    assert.equal((await roster(record, { ...registry, 'azure-1': { lastSeen: Date.now() - 8 * 86_400_000 } }, Date.now())).members.length, 3);
    await kv.set('save:azure-1', { character: { clan: 'Another', level: 100 } });
    assert.equal((await roster(record, registry!, Date.now())).members.length, 3);
});

test('insufficient payment and invalid eligibility leave neither charges nor dangling clan claims', async () => {
    await seedClan('Azure', 'azure', 99); await seedClan('Ember', 'ember');
    await assert.rejects(declare({ playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-short-balance-0001' }), /100 Honor Seals/);
    assert.equal(await kv.get(key('Azure')), null);
    assert.equal(await kv.get(key('Ember')), null);
    assert.equal((await kv.get<Record<string, any>>('save:azure-0'))?.character.honorSeals, 99);
    const fresh = await kv.get<Record<string, unknown>>('save:clan-ember');
    await kv.set('save:clan-ember', { ...fresh, serverCreatedAt: Date.now() });
    await assert.rejects(declare({ playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-too-new-clan-0001' }), /seven days/);
    assert.equal(await kv.get(key('Azure')), null);
});

test('the same clan cannot enter simultaneous campaigns against different rivals', async () => {
    await seedClan('Azure', 'azure'); await seedClan('Ember', 'ember'); await seedClan('Jade', 'jade');
    const outcomes = await Promise.allSettled([
        declare({ playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-concurrent-ember-0001' }),
        declare({ playerName: 'azure-0', toClan: 'Jade', requestId: 'campaign-concurrent-jade-0001' }),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    const wars = (await kv.keys('clan-war:*')).filter(candidate => candidate.includes('-vs-') && !candidate.slice('clan-war:'.length).includes(':'));
    assert.equal(wars.length, 1);
    assert.equal((await kv.get<Record<string, any>>('save:azure-0'))?.character.honorSeals, 400);
});

test('atomic participant claims cannot leave a half-reserved third clan under contention', async () => {
    const now = Date.now();
    const outcomes = await Promise.allSettled([
        claim({ clans: ['Azure', 'Ember'], warId: 'azure-vs-ember', instanceId: 'one', transactionId: 'tx-one', now }),
        claim({ clans: ['Azure', 'Jade'], warId: 'azure-vs-jade', instanceId: 'two', transactionId: 'tx-two', now }),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal((await kv.keys('clan-war:participant:*')).length, 2);
});

test('a paid campaign cannot be replaced during recovery and the doctrine discount is sealed at declaration', async () => {
    const record = await seedClan('Azure', 'azure'); await seedClan('Ember', 'ember'); await seedClan('Jade', 'jade');
    await kv.set('save:clan-azure', { ...record, doctrine: 'warmonger' });
    const first = await declare({ playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-warmonger-cost-0001' });
    assert.equal(first.character.honorSeals, 410);
    const endedAt = Date.now();
    await kv.set('clan-war:azure-vs-ember', { ...first.war, endedAt,
        campaign: { ...first.war.campaign, closedAt: endedAt } });
    await assert.rejects(declare({ playerName: 'azure-0', toClan: 'Jade', requestId: 'campaign-recovery-jade-0001' }), /recovering/);
    assert.equal(CLAN_WAR_RULES.recoveryMs, 3 * 86_400_000);
});

test('a failed atomic war publication refunds the wallet and releases both pending claims', async () => {
    await seedClan('Azure', 'azure'); await seedClan('Ember', 'ember');
    const original = kv.compareSetMany!.bind(kv);
    let failed = false;
    kv.compareSetMany = async ops => {
        if (!failed && ops.some(op => op.op === 'cas' && op.key === 'clan-war:azure-vs-ember')) {
            failed = true; throw new Error('injected campaign publication failure');
        }
        return original(ops);
    };
    try {
        await assert.rejects(declare({ playerName: 'azure-0', toClan: 'Ember', requestId: 'campaign-refund-credit-0001' }), /returned/);
    } finally { kv.compareSetMany = original; }
    assert.equal(await kv.get('clan-war:azure-vs-ember'), null);
    assert.equal(await kv.get(key('Azure')), null);
    assert.equal(await kv.get(key('Ember')), null);
    assert.equal((await kv.get<Record<string, any>>('save:azure-0'))?.character.honorSeals, 500);
});

test('pool-funded declarations atomically spend the pool, leave the wallet alone and retain their funding on retry',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    await kv.set('clan-seal-pool:azure',{clanName:'Azure',balance:500,log:[]});
    const input={playerName:'azure-0',toClan:'Ember',requestId:'campaign-pool-normal-000001',funding:'pool' as const};
    const result=await declare(input);assert.equal(result.character.honorSeals,500);
    assert.equal((await kv.get<Record<string,any>>('clan-seal-pool:azure'))!.balance,400);
    assert.equal((await kv.get<Record<string,any>>('clan-seal-pool:azure'))!.log[0].kind,'war-declare');
    assert.equal((await declare(input)).war.campaign!.instanceId,result.war.campaign!.instanceId);
    assert.equal((await kv.get<Record<string,any>>('clan-seal-pool:azure'))!.balance,400);
    await assert.rejects(declare({...input,funding:'personal'}),/original funding/);
});
test('an empty Seal Pool never falls back to personal Seals or leaves pending clan claims',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    await assert.rejects(declare({playerName:'azure-0',toClan:'Ember',requestId:'campaign-pool-short-000001',funding:'pool'}),/Seal Pool/);
    assert.equal((await kv.get<Record<string,any>>('save:azure-0'))!.character.honorSeals,500);
    assert.equal(await kv.get(key('Azure')),null);assert.equal(await kv.get(key('Ember')),null);
});
test('a lost pool transaction reply cannot charge twice, create half a war or trigger a wallet refund',async()=>{
    await seedClan('Azure','azure');await seedClan('Ember','ember');
    await kv.set('clan-seal-pool:azure',{clanName:'Azure',balance:500,log:[]});
    const original=kv.compareSetMany!;let armed=true;
    kv.compareSetMany=async ops=>{const result=await original.call(kv,ops);if(armed&&result&&ops.some(op=>op.key==='clan-seal-pool:azure')){armed=false;throw new Error('lost pool transaction reply');}return result;};
    const input={playerName:'azure-0',toClan:'Ember',requestId:'campaign-pool-lost-000001',funding:'pool' as const};
    try{assert.ok((await declare(input)).war.campaign);}finally{kv.compareSetMany=original;}
    assert.equal((await declare(input)).character.honorSeals,500);assert.equal((await kv.get<Record<string,any>>('clan-seal-pool:azure'))!.balance,400);
    for(const clan of ['Azure','Ember'])assert.equal((await kv.get<Record<string,unknown>>(key(clan)))!.state,'active');
});

test('a plain clan member cannot declare war: refused before any seal is charged or war created', async () => {
    await seedClan('Azure', 'azure'); await seedClan('Ember', 'ember');
    await assert.rejects(declare({ playerName: 'azure-1', toClan: 'Ember', requestId: 'campaign-declare-member-0001' }), /leadership/);
    assert.equal((await kv.get<Record<string, any>>('save:azure-1'))!.character.honorSeals, 500);
    const { clanWarKey } = await import('./_storage.js');
    assert.equal(await kv.get(clanWarKey('Azure', 'Ember')), null);
});