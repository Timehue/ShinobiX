import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createTowerSession, getActor, type TowerActor, type TowerMap } from './_tower-session.js';
import { checkTowerWinner, companionObedienceRoll, runAiUntilHuman, startRound } from './_engine.js';
import type { TowerFloor } from './_floor-catalog.js';
import {
    COMPANION_ACTOR_ID, companionActor, companionGearDamageMult, companionHealOnSummonPct,
    companionMoveDamage, companionObeys, companionOwnerLifestealPct, companionStrikeDamage,
    pickCompanionMove, sealCompanionFromSave, type CompanionMove,
} from './_companion.js';

const mv = (name: string, kind: string, power: number, over: Partial<CompanionMove> = {}): CompanionMove =>
    ({ name, kind, power, cooldown: 2, rounds: 2, signature: false, ...over });

const MAP: TowerMap = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };

function mk(id: string, side: TowerActor['side'], pos: number, over: Partial<TowerActor> = {}): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: true,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos, character: { specialty: 'Taijutsu', stats: {} },
        ...over,
    };
}
function mkFloor(): TowerFloor {
    return {
        id: 1, name: 'Test', biome: 'forest', objective: 'defeat-all', roundBudget: 8,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {},
    };
}
function mkSession(actors: TowerActor[]) {
    return createTowerSession({
        towerId: 't', runId: 'r', floor: 1, seed: 1, partySize: 1, map: MAP,
        actors, objectiveKind: 'defeat-all', now: 1000,
    });
}
const SEAL = { petId: 'p1', name: 'Kit', hp: 300, damage: 120, happiness: 100, loyal: false, moves: [], pveGearId: '' };

