import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClanWarCampaign, CLAN_WAR_RULES } from '../../../shared/clan-war-campaign.js';
import type { ClanWar } from './_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('../../_storage.js').kv;
let sweep: typeof import('./_campaign-sweep.js').runClanWarCampaignSweep;
before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ runClanWarCampaignSweep: sweep } = await import('./_campaign-sweep.js'));
});
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); });

async function seedWar(id: string, declaredAt: number): Promise<ClanWar> {
    const rosters = [{ clan: 'Azure', members: ['a-0', 'a-1', 'a-2', 'a-3'].map(name => ({ name, level: 15 })) },
        { clan: 'Ember', members: ['b-0', 'b-1', 'b-2', 'b-3'].map(name => ({ name, level: 15 })) }] as const;
    const campaign = createClanWarCampaign({ instanceId: `cw2-sweep-${id}`.padEnd(24, '0').slice(0, 24), now: declaredAt,
        rosters: [rosters[0], rosters[1]], sectors: Array(6).fill(12), offsets: Array(6).fill(0),
        modes: ['pvp1v1', 'pet1v1', 'tilecards', 'pvp1v1', 'tilecards', 'pet1v1'] });
    const war: ClanWar = { id, campaign, clans: ['Azure', 'Ember'], villages: {}, hp: { Azure: 1000, Ember: 1000 },
        startedAt: campaign.declaredAt, updatedAt: campaign.declaredAt, declaredBy: 'a-0', pendingChallenges: [], completedChallenges: [] };
    await kv.set(`clan-war:${id}`, war);
    return war;
}

test('closes a campaign whose clock ran out though nobody opened the war list again', async () => {
    const now = Date.now();
    const finished = await seedWar('azure-vs-ember', now - CLAN_WAR_RULES.preparationMs - 30 * 86_400_000);
    assert.ok(now >= finished.campaign!.endsAt, 'fixture: the campaign is over');
    const running = await seedWar('azure-vs-frost', now - CLAN_WAR_RULES.preparationMs);

    const out = await sweep(now);
    assert.deepEqual(out.failures, []);
    assert.deepEqual(out.reconciled, ['azure-vs-ember']);
    const closed = (await kv.get<ClanWar>('clan-war:azure-vs-ember'))!;
    assert.equal(closed.endedAt, finished.campaign!.endsAt, 'closed at its own end time, by timeout');
    assert.equal((await kv.get<ClanWar>('clan-war:azure-vs-frost'))!.endedAt, undefined, 'a live campaign is left alone');
    assert.ok(now < running.campaign!.endsAt);
});

test('skips a campaign past the 60-day payout window', async () => {
    const now = Date.now();
    const ancient = await seedWar('azure-vs-stone', now - CLAN_WAR_RULES.preparationMs - 120 * 86_400_000);
    assert.ok(now > ancient.campaign!.endsAt + 60 * 86_400_000);
    assert.deepEqual((await sweep(now)).reconciled, []);
});
