/*
 * Solo PvE status timing, held to the PvP contract (api/pvp/move.ts endTurn):
 *   • statuses age once per round for both sides, so a buff the player casts "for 2
 *     rounds" covers both of the enemy's next two turns;
 *   • an enemy ground zone reaches the player for two of the player's turns;
 *   • a pet's Stun costs the enemy AP on its next turn, and a pet's Wound ticks twice.
 * Owner rulings 2026-10-05: Wound/Drain tick in full at the END of the holder's turn,
 * and a player who Cleanses on their turn (even a debuff not started yet) takes none.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { applySoloPveAction } from './_engine.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';

const NOW = 1_800_000_000_000;

const ENEMY_HIT = {
    id: 'enemy-hit', name: 'Enemy Hit', type: 'Taijutsu', element: 'None', target: 'OPPONENT', range: 4,
    ap: 60, cooldown: 0, chakraCost: 0, staminaCost: 0, effectPower: 30, isUtility: false, method: 'SINGLE', tags: [],
};

function fighter(name: string, pos: number, jutsu: unknown[] = []): PvpFighter {
    return {
        name, hp: 20_000, maxHp: 20_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        shield: 0, statuses: [], pos,
        character: {
            level: 100, specialty: 'Taijutsu',
            stats: { taijutsuOffense: 1_200, taijutsuDefense: 600, ninjutsuOffense: 1_200 },
            jutsu,
            jutsuMastery: (jutsu as Array<{ id: string }>).map(j => ({ jutsuId: j.id, level: 50 })),
            pvpItems: [], equipment: {},
        },
    };
}

function session(id: string, player: PvpFighter, enemy: PvpFighter, extra: Record<string, unknown> = {}): SoloPveSession {
    return createSoloPveSession({
        sessionId: id, ownerSlug: 'alice', encounter: { kind: 'test', id }, player, enemy, now: NOW, ...extra,
    });
}

/** Ends the player's turn and lets the enemy play; Clear is kept on cooldown so the
 *  enemy cannot simply strip the buff under test. */
function enemyRound(s: SoloPveSession): SoloPveSession {
    s.cooldowns.enemy = { ...(s.cooldowns.enemy ?? {}), clear: 99 };
    const result = applySoloPveAction(s, { type: 'wait' });
    assert.equal(result.applied, true);
    return result.session;
}

function damageToPlayer(before: SoloPveSession, after: SoloPveSession): number[] {
    return after.log.slice(before.log.length)
        .map(line => line.match(/^(\d+) damage to Alice\./))
        .filter((match): match is RegExpMatchArray => !!match)
        .map(match => Number(match[1]));
}

describe('solo PvE status aging', () => {
    it('a player Decrease Damage Taken covers both of the enemy\'s next two turns', () => {
        const ddt = {
            id: 'ddt', name: 'Guard', type: 'Ninjutsu', element: 'None', target: 'SELF', range: 0, ap: 40,
            cooldown: 0, chakraCost: 0, staminaCost: 0, effectPower: 0, isUtility: true, method: 'SINGLE',
            tags: [{ name: 'Decrease Damage Taken', percent: 30 }],
        };
        let s = session('ddt-duration', fighter('Alice', 62, [ddt]), fighter('Rival', 63, [ENEMY_HIT]));
        const cast = applySoloPveAction(s, { type: 'jutsu', jutsuId: 'ddt' });
        assert.equal(cast.applied, true);
        s = cast.session;

        const perRound: number[][] = [];
        for (let round = 0; round < 4; round++) {
            const before = s;
            s = enemyRound(s);
            perRound.push(damageToPlayer(before, s));
        }
        const [unbuffed, first, second, after] = perRound.map(hits => hits[0]!);
        assert.ok(first! < unbuffed!, `round 2 is reduced (${first} vs ${unbuffed})`);
        assert.ok(second! < unbuffed!, `round 3 is reduced too (${second} vs ${unbuffed}); it used to expire first`);
        assert.equal(after, unbuffed, 'round 4 is back to normal');
    });
});

