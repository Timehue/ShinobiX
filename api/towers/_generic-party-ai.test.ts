import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFloor, TOWER_FLOOR_COUNT } from './_floor-catalog.js';
import { buildTowerEncounter, type SquadMemberInput } from './_encounter.js';
import {
    buildGenericTowerAiCharacter,
    GENERIC_TOWER_AI_PROFILE,
    genericTowerAiDisplayName,
    genericTowerAiMemberId,
} from './_generic-party-ai.js';
import { towerBattleLeaseMembers } from './_battle-lease.js';
import { pickAiAction } from './_engine.js';

function human(): SquadMemberInput {
    return {
        id: 'sq-0',
        name: 'Host',
        ownerSlug: 'host',
        ai: false,
        character: {
            level: 50,
            specialty: 'Taijutsu',
            stats: { taijutsuOffense: 900, taijutsuDefense: 800, strength: 300, speed: 250 },
            maxHp: 2_500,
            maxChakra: 500,
            maxStamina: 500,
        },
    };
}

describe('server-authored generic Tower recruit', () => {
    it('is clearly labeled, ownerless, AI-driven, and absent from account leases/rewards', () => {
        const floor = getFloor(5)!;
        const character = buildGenericTowerAiCharacter(floor.id);
        const recruit: SquadMemberInput = {
            id: 'sq-tower-ai:1',
            name: genericTowerAiDisplayName(genericTowerAiMemberId(1)),
            ownerSlug: '',
            ownerless: true,
            ai: true,
            character,
            itemCharges: {},
        };
        const session = buildTowerEncounter({
            floor,
            squad: [human(), recruit],
            runId: 'tower-generic-ai-test',
            seed: 7,
            partySize: 2,
            now: 1,
        });
        const actor = session.actors.find(candidate => candidate.id === recruit.id)!;
        assert.equal(actor.name, 'Tower Recruit I (AI)');
        assert.equal(actor.ai, true);
        assert.equal(actor.ownerSlug, null);
        assert.equal(actor.character.towerGenericAiProfile, GENERIC_TOWER_AI_PROFILE);
        assert.equal(actor.character.towerRewardEligibility, 'none');
        assert.deepEqual(actor.itemCharges, {});
        assert.deepEqual(towerBattleLeaseMembers(session), ['host']);
    });

    it('stays intentionally low-skill and below a real player build across Story floors', () => {
        assert.equal(TOWER_FLOOR_COUNT, 15, 'the novice policy must cover the complete Chapter 2 catalog');
        for (const floor of [1, 5, 10, 15]) {
            const character = buildGenericTowerAiCharacter(floor);
            const stats = character.stats as Record<string, number>;
            const jutsu = character.jutsu as Array<Record<string, unknown>>;
            assert.equal(character.level, 30);
            assert.ok(Number(character.maxHp) <= 2_000, `floor ${floor} recruit HP remains modest`);
            assert.ok(stats.taijutsuOffense <= 550, `floor ${floor} offense remains novice-band`);
            assert.equal(jutsu.length, 1, 'no tactical loadout rotation');
            assert.equal(jutsu[0]?.ap, 100, 'the recruit can cast at most once per turn');
            assert.equal(jutsu[0]?.effectPower, 8);
            assert.equal(jutsu[0]?.method, 'SINGLE');
            assert.deepEqual(jutsu[0]?.tags, []);
            assert.equal(character.armorRawDR, 0);
            assert.equal(character.itemDamagePct, 0);
        }

        const floorTen = buildGenericTowerAiCharacter(10);
        const floorFifteen = buildGenericTowerAiCharacter(15);
        assert.ok(Number(floorFifteen.maxHp) > Number(floorTen.maxHp), 'F15 keeps the same weak linear floor scaling instead of capping at F10');
        assert.equal((floorFifteen.stats as Record<string, number>).taijutsuOffense, 530);
        assert.equal(buildGenericTowerAiCharacter(999).maxHp, floorFifteen.maxHp, 'out-of-range input clamps to the live catalog cap');
    });

    it('uses a visibly novice policy: one action at most and deterministic hesitation', () => {
        const floor = getFloor(3)!;
        const recruit: SquadMemberInput = {
            id: 'sq-tower-ai:1', name: 'Tower Recruit I (AI)', ownerSlug: '', ownerless: true, ai: true,
            character: buildGenericTowerAiCharacter(floor.id), itemCharges: {},
        };
        const session = buildTowerEncounter({
            floor, squad: [human(), recruit], runId: 'tower-generic-ai-policy', seed: 19, partySize: 2, now: 1,
        });
        const actor = session.actors.find(candidate => candidate.id === recruit.id)!;
        session.activeAp = 100;
        session.actionsThisTurn = 1;
        assert.equal(pickAiAction(session, actor, () => 0).type, 'wait', 'recruit never chains efficient multi-actions');

        session.actionsThisTurn = 0;
        let hesitations = 0;
        for (let round = 1; round <= 20; round++) {
            session.round = round;
            if (pickAiAction(session, actor, () => 0).type === 'wait') hesitations++;
        }
        assert.ok(hesitations >= 3, `expected deterministic novice hesitation, got ${hesitations}/20 turns`);
    });
});
