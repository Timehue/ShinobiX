import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLAN_WAR_RULES, createClanWarCampaign, clanWarCampaignDay, clanWarCampaignPhase,
    clanWarAdmissionError, joinClanWarQueue, leaveClanWarQueue, matchClanWarQueue,
    readyClanWarMatch, startClanWarMatch, completeClanWarMatch, cancelClanWarMatch,
    closeClanWarCampaign, pruneClanWarQueue, projectClanWarCampaign,
    clanWarPlayerKey,
    type ClanWarCampaign, type ClanWarCampaignMutation, type ClanWarQueueMode,
} from './clan-war-campaign.js';

const NOW = 1_790_000_000_000;

describe('account and clan names matching inherited properties',()=>{
    for(const name of ['constructor','__proto__'])it(`${name} has real limits, refunds and frozen participation`,()=>{
        let campaign=fixture();campaign.rosters[0].members[0]={name,level:100};
        const now=campaign.startsAt+1000;
        const initial=projectClanWarCampaign(campaign,'Azure',name,now);
        assert.equal(initial.normal.memberUsed,0);assert.equal(initial.playerContribution,undefined);
        for(let index=0;index<5;index++){
            const id=`reserved-name-${index}`;campaign=admit(campaign,id,'pvp1v1',[name],['b0'],now);
            campaign=accepted(completeClanWarMatch(campaign,id,'from-wins',now+1));
        }
        assert.ok(clanWarAdmissionError(campaign,{clan:'Azure',players:[name],mode:'pvp1v1',scope:'normal',now}));
        campaign=admit(campaign,'reserved-cancel','pvp1v1',[name],['b0'],now,0);
        campaign=accepted(cancelClanWarMatch(campaign,'reserved-cancel',now+1,'service',true));
        assert.equal(projectClanWarCampaign(campaign,'Azure',name,now).shrines[0].memberUsed,0);
        for(let index=0;index<2;index++){
            const id=`reserved-shrine-${index}`;campaign=admit(campaign,id,'pvp1v1',[name],['b0'],now,0);
            campaign=accepted(completeClanWarMatch(campaign,id,'from-wins',now+1));
        }
        const final=projectClanWarCampaign(campaign,'Azure',name,now);
        assert.equal(final.normal.memberUsed,5);assert.equal(final.shrines[0].memberUsed,2);
        assert.equal(final.playerContribution?.played,7);assert.equal(final.playerContribution?.normalPoints,500);
        assert.equal(final.playerContribution?.shrinePoints,200);assert.equal(campaign.scores.Azure,700);
        assert.ok(clanWarAdmissionError(campaign,{clan:'Azure',players:[name],mode:'pvp1v1',scope:'shrine',windowIndex:0,now}));
    });
    it('a constructor clan cannot inherit the other clan’s provisions',()=>{
        const base=fixture();
        let campaign=createClanWarCampaign({instanceId:'reserved-clan-test',now:NOW,
            rosters:[{...base.rosters[0],clan:'constructor'},base.rosters[1]],sectors:base.shrines.map(entry=>entry.sector),
            offsets:Array(6).fill(0),modes:base.shrines.map(entry=>entry.mode)});
        const now=campaign.startsAt+1000;
        campaign.provisions={Ember:[{day:0,activatedAt:now}]};
        assert.equal(projectClanWarCampaign(campaign,'constructor','a0',now).provisioned,false);
        campaign=admit(campaign,'reserved-clan-match','pvp1v1',['a0'],['b0'],now);
        assert.deepEqual(campaign.matches['reserved-clan-match'].provisionedClans,['Ember']);
    });
});
function fixture(): ClanWarCampaign {
    return createClanWarCampaign({
        instanceId: 'test-campaign-1', now: NOW,
        rosters: [
            { clan: 'Azure', members: Array.from({ length: 4 }, (_, i) => ({ name: `a${i}`, level: 100 })) },
            { clan: 'Ember', members: Array.from({ length: 4 }, (_, i) => ({ name: `b${i}`, level: 100 })) },
        ],
        sectors: [41, 42, 43, 44, 45, 46], offsets: [0, 0, 0, 0, 0, 0],
        modes: ['pvp1v1', 'pet1v1', 'tilecards', 'tilecards', 'pvp1v1', 'pet1v1'],
    });
}
function accepted(result: ClanWarCampaignMutation): ClanWarCampaign {
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    if (!result.ok) throw new Error(result.error);
    return result.campaign;
}
function admit(campaign: ClanWarCampaign, id: string, mode: ClanWarQueueMode,
    from: string[], to: string[], now: number, windowIndex?: number): ClanWarCampaign {
    const scope = windowIndex === undefined ? 'normal' : 'shrine';
    const fromClan=campaign.rosters[0].clan,toClan=campaign.rosters[1].clan;
    let next = accepted(joinClanWarQueue(campaign, { entryId: `${id}-from`, clan: fromClan, name: from[0], mode, scope, windowIndex, now }));
    if (from.length === 2) next = accepted(joinClanWarQueue(next, { entryId: `${id}-from2`, partnerEntryId: `${id}-from`, clan: fromClan, name: from[1], mode, scope, windowIndex, now }));
    next = accepted(joinClanWarQueue(next, { entryId: `${id}-to`, clan: toClan, name: to[0], mode, scope, windowIndex, now }));
    if (to.length === 2) next = accepted(joinClanWarQueue(next, { entryId: `${id}-to2`, partnerEntryId: `${id}-to`, clan: toClan, name: to[1], mode, scope, windowIndex, now }));
    next = accepted(matchClanWarQueue(next, id, now));
    for (const name of [...from, ...to]) next = accepted(readyClanWarMatch(next, id, name, now));
    return accepted(startClanWarMatch(next, id, now));
}

