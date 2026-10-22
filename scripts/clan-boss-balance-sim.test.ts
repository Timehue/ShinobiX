import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CLAN_BOSSES } from '../api/clan-boss/_storage.js';
import { simulateClanBossCampaign } from './clan-boss-campaign-sim.js';

describe('Clan Boss version-two weekly campaign balance', () => {
    it('the same maxed trio cannot clear a twenty-member weekly pool within five legal joint attempts', () => {
        for (let boss = 0; boss < CLAN_BOSSES.length; boss++) {
            const row = simulateClanBossCampaign({ boss, roster: 20, partySize: 3, profile: 'sustain', seed: 71000, fixed: true });
            assert.equal(row.killed, false, row.bossId);
            assert.equal(row.assaults, 5); assert.equal(row.participantAttempts, 15);
            assert.ok(row.damagePct > 0 && row.damagePct < 60, JSON.stringify({ boss: row.bossId, damage: row.damagePct }));
            assert.ok(Object.values(row.attempts).every(n => n === 5));
        }
    });
    it('a broader coordinated roster can complete all four bosses without exhausting its weekly budget', () => {
        for (let boss = 0; boss < CLAN_BOSSES.length; boss++) {
            const row = simulateClanBossCampaign({ boss, roster: 20, partySize: 4, profile: 'sustain', seed: 71000 });
            assert.equal(row.killed, true, row.bossId);
            assert.ok(row.participantAttempts <= 80, JSON.stringify({ boss: row.bossId, attempts: row.participantAttempts }));
            assert.ok(row.distinctParticipants > 3); assert.equal(row.failedCommands, 0);
        }
    });
});
