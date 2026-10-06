/*
 * Tower (and ranked 2v2) tag rules:
 *   • Owner rulings 2026-10-05: a fighter who Cleanses on their turn takes no Wound or
 *     Drain, and a Drain lands its full amount through any armor. Wound/Drain tick at
 *     round end, after every fighter has acted, and Cleanse strips a debuff cast this
 *     round before it starts. Push and Pull move the target 4 tiles.
 *   • A ground zone affects its victims for two of their turns, whichever team casts it.
 *   • A dash (Move on a single-target jutsu) still resolves its utility riders.
 * The squad always opens a Tower round, so "amber" in ranked 2v2 is the squad and
 * "violet" the enemy side.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TowerFloor } from './_floor-catalog.js';
import { applyAction, endTurn, startRound, type TowerAction } from './_engine.js';
import { makeRng } from './_sim.js';
import {
    activeActor,
    createTowerSession,
    getActor,
    type TowerActor,
    type TowerSession,
} from './_tower-session.js';

const FLOOR: TowerFloor = {
    id: 89,
    name: 'Tag timing',
    biome: 'central',
    objective: 'defeat-all',
    roundBudget: 20,
    map: { width: 8, height: 8 },
    fieldRule: { kind: 'none' },
    enemies: [],
    firstClearReward: {},
};

const DRAIN = {
    id: 'drain', name: 'Drain Strike', type: 'Ninjutsu', element: 'None', target: 'OPPONENT',
    method: 'SINGLE', ap: 40, range: 5, effectPower: 0, isUtility: true, chakraCost: 0, staminaCost: 0,
    cooldown: 0, tags: [{ name: 'Drain' }],
};
const MIRE = {
    id: 'mire', name: 'Recoil Mire', type: 'Genjutsu', element: 'None', target: 'EMPTY_GROUND',
    method: 'INSTANT_EFFECT', ap: 40, range: 4, effectPower: 0, chakraCost: 0, staminaCost: 0,
    cooldown: 0, tags: [{ name: 'Recoil', percent: 30 }],
};
const STUN_DASH = {
    id: 'stun-dash', name: 'Stunning Step', type: 'Taijutsu', element: 'None', target: 'EMPTY_GROUND',
    method: 'SINGLE', ap: 40, range: 5, effectPower: 0, chakraCost: 0, staminaCost: 0,
    cooldown: 0, tags: [{ name: 'Move' }, { name: 'Stun' }],
};
const SHOVE = {
    id: 'shove', name: 'Shove', type: 'Taijutsu', element: 'None', target: 'OPPONENT',
    method: 'SINGLE', ap: 40, range: 1, effectPower: 0, isUtility: false, chakraCost: 0, staminaCost: 0,
    cooldown: 0, tags: [{ name: 'Push', percent: 0 }],
};
const KIT = [DRAIN, MIRE, STUN_DASH, SHOVE];

function fighter(id: string, side: TowerActor['side'], pos: number): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: false,
        hp: 50_000, maxHp: 50_000, chakra: 5_000, maxChakra: 5_000, stamina: 5_000, maxStamina: 5_000,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: {
            // Ranked Seal armor: it must not shrink a Drain tick.
            specialty: 'Ninjutsu', level: 100, armorRawDR: 0.35, stats: { ninjutsuOffense: 2_500, ninjutsuDefense: 2_500 },
            jutsu: KIT,
            jutsuMastery: KIT.map(j => ({ jutsuId: j.id, level: 50 })),
        },
    };
}

function begin(): TowerSession {
    const session = createTowerSession({
        towerId: 'tag-timing', runId: 'tag-timing-run', floor: 89, seed: 89, partySize: 1,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [], biome: 'central' },
        actors: [fighter('amber', 'squad', 26), fighter('violet', 'enemy', 27)],
        objectiveKind: 'defeat-all',
        now: 1_000,
    });
    startRound(session);
    return session;
}

function act(session: TowerSession, action: Omit<TowerAction, 'actorId'> & Record<string, unknown>): void {
    const actor = activeActor(session)!;
    const result = applyAction(session, FLOOR, { ...action, actorId: actor.id } as TowerAction, makeRng(3));
    assert.equal(result.applied, true, `${actor.id} ${action.type}: ${result.reason ?? ''}`);
}

/** End the active fighter's turn; returns the log lines that turn hand-off produced. */
function pass(session: TowerSession): string[] {
    const start = session.log.length;
    endTurn(session, FLOOR);
    return session.log.slice(start);
}