describe('solo PvE Drain and Cleanse', () => {
    const DRAIN_ON_PLAYER = { name: 'Drain', rounds: 2, activeRound: 1, amount: 300, kind: 'negative' as const };

    function drained(id: string, drain: typeof DRAIN_ON_PLAYER): SoloPveSession {
        const player = fighter('Alice', 62);
        const s = session(id, {
            ...player,
            character: { ...(player.character as Record<string, unknown>), armorRawDR: 0.35 },
        }, fighter('Rival', 63, [ENEMY_HIT]));
        s.player = { ...s.player, statuses: [drain] };
        return s;
    }

    it('ticks its full 300 at the end of the player turn, through ranked armor', () => {
        const s = drained('drain-end-of-turn', DRAIN_ON_PLAYER);
        assert.equal(s.log.some(line => line.includes('Alice drained')), false, 'nothing ticks before the player acts');
        const after = enemyRound(s);
        const lines = after.log.slice(s.log.length);
        const tick = lines.findIndex(line => line === 'Alice drained 300 HP+chakra.');
        assert.ok(tick >= 0, lines.join(' | '));
        assert.ok(tick < lines.findIndex(line => /damage to Alice/.test(line)), 'the tick ends the player turn, before the enemy acts');
    });

    it('a player who Cleanses first takes no Drain', () => {
        let s = drained('drain-cleanse-first', DRAIN_ON_PLAYER);
        const cleanse = applySoloPveAction(s, { type: 'cleanse' });
        assert.equal(cleanse.applied, true, cleanse.reason ?? 'rejected');
        s = enemyRound(cleanse.session);
        s = enemyRound(s);
        assert.equal(s.log.some(line => line.includes('Alice drained')), false);
    });

    it('Cleanse strips a Drain that has not started yet', () => {
        const s = drained('drain-cleanse-pending', { ...DRAIN_ON_PLAYER, activeRound: 2 });
        const cleanse = applySoloPveAction(s, { type: 'cleanse' });
        assert.equal(cleanse.applied, true, cleanse.reason ?? 'rejected');
        assert.equal(cleanse.session.player.statuses.some(status => status.name === 'Drain'), false);
    });
});

describe('solo PvE ground zones', () => {
    it('an enemy zone reaches the player for two of the player\'s turns', () => {
        let s = session('enemy-zone', fighter('Alice', 62), fighter('Rival', 63, [ENEMY_HIT]));
        // A zone the enemy laid in round 1, exactly as addGroundEffect stamps it.
        s.groundEffects = [{
            id: 'enemy-mire', owner: 'p2', name: 'Recoil Mire', tiles: [61, 62, 63, 64], rounds: 2,
            activeRound: 2, tags: [{ name: 'Recoil', percent: 30 }],
        }];
        const cursedPlayerTurns: number[] = [];
        for (let round = 0; round < 4; round++) {
            s = enemyRound(s);
            if (s.player.statuses.some(status => status.name === 'Recoil')) cursedPlayerTurns.push(s.round);
        }
        assert.deepEqual(cursedPlayerTurns, [2, 3]);
    });

    it('a player zone catching the enemy counts its cast pulse as the first of two turns', () => {
        const mire = {
            id: 'mire', name: 'Recoil Mire', type: 'Genjutsu', element: 'None', target: 'EMPTY_GROUND',
            method: 'INSTANT_EFFECT', range: 4, ap: 40, cooldown: 0, chakraCost: 0, staminaCost: 0,
            effectPower: 0, tags: [{ name: 'Recoil', percent: 30 }],
        };
        let s = session('player-zone', fighter('Alice', 62, [mire]), fighter('Rival', 63, [ENEMY_HIT]));
        const cast = applySoloPveAction(s, { type: 'jutsu', jutsuId: 'mire', tile: 61 });
        assert.equal(cast.applied, true, cast.reason ?? 'rejected');
        s = cast.session;
        assert.ok(s.enemy.statuses.some(status => status.name === 'Recoil'), 'the cast pulse lands on the enemy');
        assert.equal(s.groundEffects[0]?.castPulseConsumed, true);
        assert.equal(s.groundEffects[0]?.activeRound, 2);
    });
});

describe('solo PvE companion statuses', () => {
    function withPet(id: string, kind: 'stun' | 'wound'): SoloPveSession {
        const s = session(id, fighter('Alice', 62), fighter('Rival', 63, [ENEMY_HIT]), {
            companion: {
                petId: 'pet-1', name: 'Fang', hp: 3_000, damage: 120, happiness: 100, loyal: true,
                moves: [{ name: 'Snare', kind, power: 45, cooldown: 1, rounds: 2, signature: true }],
                pveGearId: '',
            },
        });
        const summoned = applySoloPveAction(s, { type: 'summon' });
        assert.equal(summoned.applied, true);
        return summoned.session;
    }

    it('a pet Stun costs the enemy 40 AP on its next turn (it used to expire unused)', () => {
        let s = withPet('pet-stun', 'stun');
        s = enemyRound(s);
        const stun = s.enemy.statuses.find(status => status.name === 'Stun');
        assert.ok(stun, 'the Stun is still pending after the turn it was applied');
        assert.equal(stun.activeRound, s.round);
        const before = s;
        s = enemyRound(s);
        const enemyEvent = s.events.slice(before.events.length).find(event => event.actor === 'enemy');
        assert.equal(enemyEvent?.before.ap.enemy, 60, 'the enemy starts its turn stunned');
    });

    it('a pet Wound ticks twice', () => {
        let s = withPet('pet-wound', 'wound');
        let bleeds = 0;
        for (let round = 0; round < 4; round++) {
            const before = s;
            s = enemyRound(s);
            bleeds += s.log.slice(before.log.length).filter(line => line.startsWith('Rival bleeds')).length;
            s.companion = undefined; // one application only
        }
        assert.equal(bleeds, 2);
    });
});
