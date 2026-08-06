import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from '../towers/_floor-catalog.js';
import { configureClanBossEncounter } from './_encounter-config.js';

const squad: SquadMemberInput[] = [{
    id: 'hero',
    name: 'Hero',
    ownerSlug: 'hero',
    ai: false,
    character: { level: 100, maxHp: 10_000, maxChakra: 1_000, maxStamina: 1_000, stats: {}, jutsu: [] },
}];

describe('Clan Boss encounter invariants', () => {
    it('seals the persistent-pool HP, authored round deadline, PvE guard, and AI mastery', () => {
        const floor = CLAN_BOSS_FLOORS[2]!;
        const session = buildTowerEncounter({ floor, squad, runId: 'cboss-config', seed: 7, partySize: 1, now: 1 });
        const boss = configureClanBossEncounter(session, floor, 24_000);
        assert.equal(boss.hp, 24_000);
        assert.equal(boss.maxHp, 24_000);
        assert.equal(session.roundCap, floor.roundBudget);
        assert.equal(session.regenFlatCap, 150);
        assert.equal(session.pveGuard?.enemyLevel, boss.character.level);
        assert.ok(Array.isArray(boss.character.jutsuMastery));
    });

    it('keeps the solo regeneration cap below a hard percentage wall', () => {
        const floor = CLAN_BOSS_FLOORS[2]!;
        assert.equal(floor.boss?.mechanic, 'regen');
        assert.equal(floor.boss?.regenFlatCap, 150);
    });
});