describe('Tower DoT timing and Cleanse', () => {
    it('a Drain ticks its full 300 twice, at round end, through ranked armor', () => {
        const s = begin();
        act(s, { type: 'jutsu', jutsuId: 'drain', targetId: 'violet' });
        const ticks: number[] = [];
        for (let turn = 0; turn < 6; turn++) {
            const handOff = pass(s);
            const tick = handOff.find(line => line.includes('violet drained'));
            if (tick) {
                // Round end: violet has already played the round, and amber opens the next.
                assert.equal(activeActor(s)!.id, 'amber', 'the tick lands after the victim has acted');
                ticks.push(Number(tick.match(/drained (\d+)/)![1]));
            }
        }
        assert.deepEqual(ticks, [300, 300]);
    });

    it('a Cleanse on the victim\'s next turn removes a Drain cast this round, so it never ticks', () => {
        const s = begin();
        act(s, { type: 'jutsu', jutsuId: 'drain', targetId: 'violet' });
        pass(s); // amber → violet, round 1
        act(s, { type: 'cleanse' });
        assert.ok(s.log.at(-1)?.includes('removed Drain'), String(s.log.at(-1)));
        for (let turn = 0; turn < 6; turn++) {
            assert.equal(pass(s).some(line => line.includes('drained')), false);
        }
        assert.equal(getActor(s, 'violet')!.hp, 50_000);
    });

    it('a squad member who Cleanses as their first action takes no Drain', () => {
        const s = begin();
        pass(s); // amber passes, violet acts second in round 1
        act(s, { type: 'jutsu', jutsuId: 'drain', targetId: 'amber' });
        pass(s); // round 2 starts with amber
        assert.equal(activeActor(s)!.id, 'amber');
        act(s, { type: 'cleanse' });
        assert.ok(s.log.at(-1)?.includes('removed Drain'), String(s.log.at(-1)));
        for (let turn = 0; turn < 6; turn++) pass(s);
        assert.equal(getActor(s, 'amber')!.hp, 50_000);
    });
});

describe('Tower Push and Pull', () => {
    it('a range-1 Push moves the target 4 tiles when there is room', () => {
        const s = begin();
        const before = getActor(s, 'violet')!.pos;
        act(s, { type: 'jutsu', jutsuId: 'shove', targetId: 'violet' });
        assert.ok(s.log.includes('Push: violet is pushed 4 tiles.'), s.log.slice(-6).join(' | '));
        assert.notEqual(getActor(s, 'violet')!.pos, before);
    });
});

describe('Tower ground zones', () => {
    it('a squad zone affects the enemy for two of its turns', () => {
        const s = begin();
        act(s, { type: 'jutsu', jutsuId: 'mire', tile: 25 });
        const turnsCursed: number[] = [];
        for (let turn = 0; turn < 8; turn++) {
            pass(s);
            const actor = activeActor(s)!;
            if (actor.id === 'violet' && actor.statuses.some(status => status.name === 'Recoil')) turnsCursed.push(s.round);
        }
        assert.deepEqual(turnsCursed, [1, 2]);
    });

    it('an enemy zone affects the squad for two of its turns (it used to reach none)', () => {
        const s = begin();
        pass(s);
        act(s, { type: 'jutsu', jutsuId: 'mire', tile: 28 });
        const turnsCursed: number[] = [];
        for (let turn = 0; turn < 8; turn++) {
            pass(s);
            const actor = activeActor(s)!;
            if (actor.id === 'amber' && actor.statuses.some(status => status.name === 'Recoil')) turnsCursed.push(s.round);
        }
        assert.deepEqual(turnsCursed, [2, 3]);
    });
});

describe('Tower dash riders', () => {
    it('a single-target dash still applies its Stun to the nearest foe in range', () => {
        const s = begin();
        act(s, { type: 'jutsu', jutsuId: 'stun-dash', tile: 18 });
        const stun = getActor(s, 'violet')!.statuses.find(status => status.name === 'Stun');
        assert.ok(stun, 'the dash still stuns');
        assert.equal(stun.activeRound, s.round + 1, 'the Stun starts next round, like every jutsu status');
    });
});