describe('clan war campaign schedule', () => {
    it('preserves the canonical account separators used by authentication and saves', () => {
        assert.equal(clanWarPlayerKey('A-KA_ITO'), 'a-ka_ito');
        assert.notEqual(clanWarPlayerKey('a-b'), clanWarPlayerKey('ab'));
        assert.notEqual(clanWarPlayerKey('a_b'), clanWarPlayerKey('ab'));
        assert.equal(clanWarPlayerKey('Aka Ito'), 'akaito');
    });
    it('has precise preparation/conflict boundaries and war-clock days', () => {
        const c = fixture();
        assert.equal(clanWarCampaignPhase(c, c.startsAt - 1), 'preparing');
        assert.equal(clanWarCampaignPhase(c, c.startsAt), 'active');
        assert.equal(clanWarCampaignPhase(c, c.endsAt), 'ended');
        assert.equal(clanWarCampaignDay(c, c.startsAt - 1), null);
        assert.equal(clanWarCampaignDay(c, c.startsAt), 0);
        assert.equal(clanWarCampaignDay(c, c.startsAt + CLAN_WAR_RULES.dayMs), 1);
        assert.equal(clanWarCampaignDay(c, c.endsAt - 1), 2);
        assert.equal(clanWarCampaignDay(c, c.endsAt), null);
        assert.throws(() => closeClanWarCampaign(c, c.endsAt - 1), /unfinished/);
    });
    it('rejects invalid schedules and overlapping player identities', () => {
        const c = fixture();
        const input = { instanceId: 'valid-instance', now: NOW, rosters: c.rosters,
            sectors: [1, 2, 3, 4, 5, 6], offsets: [0, 0, 0, 0, 0, 0], modes: c.shrines.map(w => w.mode) };
        assert.throws(() => createClanWarCampaign({ ...input, sectors: [1] }), /Six/);
        assert.throws(() => createClanWarCampaign({ ...input, offsets: [11 * 60 * 60_000, 0, 0, 0, 0, 0] }), /offset/);
        assert.throws(() => createClanWarCampaign({ ...input, modes: ['pvp1v1', 'pvp1v1', 'pvp1v1', 'pet1v1', 'pet1v1', 'pet1v1'] }), /specialties/);
        assert.throws(() => createClanWarCampaign({ ...input,
            rosters: [c.rosters[0], { ...c.rosters[1], members: c.rosters[0].members }] }), /distinct/);
        assert.throws(() => createClanWarCampaign({ ...input, now: NaN }), /timestamp/);
    });
    it('copies the roster and preserves all six sealed, bounded appearances', () => {
        const c = fixture();
        assert.equal(c.shrines.length, 6);
        for (const w of c.shrines) {
            assert.ok(w.opensAt >= c.startsAt + w.index * CLAN_WAR_RULES.shrineBlockMs);
            assert.ok(w.closesAt <= c.startsAt + (w.index + 1) * CLAN_WAR_RULES.shrineBlockMs);
        }
        assert.deepEqual(new Set(c.shrines.slice(0, 3).map(w => w.mode)), new Set(['pvp1v1', 'pet1v1', 'tilecards']));
    });
});

