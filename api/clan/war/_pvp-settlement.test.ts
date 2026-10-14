import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PvpSession } from '../../pvp/session.js';
import type { ClanWar } from './_storage.js';
import { CLAN_WAR_RULES, createClanWarCampaign, joinClanWarQueue, matchClanWarQueue,
    readyClanWarMatch, startClanWarMatch, type ClanWarCampaignMutation } from '../../../shared/clan-war-campaign.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../../_storage.js').kv;
let settle: typeof import('./_pvp-settlement.js').settlePvpClanWarContinuation;
let scrollDrop: typeof import('./_war-points.js').clanWarPvpTerritoryScrollDrop;

for(const late of [false,true])test(`campaign shrine PvP ${late?'late':'scored'} scroll projection matches delivery and replay`,async()=>{
    const prefix=late?'pvp-v2-late-scroll':'pvp-v2-scored-scroll';
    let battleId='';for(let index=0;index<200;index++){const candidate=`${prefix}-${index}`;if(scrollDrop(candidate,'clanpvpfrom')){battleId=candidate;break;}}
    assert.ok(battleId,'the deterministic fixture found a successful legacy 20% roll');
    const session=terminal(battleId),terminalAt=Number(session.endedAt);
    let campaign=createClanWarCampaign({instanceId:`cw2-${battleId}`,now:terminalAt-CLAN_WAR_RULES.preparationMs-CLAN_WAR_RULES.shrineWindowMs+(late?-1000:1000),
        rosters:[{clan:'From',members:['clanpvpfrom','from1','from2','from3'].map(name=>({name,level:30}))},
            {clan:'To',members:['clanpvpto','to1','to2','to3'].map(name=>({name,level:30}))}],
        sectors:Array(6).fill(12),offsets:Array(6).fill(0),modes:['pvp1v1','pet1v1','tilecards','tilecards','pet1v1','pvp1v1']});
    const admittedAt=campaign.shrines[0].closesAt-16*60_000;
    const next=(result:ClanWarCampaignMutation)=>{assert.ok(result.ok,result.ok?'':result.error);return result.campaign;};
    for(const [clan,name] of [['From','clanpvpfrom'],['To','clanpvpto']])campaign=next(joinClanWarQueue(campaign,{entryId:`entry-${clan}`,clan,name,mode:'pvp1v1',scope:'shrine',windowIndex:0,now:admittedAt}));
    campaign=next(matchClanWarQueue(campaign,session.clanWarChallengeId!,admittedAt));
    for(const name of ['clanpvpfrom','clanpvpto'])campaign=next(readyClanWarMatch(campaign,session.clanWarChallengeId!,name,admittedAt));
    campaign=next(startClanWarMatch(campaign,session.clanWarChallengeId!,admittedAt));
    session.createdAt=admittedAt;await seed(session);
    const key=`clan-war:${session.clanWarId}`,war=(await kv.get<ClanWar>(key))!;
    await kv.set(key,{...war,campaign,startedAt:campaign.declaredAt,pendingChallenges:war.pendingChallenges.map(challenge=>({...challenge,campaignMatchId:challenge.id,createdAt:admittedAt,acceptedAt:admittedAt,expiresAt:campaign.shrines[0].closesAt}))});
    const first=await settle(session),replay=await settle(session);
    const expected=late?{}:{clanpvpfrom:1};
    assert.deepEqual(first?.territoryScrollsByPlayer,expected);assert.deepEqual(replay?.territoryScrollsByPlayer,expected);
    assert.equal(scrollCount(await kv.get('save:clanpvpfrom')),late?0:1);
    assert.equal((await kv.get<Record<string,any>>('save:clanpvpfrom'))!.character.clanPoints,late?0:50);
});

function scrollCount(save: Record<string, any> | null): number {
    return (save?.character?.itemStacks ?? [])
        .filter((stack: Record<string, unknown>) => stack.itemId === 'territory-control-scroll')
        .reduce((sum: number, stack: Record<string, unknown>) => sum + Number(stack.count ?? 0), 0);
}

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ settlePvpClanWarContinuation: settle } = await import('./_pvp-settlement.js'));
    ({ clanWarPvpTerritoryScrollDrop: scrollDrop } = await import('./_war-points.js'));
});

