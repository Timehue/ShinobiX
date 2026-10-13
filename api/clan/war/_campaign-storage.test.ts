import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClanWarCampaign, joinClanWarQueue, matchClanWarQueue, readyClanWarMatch, startClanWarMatch,
    type ClanWarCampaign, type ClanWarCampaignMutation } from '../../../shared/clan-war-campaign.js';
import type { ClanChallenge, ClanWar } from './_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let storage: typeof import('./_storage.js');
let points: typeof import('./_war-points.js');
before(async () => { storage = await import('./_storage.js'); points = await import('./_war-points.js'); });

function next(result: ClanWarCampaignMutation): ClanWarCampaign {
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.campaign;
}
function fixture(): { war: ClanWar; challenge: ClanChallenge; now: number } {
    const declaredAt = Date.now() - 26 * 60 * 60_000;
    let campaign = createClanWarCampaign({ instanceId: 'campaign-storage-test', now: declaredAt,
        rosters: [{ clan: 'Azure', members: [0, 1, 2, 3].map(i => ({ name: `a${i}`, level: 100 })) },
            { clan: 'Ember', members: [0, 1, 2, 3].map(i => ({ name: `b${i}`, level: 100 })) }],
        sectors: [1, 2, 3, 4, 5, 6], offsets: [0, 0, 0, 0, 0, 0],
        modes: ['pvp1v1', 'pet1v1', 'tilecards', 'pet1v1', 'tilecards', 'pvp1v1'] });
    const now = campaign.startsAt + 1000;
    campaign = next(joinClanWarQueue(campaign, { entryId: 'from', clan: 'Azure', name: 'a0', mode: 'tilecards', scope: 'normal', now }));
    campaign = next(joinClanWarQueue(campaign, { entryId: 'to', clan: 'Ember', name: 'b0', mode: 'tilecards', scope: 'normal', now }));
    campaign = next(matchClanWarQueue(campaign, 'admitted-match', now));
    for (const name of ['a0', 'b0']) campaign = next(readyClanWarMatch(campaign, 'admitted-match', name, now));
    campaign = next(startClanWarMatch(campaign, 'admitted-match', now));
    const challenge: ClanChallenge = { id: 'admitted-match', campaignMatchId: 'admitted-match', mode: 'tilecards',
        fromClan: 'Azure', fromPlayer: 'a0', acceptedPlayer: 'b0', createdAt: now, acceptedAt: now,
        status: 'accepted', expiresAt: campaign.endsAt };
    return { now, challenge, war: { id: 'azure-vs-ember', campaign, clans: ['Azure', 'Ember'], villages: {},
        hp: { Azure: 1000, Ember: 1000 }, startedAt: declaredAt, updatedAt: now,
        declaredBy: 'a0', pendingChallenges: [challenge], completedChallenges: [] } };
}

test('the existing authoritative result helper scores a v2 match without altering legacy HP or ending the campaign', () => {
    const { war, challenge, now } = fixture();
    const settled = storage.applyFinalResult(war, challenge, 'from-wins', now + 1000);
    assert.equal(settled.war.campaign?.scores.Azure, 100);
    assert.deepEqual(settled.war.hp, war.hp);
    assert.equal(settled.warJustEnded, false);
    assert.equal(settled.war.endedAt, undefined);
    assert.deepEqual(storage.computeMvpByClan(settled.war), { Azure: 'a0', Ember: 'b0' });
    assert.deepEqual(points.finalizedWarPointTotals({ war: settled.war, challenge: settled.completed }), { a0: 50, b0: 25 });
});

test('v2 draws retain participation rewards but late or unadmitted matches cannot pay', () => {
    const { war, challenge, now } = fixture();
    const drawn = storage.applyFinalResult(war, challenge, 'draw', now + 1000);
    assert.deepEqual(points.finalizedWarPointTotals({ war: drawn.war, challenge: drawn.completed }), { a0: 25, b0: 25 });
    const late = storage.applyFinalResult(war, challenge, 'from-wins', war.campaign!.endsAt + 1);
    assert.deepEqual(points.finalizedWarPointTotals({ war: late.war, challenge: late.completed }), {});
    assert.throws(() => storage.applyFinalResult(war, { ...challenge, campaignMatchId: undefined }, 'from-wins', now), /admitted/);
    assert.throws(() => storage.applyFinalResult(war, { ...challenge, campaignMatchId: 'forged' }, 'from-wins', now), /refused/);
});

test('campaign reads neither apply unanswered-challenge penalties nor freeze unreconciled terminal scores', () => {
    const { war } = fixture();
    const pending: ClanChallenge = { id: 'legacy-in-campaign', mode: 'pvp1v1', fromClan: 'Azure', fromPlayer: 'a1',
        status: 'pending', createdAt: 1, expiresAt: 2 };
    const projected = storage.applyLazyClanWarExpiry({ ...war, pendingChallenges: [...war.pendingChallenges, pending] }, war.campaign!.endsAt + 1);
    assert.deepEqual(projected.war.hp, war.hp);
    assert.equal(projected.war.endedAt, undefined);
    assert.equal(projected.needsCooldownStamp, false);
});

test('delayed campaign closure keeps its deadline and never regresses the projection timestamp', () => {
    const { war } = fixture();
    const endsAt = war.campaign!.endsAt;
    const ended = storage.finalizeClanWarEnd({ ...war, updatedAt: endsAt + 10_000 }, { endedAt: endsAt, reason: 'timeout' });
    assert.equal(ended.endedAt, endsAt);
    assert.equal(ended.updatedAt, endsAt + 10_000);
    assert.equal(ended.campaign?.closedAt, endsAt);
});

test('wire redaction omits future shrine secrets and rival queue identities while retaining the actor’s match', () => {
    const { war, now } = fixture();
    const redacted = storage.redactClanWarForViewer(war, 'Azure', 'a0', now);
    assert.equal(redacted.campaign, undefined);
    assert.equal(redacted.campaignView?.version, 2);
    assert.equal(redacted.campaignView?.matches[0].id, 'admitted-match');
    assert.equal(redacted.campaignView?.shrines[1].sector, undefined);
    assert.equal(redacted.campaignView?.shrines[1].mode, undefined);
    const outsider = storage.redactClanWarForViewer(war, 'Other', 'other', now);
    assert.equal(outsider.campaignView?.eligible, false);
    assert.deepEqual(outsider.campaignView?.matches, []);
    assert.deepEqual(outsider.campaignView?.eligibleMembers, []);
    assert.deepEqual(outsider.campaignView?.contributions, []);
    assert.deepEqual(outsider.campaignView?.queue, []);
});

test('legacy HP results and legacy draw rewards keep their existing authority', () => {
    const { war, challenge, now } = fixture();
    const legacy = { ...war, campaign: undefined };
    const settled = storage.applyFinalResult(legacy, challenge, 'from-wins', now + 1000);
    assert.equal(settled.war.hp.Ember, 990);
    assert.equal(settled.war.campaign, undefined);
    const drawn = storage.applyFinalResult(legacy, challenge, 'draw', now + 1000);
    assert.deepEqual(points.finalizedWarPointTotals({ war: drawn.war, challenge: drawn.completed }), {});
});