describe('queue and ready lifecycle', () => {
    it('matches oldest opposing entries, never same-clan entries', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        let next = c;
        for (const [entryId, clan, name, at] of [['new', 'Azure', 'a0', now + 1], ['old', 'Azure', 'a1', now], ['enemy', 'Ember', 'b0', now + 2]] as const) {
            next = accepted(joinClanWarQueue(next, { entryId, clan, name, now: at, mode: 'pet1v1', scope: 'normal' }));
        }
        const before = JSON.stringify(next);
        const matched = accepted(matchClanWarQueue(next, 'match-oldest', now + 3));
        assert.deepEqual(matched.matches['match-oldest'].fromPlayers, ['a1']);
        assert.deepEqual(matched.matches['match-oldest'].toPlayers, ['b0']);
        assert.equal(matched.queue.length, 1);
        assert.equal(JSON.stringify(next), before, 'projection mutated input state');
    });
    it('requires complete real 2v2 sides and all four ready confirmations', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        let next = accepted(joinClanWarQueue(c, { entryId: 'pair-a', clan: 'Azure', name: 'a0', mode: 'pvp2v2', scope: 'normal', now }));
        next = accepted(joinClanWarQueue(next, { entryId: 'pair-b', clan: 'Ember', name: 'b0', mode: 'pvp2v2', scope: 'normal', now }));
        assert.equal(Object.keys(accepted(matchClanWarQueue(next, 'not-full', now)).matches).length, 0);
        next = accepted(joinClanWarQueue(next, { entryId: 'partner-a', partnerEntryId: 'pair-a', clan: 'Azure', name: 'a1', mode: 'pvp2v2', scope: 'normal', now }));
        next = accepted(joinClanWarQueue(next, { entryId: 'partner-b', partnerEntryId: 'pair-b', clan: 'Ember', name: 'b1', mode: 'pvp2v2', scope: 'normal', now }));
        next = accepted(matchClanWarQueue(next, 'full', now));
        next = accepted(readyClanWarMatch(next, 'full', 'a0', now));
        assert.equal(startClanWarMatch(next, 'full', now).ok, false);
        assert.equal(readyClanWarMatch(next, 'full', 'not-a-member', now).ok, false);
        for (const name of ['a1', 'b0', 'b1']) next = accepted(readyClanWarMatch(next, 'full', name, now));
        const started = accepted(startClanWarMatch(next, 'full', now));
        assert.equal(started.days[0].clanUses.Azure, 2);
        assert.equal(started.days[0].memberUses.a0, 1);
        assert.deepEqual(accepted(startClanWarMatch(started, 'full', now)), started, 'start replay charged twice');
    });
    it('does not allow mode hopping, rival partners, simultaneous matches or recruits', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        const input = { entryId: 'one', clan: 'Azure', name: 'a0', mode: 'pvp1v1' as const, scope: 'normal' as const, now };
        const queued = accepted(joinClanWarQueue(c, input));
        assert.equal(joinClanWarQueue(queued, { ...input, mode: 'pet1v1' }).ok, false);
        assert.equal(joinClanWarQueue(c, { ...input, name: 'new-recruit' }).ok, false);
        const pair = accepted(joinClanWarQueue(c, { ...input, mode: 'pvp2v2' }));
        assert.equal(joinClanWarQueue(pair, { ...input, clan: 'Ember', name: 'b0', mode: 'pvp2v2', partnerEntryId: 'one' }).ok, false);
        const active = admit(c, 'active', 'pvp1v1', ['a0'], ['b0'], now);
        assert.equal(joinClanWarQueue(active, input).ok, false);
        assert.equal(leaveClanWarQueue(queued, 'A0').queue.length, 0);
    });
    it('expires stale queues and ready checks without consuming score or budgets', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        let next = accepted(joinClanWarQueue(c, { entryId: 'one', clan: 'Azure', name: 'a0', mode: 'pvp1v1', scope: 'normal', now }));
        assert.equal(pruneClanWarQueue(next, now + CLAN_WAR_RULES.queueLeaseMs).queue.length, 0);
        next = accepted(joinClanWarQueue(next, { entryId: 'two', clan: 'Ember', name: 'b0', mode: 'pvp1v1', scope: 'normal', now }));
        next = accepted(matchClanWarQueue(next, 'ready', now));
        const expired = pruneClanWarQueue(next, now + CLAN_WAR_RULES.readyMs);
        assert.equal(expired.matches.ready.status, 'cancelled');
        assert.equal(expired.days[0].clanUses.Azure, 0);
        assert.equal(expired.scores.Azure, 0);
        assert.equal(readyClanWarMatch(expired, 'ready', 'a0', now + CLAN_WAR_RULES.readyMs).ok, false);
        const retired = pruneClanWarQueue(expired, now + 3 * CLAN_WAR_RULES.readyMs);
        assert.equal(retired.matches.ready, undefined, 'unstarted cancellations must not exhaust the match journal');
    });
});

