/**
 * Every place a gear step drop can be paid, driven through its real function.
 * The roll itself is random (or hashed from an event id), so each test finds an
 * input that hits and one that misses with the same hash the game uses, and checks
 * the item lands in the bag, once, without being refused by a full bag.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyWeeklyBossReward } from './weekly-boss.js';
import { DUNGEON_MIN_RUN_MS, mutateDungeonRun } from './dungeon/_run.js';
import { applyDungeonWardenSettlement } from './dungeon/_ai-fight.js';
import { applyDungeonCardTerminal, applyDungeonPetTerminal, dungeonCardMatchId } from './dungeon/_encounter-proof.js';
import { applyAiFightSecondaryRewards } from './missions/_ai-fight-secondary.js';
import { settleAncientChestLoot } from './world/_chest.js';
import { GEAR_DROP_CHANCE_BP, gearRoll } from './_gear-drops.js';
import { isStepItemId } from '../shared/gear-steps.js';

const hash = gearRoll;
const boss = GEAR_DROP_CHANCE_BP.boss / 10_000;
const stepIds = (inventory: unknown) => (inventory as string[]).filter(isStepItemId);

describe('weekly boss drop', () => {
    const base = { level: 1, unspentStats: 0, spentStats: {}, examsPassed: [], ryo: 0, inventory: [] as string[], maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 10, chakra: 10, stamina: 10 };
    const reward = (name: string) => ({ name, ryo: 500, gotCore: true, gotKey: true, gotRelic: false });
    const nameWhere = (hit: boolean) => {
        for (let i = 0; i < 5000; i += 1) if ((hash(`weekly:2026-W32:boss-ai:fighter${i}`) < boss) === hit) return `fighter${i}`;
        throw new Error('no name found');
    };

    it('adds one step item on a hit, once for the week', () => {
        const name = nameWhere(true);
        const paid = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', reward(name), 1_000);
        assert.equal(stepIds(paid.character.inventory).length, 1);
        assert.deepEqual((paid.character.inventory as string[]).slice(0, 2), ['weekly-boss-core', 'dungeon-key']);
        const replay = applyWeeklyBossReward(paid.character, '2026-W32', 'boss-ai', reward(name), 2_000);
        assert.equal(replay.alreadyApplied, true);
        assert.equal(stepIds(replay.character.inventory).length, 1);
    });

    it('adds nothing on a miss', () => {
        const paid = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', reward(nameWhere(false)), 1_000);
        assert.deepEqual(paid.character.inventory, ['weekly-boss-core', 'dungeon-key']);
    });

    it('pays exactly what the sealed summary promised, so the arena list is never wrong', () => {
        // The sealed flag wins over the roll in both directions.
        const forced = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', { ...reward(nameWhere(false)), gotGear: true }, 1_000);
        assert.equal(stepIds(forced.character.inventory).length, 1);
        const withheld = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', { ...reward(nameWhere(true)), gotGear: false }, 1_000);
        assert.equal(stepIds(withheld.character.inventory).length, 0);
        // An older summary has no flag, and the same roll decides.
        const older = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', reward(nameWhere(true)), 1_000);
        assert.equal(stepIds(older.character.inventory).length, 1);
    });
});

describe('dungeon run drop', () => {
    const tokenWhere = (hit: boolean) => {
        for (let i = 0; i < 5000; i += 1) if ((hash(`dungeon:rundrop${i}`) < boss) === hit) return `rundrop${i}`;
        throw new Error('no token found');
    };
    function settle(token: string) {
        const start = mutateDungeonRun({ name: 'Kiri', inventory: ['dungeon-key'], itemStacks: [] }, 'start', '', token, 1000, 0, undefined, undefined, 'craft-dungeon-snow');
        assert.equal(start.ok, true); if (!start.ok) throw new Error('start');
        const warden = applyDungeonWardenSettlement({ character: start.character, dungeonRunToken: token, opponentId: 'dungeon-warden-50', proofId: 'aifightproof123', outcome: 'win', now: 2000 });
        assert.equal(warden.ok, true); if (!warden.ok) throw new Error('warden');
        const card = applyDungeonCardTerminal({ character: warden.character, dungeonRunToken: token, matchId: dungeonCardMatchId('Kiri', token), outcome: 'player', now: 3000 });
        assert.equal(card.ok, true); if (!card.ok) throw new Error('card');
        const pet = applyDungeonPetTerminal({ character: card.character, dungeonRunToken: token, proofId: 'petfightproof123', outcome: 'win', petIds: ['pet-1'], now: 4000 });
        assert.equal(pet.ok, true); if (!pet.ok) throw new Error('pet');
        const done = mutateDungeonRun(pet.character, 'settle', token, 'x', 1000 + DUNGEON_MIN_RUN_MS);
        assert.equal(done.ok, true); if (!done.ok) throw new Error('settle');
        return done;
    }

    it('pays the relic and one step item on a hit, and the retry pays nothing more', () => {
        const token = tokenWhere(true);
        const done = settle(token);
        assert.equal((done.character.inventory as string[])[0], 'dungeon-legendary-relic');
        assert.equal(stepIds(done.character.inventory).length, 1);
        const replay = mutateDungeonRun(done.character, 'settle', token, 'x', 999999);
        assert.equal(replay.ok, true);
        if (replay.ok) {
            assert.equal(replay.alreadyApplied, true);
            assert.equal(stepIds(replay.character.inventory).length, 1);
        }
    });

    it('pays only the relic on a miss', () => {
        assert.deepEqual(settle(tokenWhere(false)).character.inventory, ['dungeon-legendary-relic']);
    });

    it('names the piece for the result card on a hit, and nothing on a miss or a retry', () => {
        const hit = settle(tokenWhere(true));
        const named = 'gearDropId' in hit ? hit.gearDropId : undefined;
        assert.ok(named && isStepItemId(named));
        assert.deepEqual(stepIds(hit.character.inventory), [named]);
        assert.equal('gearDropId' in settle(tokenWhere(false)), false);
    });
});

describe('result replies carry the drop, so it shows with the other winnings', () => {
    const source = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

    it('the dungeon reply, the AI fight reply and the clan boss reply all return gearDrop', () => {
        assert.match(source('api', 'dungeon', 'run.ts'), /gearDrop: \{ itemId: out\.gearDropId \}/);
        assert.match(source('api', 'missions', 'report-ai-fight.ts'), /gearDrop: \{ itemId: grantedGearDropId \}/);
        assert.match(source('api', 'clan-boss', 'assault-settle.ts'), /gearDrop: \{ itemId: callerGearDropId \}/);
    });

    it('the AI fight reply names a piece only when the secondary rewards actually grant it', () => {
        const fight = source('api', 'missions', 'report-ai-fight.ts');
        assert.match(fight, /grantedGearDropId = gearDropId && \(tokenData\.battleKind \?\? 'practice'\) !== 'practice' \? gearDropId : null/);
        // The same eligibility the grant uses: practice bouts never grant (see 'AI fight drop' above).
        assert.deepEqual(applyAiFightSecondaryRewards({ stamina: 0, maxStamina: 100, inventory: [] }, { battleKind: 'practice', opponentId: 'wolf' } as never, true, false, 'cloth-hood-s1').inventory, []);
    });
});

describe('AI fight drop', () => {
    const win =(inventory: string[], eligible = true, kind = 'world', drop: string | null = 'cloth-hood-s1') =>
        applyAiFightSecondaryRewards({ stamina: 0, maxStamina: 100, inventory }, { battleKind: kind, opponentId: 'wolf' } as never, eligible, false, drop);

    it('adds the dropped item to the bag', () => {
        assert.deepEqual(win(['kept']).inventory, ['kept', 'cloth-hood-s1']);
    });

    it('is never refused by a full bag', () => {
        const full = Array.from({ length: 500 }, (_, i) => `filler-${i}`);
        assert.equal((win(full).inventory as string[]).length, 501);
    });

    it('adds nothing for practice fights, an ineligible win, or no drop', () => {
        assert.deepEqual(win(['kept'], true, 'practice').inventory, ['kept']);
        assert.deepEqual(win(['kept'], false).inventory, ['kept']);
        assert.deepEqual(win(['kept'], true, 'world', null).inventory, ['kept']);
    });
});

describe('ancient chest drop', () => {
    const settleLoot = (inventory: string[], itemId: string) =>
        settleAncientChestLoot({ inventory, itemStacks: [], tileCards: [], level: 1, xp: 0 }, { xp: 0, itemId }).character.inventory as string[];

    it('pays a step item even when a copy is already owned', () => {
        assert.deepEqual(settleLoot(['cloth-hood-s1'], 'cloth-hood-s1'), ['cloth-hood-s1', 'cloth-hood-s1']);
    });

    it('still pays an ordinary unique item only once, as before', () => {
        assert.deepEqual(settleLoot(['cloth-hood'], 'cloth-hood'), ['cloth-hood']);
    });
});