describe('summoned companion (mission pet)', () => {
    it('mirrors the client petCombatDamage formula, floored at 20', () => {
        // 100*1.25 + 60*0.6 + 40*0.35 + (200+50)*0.025 + 10*2 = 201.25 → 201
        assert.equal(companionStrikeDamage({
            attack: 100, defense: 50, speed: 40, hp: 200, level: 10,
            jutsus: [{ kind: 'damage', power: 60 }, { kind: 'heal', power: 999 }],
        }), 201);
        // non-damage jutsu never count toward the "best damage jutsu" term
        assert.equal(companionStrikeDamage({ jutsus: [{ kind: 'heal', power: 999 }] }), 20);
        assert.equal(companionStrikeDamage({}), 20);
    });

    it('seals only the ACTIVE pet from the save', () => {
        const pets = [{ id: 'a', name: 'A', level: 50, hp: 10, attack: 1 }, { id: 'b', name: 'B', level: 50, hp: 50, attack: 8 }];
        assert.equal(sealCompanionFromSave({ pets })?.name, undefined, 'no activePetId → no companion');
        assert.equal(sealCompanionFromSave({ pets, activePetId: 'zz' }), null, 'unknown id → no companion');
        const sealed = sealCompanionFromSave({ pets, activePetId: 'b' });
        assert.equal(sealed?.petId, 'b');
        assert.equal(sealed?.hp, 50);
        assert.ok((sealed?.damage ?? 0) >= 20);
        assert.equal(
            sealCompanionFromSave({ pets: [{ ...pets[1], level: 49, unlockedForPve: true }], activePetId: 'b' }),
            null,
            'every sub-50 pet stays locked even if an old save says PvE is unlocked',
        );
        assert.equal(
            sealCompanionFromSave({ pets: [{ ...pets[1], unlockedForPve: false }], activePetId: 'b' })?.petId,
            'b',
            'level 50 is the authoritative summon boundary',
        );
    });

    // The load-bearing invariant: a temporary pet must NEVER hold a lost run open.
    it('a living companion does not stop a squad wipe', () => {
        const s = mkSession([
            mk('sq-1', 'squad', 0, { hp: 0, ai: false, ownerSlug: 'rill' }),
            companionActor(SEAL, 1),
            mk('en-1', 'enemy', 7),
        ]);
        checkTowerWinner(s, mkFloor());
        assert.equal(s.status, 'done');
        assert.equal(s.winner, 'enemy', 'squad is wiped even though the pet is still up');
    });

    it('still counts a LIVING real fighter as alive alongside the pet', () => {
        const s = mkSession([
            mk('sq-1', 'squad', 0, { hp: 500, ai: false, ownerSlug: 'rill' }),
            companionActor(SEAL, 1),
            mk('en-1', 'enemy', 7),
        ]);
        checkTowerWinner(s, mkFloor());
        assert.equal(s.status, 'active');
    });

    it('obeys on happiness or loyalty, else disobeys on a 35% roll (Arena parity)', () => {
        assert.equal(companionObeys(71, false, 0), true, 'happy pets always obey');
        assert.equal(companionObeys(0, true, 0), true, 'loyalty gear always obeys');
        assert.equal(companionObeys(0, false, 0.35), true, 'roll at the threshold obeys');
        assert.equal(companionObeys(0, false, 0.34), false, 'unhappy + unlucky → disobeys');
        assert.equal(companionObeys(70, false, 0.1), false, 'just below the happiness gate');
    });

    it('picks a heal when hurt, else the signature/strongest offensive move', () => {
        const moves = [mv('Mend', 'heal', 30), mv('Bite', 'damage', 50), mv('Smash', 'crush', 20, { signature: true })];
        assert.equal(pickCompanionMove(moves, {}, 0.3)?.name, 'Mend', 'below half HP → support');
        assert.equal(pickCompanionMove(moves, {}, 1)?.name, 'Smash', 'healthy → signature first');
        assert.equal(pickCompanionMove(moves, { Smash: 2 }, 1)?.name, 'Bite', 'signature on cooldown → strongest');
        assert.equal(pickCompanionMove(moves, { Mend: 3 }, 0.3)?.name, 'Smash', 'heal on cooldown → attack instead');
        // self-only kinds are never used as an attack, and an all-support kit falls
        // back to a plain strike (null)
        assert.equal(pickCompanionMove([mv('Mend', 'heal', 30)], {}, 1), null);
    });

    it('scales damage per kind and zeroes the pure-support kinds', () => {
        assert.equal(companionMoveDamage(200, null), 200, 'plain strike = the flat base');
        assert.equal(companionMoveDamage(200, mv('Mend', 'heal', 45)), 0);
        assert.equal(companionMoveDamage(200, mv('Guard', 'shield', 45)), 0);
        assert.equal(companionMoveDamage(200, mv('Bite', 'damage', 45)), 200, 'power 45 → ×1 powerScale');
        assert.equal(companionMoveDamage(200, mv('Rot', 'dot', 45)), 100, 'dot scales to 0.5');
        assert.equal(companionMoveDamage(200, mv('Jolt', 'stun', 45)), 120, 'stun scales to 0.6');
    });

    // Drives the REAL AI loop: queue sorts to [companion-0, sq-1, en-1], so the pet
    // acts and the loop then halts at the live human — the enemy never muddies it.
    function petVsFoe(moves: CompanionMove[], happiness = 100) {
        const pet = companionActor({ ...SEAL, happiness, moves }, 1);
        const s = mkSession([
            mk('sq-1', 'squad', 0, { hp: 1000, ai: false, ownerSlug: 'rill' }),
            pet,
            mk('en-1', 'enemy', 2, { hp: 5000, maxHp: 5000 }),
        ]);
        startRound(s);
        return s;
    }

    it('casts a status move on the foe and damages it', () => {
        const s = petVsFoe([mv('Rot', 'dot', 45)]);
        runAiUntilHuman(s, mkFloor(), () => 0.9); // obeys
        const foe = getActor(s, 'en-1')!;
        assert.ok(foe.hp < 5000, 'the pet hit the foe');
        assert.ok(foe.statuses.some(st => st.name === 'Poison'), 'and applied its dot');
    });

    it('a disobedient pet holds position and does nothing', () => {
        const s = petVsFoe([mv('Rot', 'dot', 45)], 0); // unhappy, not loyal
        s.seed = 2; // the authoritative (seed, round, actor) roll is below the 35% gate
        assert.ok(companionObedienceRoll(s, COMPANION_ACTOR_ID) < 0.35);
        runAiUntilHuman(s, mkFloor(), () => 0.99); // caller RNG cannot override the sealed turn roll
        const foe = getActor(s, 'en-1')!;
        assert.equal(foe.hp, 5000, 'no damage');
        assert.equal(foe.statuses.length, 0, 'no status');
        assert.ok(s.log.some(l => l.includes('ignores your command')));
    });

    it('heals itself first when hurt, then keeps acting on its remaining AP', () => {
        const s = petVsFoe([mv('Mend', 'heal', 40), mv('Bite', 'damage', 50)]);
        const pet = getActor(s, COMPANION_ACTOR_ID)!;
        pet.hp = 60; // below half of 300 → support branch leads
        runAiUntilHuman(s, mkFloor(), () => 0.9);
        assert.ok(getActor(s, COMPANION_ACTOR_ID)!.hp > 60, 'it healed');
        // A player-shaped 100 AP turn affords a follow-up after the 40 AP heal.
        assert.ok(getActor(s, 'en-1')!.hp < 5000, 'and still had AP to strike after healing');
    });

    // The correction that matters: the pet is a full actor on the shared AP system,
    // not a one-scripted-move pet — 100 AP at 40 per action = two strikes.
    it('takes a player-shaped multi-action turn on the 100 AP budget', () => {
        const s = petVsFoe([mv('Bite', 'damage', 45, { cooldown: 1 })]);
        const foeBefore = getActor(s, 'en-1')!.hp;
        runAiUntilHuman(s, mkFloor(), () => 0.9);
        const dealt = foeBefore - getActor(s, 'en-1')!.hp;
        const oneHit = 120; // SEAL.damage 120 × ×1 scale × powerScale(45/45)
        assert.ok(dealt >= oneHit * 2, `expected 2+ actions worth of damage, got ${dealt}`);
        // …and the log shows it acting more than once in the same turn. (activeAp is
        // the CURRENT actor's budget, already refreshed by endTurn, so it can't be
        // read after the fact.)
        const petActions = s.log.filter(l => l.startsWith('Kit ')).length;
        assert.ok(petActions >= 2, `expected 2+ pet actions in the log, got ${petActions}`);
    });

    it('uses the pet NICKNAME on the field, and seals its PVE gear', () => {
        const pets = [{
            id: 'b', name: 'Wolf Pup', nickname: '  Fang  ', level: 50, hp: 50, attack: 8,
            loadout: { pve: 'pve-pack-alpha-crest', pveDurability: 10 },
        }];
        const sealed = sealCompanionFromSave({ pets, activePetId: 'b' });
        assert.equal(sealed?.name, 'Fang', 'a renamed pet shows its nickname, not the species name');
        assert.equal(sealed?.pveGearId, 'pve-pack-alpha-crest');
        assert.equal(sealed?.loyal, true, 'Pack Alpha Crest grants loyalty');
    });

    it('reads the equipped PVE-gear perks from the sealed gear id', () => {
        assert.equal(companionGearDamageMult('pve-frenzy-claw', 100, 100), 1.3, '+30% summon damage');
        assert.equal(companionGearDamageMult('', 100, 100), 1, 'no gear → neutral');
        // Apex Predator Fang: +25%, and +25% MORE against a foe under 40% HP.
        assert.equal(companionGearDamageMult('pve-apex-predator-fang', 100, 100), 1.25);
        assert.ok(companionGearDamageMult('pve-apex-predator-fang', 30, 100) > 1.5, 'execute bonus vs a hurt foe');
        assert.equal(companionHealOnSummonPct('pve-guardians-blessing'), 15);
        assert.equal(companionOwnerLifestealPct('pve-sanguine-charm'), 20);
        assert.equal(companionOwnerLifestealPct(''), 0);
    });

    it('gear lifesteal heals the OWNER off the pet\'s damage', () => {
        const pet = companionActor({ ...SEAL, moves: [mv('Bite', 'damage', 45)], pveGearId: 'pve-sanguine-charm' }, 1);
        const s = mkSession([
            mk('sq-1', 'squad', 0, { hp: 400, maxHp: 1000, ai: false, ownerSlug: 'rill' }),
            pet,
            mk('en-1', 'enemy', 2, { hp: 5000, maxHp: 5000 }),
        ]);
        startRound(s);
        runAiUntilHuman(s, mkFloor(), () => 0.9);
        assert.ok(getActor(s, 'sq-1')!.hp > 400, 'the owner was healed by the pet\'s strike');
        assert.ok(s.log.some(l => l.includes('draws')), 'and it is reported in the log');
    });

    it('expires off the field after its sealed round budget', () => {
        const s = mkSession([
            mk('sq-1', 'squad', 0, { hp: 500, ai: false, ownerSlug: 'rill' }),
            companionActor(SEAL, 1, 2),
            mk('en-1', 'enemy', 7),
        ]);
        startRound(s);
        assert.ok(getActor(s, COMPANION_ACTOR_ID), 'still out after one round');
        startRound(s);
        assert.equal(getActor(s, COMPANION_ACTOR_ID), undefined, 'returned to its scroll');
        assert.ok(!s.turnQueue.includes(COMPANION_ACTOR_ID), 'and is no longer queued');
    });
});