describe('normal participation and authoritative scoring', () => {
    it('shares member limits across modes and exactly bounds the clan/day pool', () => {
        let c = fixture(); const now = c.startsAt + 60 * 60_000;
        const modes: ClanWarQueueMode[] = ['pvp1v1', 'pet1v1', 'tilecards'];
        for (let i = 0; i < 20; i++) {
            c = admit(c, `match-${i}`, modes[i % 3], [`a${i % 4}`], [`b${i % 4}`], now + i * 1000);
            c = accepted(completeClanWarMatch(c, `match-${i}`, i < 12 ? 'from-wins' : 'to-wins', now + i * 1000 + 500));
        }
        assert.deepEqual(c.scores, { Azure: 1200, Ember: 800 });
        assert.equal(c.days[0].clanUses.Azure, 20);
        assert.equal(c.days[0].memberUses.a0, 5);
        assert.ok(clanWarAdmissionError(c, { clan: 'Azure', players: ['a0'], mode: 'tilecards', scope: 'normal', now: now + 30_000 }));
        const day2 = c.startsAt + CLAN_WAR_RULES.dayMs + 1000;
        assert.equal(clanWarAdmissionError(c, { clan: 'Azure', players: ['a0'], mode: 'pet1v1', scope: 'normal', now: day2 }), null);
    });
    it('2v2 awards 200 total and 100 contribution per winner, not 400', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        const started = admit(c, 'team', 'pvp2v2', ['a0', 'a1'], ['b0', 'b1'], now);
        const scored = accepted(completeClanWarMatch(started, 'team', 'from-wins', now + 1000));
        assert.equal(scored.scores.Azure, 200);
        assert.equal(scored.contributions.a0.normalPoints, 100);
        assert.equal(scored.contributions.a1.normalPoints, 100);
        assert.equal(scored.contributions.b0.played, 1);
        assert.equal(scored.contributions.a0.teamWins, 1);
        assert.deepEqual(accepted(completeClanWarMatch(scored, 'team', 'from-wins', now + 1000)), scored);
        assert.equal(completeClanWarMatch(scored, 'team', 'to-wins', now + 1000).ok, false);
    });
    it('draws consume attempts and retain genuine participation without awarding War Points', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        const scored = accepted(completeClanWarMatch(admit(c, 'draw', 'tilecards', ['a0'], ['b0'], now), 'draw', 'draw', now + 1000));
        assert.equal(scored.scores.Azure, 0);
        assert.equal(scored.contributions.a0.played, 1);
        assert.equal(scored.days[0].clanUses.Azure, 1);
    });
    it('service cancellation refunds both sides once and cannot erase a completed result', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        const started = admit(c, 'cancel', 'pvp2v2', ['a0', 'a1'], ['b0', 'b1'], now);
        const canceled = accepted(cancelClanWarMatch(started, 'cancel', now + 500, 'engine-refused'));
        assert.equal(canceled.days[0].clanUses.Azure, 0);
        assert.equal(canceled.days[0].clanUses.Ember, 0);
        assert.equal(canceled.days[0].memberUses.a0, 0);
        assert.deepEqual(accepted(cancelClanWarMatch(canceled, 'cancel', now + 600, 'again')), canceled);
        const completed = accepted(completeClanWarMatch(started, 'cancel', 'from-wins', now + 500));
        assert.equal(cancelClanWarMatch(completed, 'cancel', now + 600, 'erase').ok, false);
    });
    it('a day-boundary result keeps its admission budget and late results cannot add points', () => {
        const c = fixture(); const start = c.startsAt + CLAN_WAR_RULES.dayMs - 1000;
        const started = admit(c, 'boundary', 'pvp1v1', ['a0'], ['b0'], start);
        const scored = accepted(completeClanWarMatch(started, 'boundary', 'from-wins', start + 2000));
        assert.equal(scored.days[0].clanUses.Azure, 1);
        assert.equal(scored.days[1].clanUses.Azure, 0);
        const lastStart = c.endsAt - CLAN_WAR_RULES.admissionBufferMs - 1000;
        const late = accepted(completeClanWarMatch(admit(c, 'late', 'pvp1v1', ['a0'], ['b0'], lastStart), 'late', 'from-wins', c.endsAt + 1));
        assert.equal(late.scores.Azure, 0);
        assert.equal(late.matches.late.scoreEligible, false);
        assert.equal(late.contributions.a0, undefined);
        assert.equal(completeClanWarMatch(c, 'unstarted', 'from-wins', start).ok, false);
    });
});