function terminal(battleId: string, overrides: Partial<PvpSession> = {}): PvpSession {
    const endedAt = Date.now() - 500;
    return {
        battleId,
        p1: { name: 'clanpvpfrom', character: { name: 'clanpvpfrom', clan: 'From' } },
        p2: { name: 'clanpvpto', character: { name: 'clanpvpto', clan: 'To' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'clan-war',
        clanWarId: 'from-vs-to',
        clanWarChallengeId: `challenge-${battleId}`,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        round: 2,
        activePlayer: 'p1',
        ap: { p1: 0, p2: 0 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        createdAt: endedAt - 1_000,
        endedAt,
        ...overrides,
    } as unknown as PvpSession;
}

async function seed(session: PvpSession): Promise<void> {
    for (const [name, clan] of [['clanpvpfrom', 'From'], ['clanpvpto', 'To']] as const) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                clan,
                clanPoints: 0,
                weeklyClanPoints: 0,
                lifetimeClanPoints: 0,
                clanPointHistory: [],
                serverSettlementReceipts: [],
            },
        });
    }
    const challenge = {
        id: session.clanWarChallengeId,
        mode: 'pvp1v1',
        fromClan: 'From',
        fromPlayer: 'clanpvpfrom',
        acceptedPlayer: 'clanpvpto',
        createdAt: Number(session.createdAt) - 2_000,
        acceptedAt: Number(session.createdAt) - 1_000,
        expiresAt: Number(session.endedAt) + 60_000,
        status: 'accepted',
        battleId: session.battleId,
    };
    await kv.set(`clan-war:${session.clanWarId}`, {
        id: session.clanWarId,
        clans: ['From', 'To'],
        villages: { From: 'Leaf', To: 'Mist' },
        hp: { From: 100, To: 100 },
        startedAt: Number(session.createdAt) - 5_000,
        updatedAt: Number(session.createdAt) - 5_000,
        declaredBy: 'clanpvpfrom',
        pendingChallenges: [challenge],
        completedChallenges: [],
    });
}

test('either claimant can finalize the sealed Clan War result and crash replay cannot duplicate points', async () => {
    const session = terminal('pvp-clan-server-owned-0001');
    await seed(session);
    const first = await settle(session);
    assert.equal(first?.outcome, 'applied');
    const war = await kv.get<Record<string, any>>(`clan-war:${session.clanWarId}`);
    assert.equal(war?.hp?.To, 70);
    assert.equal(war?.pendingChallenges.length, 0);
    assert.equal(war?.completedChallenges[0]?.battleId, session.battleId);
    const winner = await kv.get<Record<string, any>>('save:clanpvpfrom');
    const loser = await kv.get<Record<string, any>>('save:clanpvpto');
    assert.equal(winner?.character.clanPoints, 50);
    assert.equal(loser?.character.clanPoints, 25);
    assert.deepEqual(first?.pointsByPlayer, { clanpvpfrom: 50, clanpvpto: 25 });
    const expectedScrolls = scrollDrop(session.battleId, 'clanpvpfrom') ? 1 : 0;
    assert.deepEqual(first?.territoryScrollsByPlayer, { clanpvpfrom: expectedScrolls });
    assert.equal(scrollCount(winner), expectedScrolls, 'winner receives exactly one scroll only when the 20% roll succeeds');
    assert.equal(scrollCount(loser), 0, 'loser receives participation points but no scroll drop');

    // Model process death after the war/save CAS writes but before the external
    // continuation receipt. The embedded completed challenge and per-save PvP
    // journals reconstruct completion without applying either effect twice.
    await kv.del(`pvp:clan-war-continuation:${session.battleId}`);
    const recovered = await settle(session);
    assert.equal(recovered?.outcome, 'applied');
    assert.deepEqual(recovered?.pointsByPlayer, { clanpvpfrom: 50, clanpvpto: 25 });
    assert.deepEqual(recovered?.territoryScrollsByPlayer, { clanpvpfrom: expectedScrolls });
    const recoveredWinner = await kv.get<Record<string, any>>('save:clanpvpfrom');
    const recoveredLoser = await kv.get<Record<string, any>>('save:clanpvpto');
    assert.equal(recoveredWinner?.character.clanPoints, 50);
    assert.equal(recoveredLoser?.character.clanPoints, 25);
    assert.equal(scrollCount(recoveredWinner), expectedScrolls, 'crash recovery cannot reroll or duplicate the drop');
    assert.equal(scrollCount(recoveredLoser), 0);
    const replay = await settle(session);
    assert.equal(replay?.replayed, true);
    assert.deepEqual(replay?.pointsByPlayer, { clanpvpfrom: 50, clanpvpto: 25 });
    assert.deepEqual(replay?.territoryScrollsByPlayer, { clanpvpfrom: expectedScrolls });
});