describe('physical shrine scoring contract', () => {
    it('enforces the selected mode/window and a separate five-match shared pool', () => {
        let c = fixture(); const now = c.shrines[0].opensAt + 1000;
        assert.ok(clanWarAdmissionError(c, { clan: 'Azure', players: ['a0'], mode: 'pet1v1', scope: 'shrine', windowIndex: 0, now }));
        for (let i = 0; i < 5; i++) {
            c = admit(c, `shrine-${i}`, 'pvp1v1', [`a${i % 4}`], [`b${i % 4}`], now + i * 1000, 0);
            c = accepted(completeClanWarMatch(c, `shrine-${i}`, i < 2 ? 'from-wins' : 'to-wins', now + i * 1000 + 500));
        }
        assert.deepEqual(c.scores, { Azure: 200, Ember: 300 });
        assert.equal(c.shrines[0].usedMatches, 5);
        assert.equal(c.days[0].clanUses.Azure, 0);
        assert.equal(c.contributions.a0.normalPoints, 0);
        assert.equal(c.contributions.a0.shrinePoints, 100);
        assert.ok(clanWarAdmissionError(c, { clan: 'Azure', players: ['a1'], mode: 'pvp1v1', scope: 'shrine', windowIndex: 0, now: now + 10_000 }));
    });
    it('bounds personal shrine attempts and resets them only for the next appearance', () => {
        let c = fixture(); const now = c.shrines[0].opensAt + 1000;
        for (let i = 0; i < 2; i++) {
            c = admit(c, `personal-${i}`, 'pvp1v1', ['a0'], ['b0'], now + i * 1000, 0);
            c = accepted(completeClanWarMatch(c, `personal-${i}`, 'draw', now + i * 1000 + 500));
        }
        assert.equal(c.shrines[0].usedMatches, 2);
        assert.ok(clanWarAdmissionError(c, { clan: 'Azure', players: ['a0'], mode: 'pvp1v1', scope: 'shrine', windowIndex: 0, now: now + 3000 }));
        assert.equal(clanWarAdmissionError(c, { clan: 'Azure', players: ['a0'], mode: 'pet1v1', scope: 'shrine', windowIndex: 1, now: c.shrines[1].opensAt + 1000 }), null);
        assert.ok(clanWarAdmissionError(c, { clan: 'Azure', players: ['a1'], mode: 'pvp1v1', scope: 'shrine', windowIndex: 0, now: c.shrines[0].closesAt - CLAN_WAR_RULES.admissionBufferMs }));
    });
    it('refunds a failed shrine start without opening normal slots or awarding a bonus', () => {
        const c = fixture(); const now = c.shrines[0].opensAt + 1000;
        const canceled = accepted(cancelClanWarMatch(admit(c, 'failure', 'pvp1v1', ['a0'], ['b0'], now, 0), 'failure', now + 1000, 'service-failed'));
        assert.equal(canceled.shrines[0].usedMatches, 0);
        assert.equal(canceled.shrines[0].memberUses.a0, 0);
        assert.equal(canceled.days[0].clanUses.Azure, 0);
        assert.equal(canceled.scores.Azure, 0);
    });
});