test('the secret-backed scroll roll is stable and approximately twenty percent', () => {
    const outcomes = Array.from({ length: 5_000 }, (_, index) =>
        scrollDrop(`distribution-${index}`, 'clanpvpfrom', 'fixed-test-secret'));
    const drops = outcomes.filter(Boolean).length;
    assert.ok(drops >= 900 && drops <= 1_100, `expected about 1,000 drops, got ${drops}`);
    assert.equal(
        scrollDrop('stable-battle', 'ClanPvpFrom', 'fixed-test-secret'),
        scrollDrop('stable-battle', 'clanpvpfrom', 'fixed-test-secret'),
    );
});

test('participant drift or a conflicting completed result fails closed', async () => {
    const session = terminal('pvp-clan-server-owned-0002', {
        p2: { name: 'outsider', character: { name: 'outsider', clan: 'Else' } } as never,
    });
    await seed(session);
    await assert.rejects(() => settle(session), /participants-conflict/);
    const war = await kv.get<Record<string, any>>(`clan-war:${session.clanWarId}`);
    assert.equal(war?.hp?.To, 100);
});

test('a battle overtaken by another ending blow records a canonical superseded continuation', async () => {
    const session = terminal('pvp-clan-server-owned-0003');
    await seed(session);
    const key = `clan-war:${session.clanWarId}`;
    const row = await kv.get<Record<string, any>>(key);
    const swept = { ...row!.pendingChallenges[0], status: 'cancelled' };
    await kv.set(key, {
        ...row,
        endedAt: Number(session.endedAt) - 1,
        winnerClan: 'From',
        pendingChallenges: [],
        completedChallenges: [swept],
    });
    const result = await settle(session);
    assert.equal(result?.outcome, 'superseded');
    assert.deepEqual(result?.pointsByPlayer, {});
    assert.deepEqual(result?.territoryScrollsByPlayer, {});
    assert.equal((await kv.get<Record<string, any>>(key))?.hp?.To, 100);
    assert.equal(scrollCount(await kv.get<Record<string, any>>('save:clanpvpfrom')), 0);
    assert.equal(scrollCount(await kv.get<Record<string, any>>('save:clanpvpto')), 0);
    assert.equal((await settle(session))?.replayed, true);
});

test('a legacy or admin report completed before claim is backfilled without duplicate side effects', async () => {
    const session = terminal('pvp-clan-server-owned-0004');
    await seed(session);
    const key = `clan-war:${session.clanWarId}`;
    const row = await kv.get<Record<string, any>>(key);
    const legacyCompleted = {
        ...row!.pendingChallenges[0],
        status: 'completed',
        result: 'from-wins',
        completedAt: Number(session.endedAt),
    };
    await kv.set(key, {
        ...row,
        hp: { ...row!.hp, To: 70 },
        pendingChallenges: [],
        completedChallenges: [legacyCompleted],
    });

    const result = await settle(session);
    assert.equal(result?.outcome, 'superseded');
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpfrom'))?.character.clanPoints, 0);
    assert.equal((await kv.get<Record<string, any>>('save:clanpvpto'))?.character.clanPoints, 0);
    assert.equal(scrollCount(await kv.get<Record<string, any>>('save:clanpvpfrom')), 0);
    assert.equal(scrollCount(await kv.get<Record<string, any>>('save:clanpvpto')), 0);
    assert.equal((await kv.get<Record<string, any>>(key))?.hp?.To, 70);
    assert.equal((await settle(session))?.replayed, true);
});