describe('closure and reward eligibility ledger', () => {
    it('freezes the highest score, retains both sides’ participation and rejects late scoring', () => {
        const c = fixture(); const now = c.startsAt + 1000;
        const scored = accepted(completeClanWarMatch(admit(c, 'won', 'pet1v1', ['a0'], ['b0'], now), 'won', 'from-wins', now + 1000));
        const closed = closeClanWarCampaign(scored, c.endsAt);
        assert.equal(closed.winnerClan, 'Azure');
        assert.equal(closed.contributions.a0.played, 1);
        assert.equal(closed.contributions.b0.played, 1);
        assert.deepEqual(closeClanWarCampaign(closed, c.endsAt + 1000), closed);
        assert.equal(joinClanWarQueue(closed, { entryId: 'late', clan: 'Azure', name: 'a0', mode: 'pvp1v1', scope: 'normal', now: c.endsAt }).ok, false);
    });
    it('draws on equal scores, requires a participant for surrender, and closes ready matches', () => {
        const c = fixture();
        assert.equal(closeClanWarCampaign(c, c.endsAt).winnerClan, undefined);
        assert.throws(() => closeClanWarCampaign(c, c.startsAt + 1000, 'surrender', 'Other'), /participant/);
        assert.equal(closeClanWarCampaign(c, c.startsAt + 1000, 'surrender', 'Azure').winnerClan, 'Ember');
        assert.equal(closeClanWarCampaign(c, NOW + 1000, 'withdrawal').winnerClan, undefined);
        const now = c.startsAt + 1000;
        let ready = accepted(joinClanWarQueue(c, { entryId: 'a', clan: 'Azure', name: 'a0', mode: 'pvp1v1', scope: 'normal', now }));
        ready = accepted(joinClanWarQueue(ready, { entryId: 'b', clan: 'Ember', name: 'b0', mode: 'pvp1v1', scope: 'normal', now }));
        ready = accepted(matchClanWarQueue(ready, 'ready-end', now));
        assert.equal(closeClanWarCampaign(ready, c.endsAt).matches['ready-end'].status, 'cancelled');
    });
});
