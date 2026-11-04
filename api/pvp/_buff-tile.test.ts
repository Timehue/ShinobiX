/*
 * 40-AP buff tiles (self ground effects): a single hex carrying Absorb,
 * Lifesteal, Reflect, Decrease Damage Taken or Increase Heal. Whoever stands on
 * it holds the buff; leaving the hex or the tile expiring removes it.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyGroundEffectToFighter,
    applyJutsu,
    applyOccupantGroundEffect,
    buffTileBlockedLines,
    reconcileGroundStatuses,
    settleOccupantGroundStatuses,
    tickGroundEffects,
} from './move.js';
import type { PvpFighter, PvpGroundEffect, PvpStatus } from './session.js';
import {
    createCanonicalGroundEffect,
    resolveJutsuActionPlan,
    type JutsuActionPlan,
} from '../combat-core/resolve-jutsu-action.js';

function fighter(name: string, pos: number, statuses: PvpStatus[] = []): PvpFighter {
    return {
        name, hp: 1000, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses, pos,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}

function buffTile(tags: Array<{ name: string; percent?: number }>, extra: Partial<PvpGroundEffect> = {}): PvpGroundEffect {
    return { id: 'tile', owner: 'p1', name: 'Golden Ground', kind: 'occupant', tiles: [5], rounds: 2, tags, ...extra };
}

const BOARD = { width: 12, height: 10, unavailableTiles: new Set<number>([40]) };

function plan(tags: Array<{ name: string; percent?: number }>, opts: { ap?: number; tile?: number; casterPos?: number } = {}) {
    return resolveJutsuActionPlan({
        jutsu: {
            id: 'bt', name: 'Golden Ground', type: 'Any', ap: opts.ap ?? 40, range: 4,
            target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', tags,
        },
        casterPos: opts.casterPos ?? 26, opponentPos: 40, tile: opts.tile ?? 28,
        casterChakra: 100, casterStamina: 100, casterStatuses: [],
        round: 1, availableAp: 100, actionsThisTurn: 0, cooldownRemaining: 0,
        board: BOARD,
    });
}

describe('buff tile action plan', () => {
    it('a 40 AP buff tile covers exactly the selected hex and never hits the opponent', () => {
        const result = plan([{ name: 'Absorb', percent: 30 }]);
        assert.ok(result.accepted);
        assert.equal(result.groundKind, 'occupant');
        assert.equal(result.createsGroundEffect, true);
        assert.deepEqual(result.footprint, [28]);
        assert.equal(result.hitsOpponent, false);
        assert.deepEqual(result.groundTags, [{ name: 'Absorb', percent: 30 }]);
    });

    it('may be laid under the caster without Move, but a dash cannot land where it stands', () => {
        const underFoot = plan([{ name: 'Reflect', percent: 30 }], { tile: 26 });
        assert.ok(underFoot.accepted);
        assert.deepEqual(underFoot.footprint, [26]);
        const dashInPlace = plan([{ name: 'Move', percent: 0 }, { name: 'Reflect', percent: 30 }], { tile: 26 });
        assert.equal(dashInPlace.accepted, false);
    });

    it('the Move variant lays the tile on the landing hex', () => {
        const result = plan([{ name: 'Move', percent: 0 }, { name: 'Decrease Damage Taken', percent: 30 }], { tile: 29 });
        assert.ok(result.accepted);
        assert.equal(result.move, true);
        assert.equal(result.groundKind, 'occupant');
        assert.deepEqual(result.footprint, [29]);
    });

    it('refuses a buff tile on any jutsu that is not 40 AP', () => {
        const result = plan([{ name: 'Absorb', percent: 30 }], { ap: 60 });
        assert.deepEqual(result, { accepted: false, rejection: 'self-ground-effect-40-ap-only' });
    });

    it('a hostile field tag keeps the jutsu an enemy field', () => {
        const result = plan([{ name: 'Poison', percent: 30 }, { name: 'Absorb', percent: 30 }]);
        assert.ok(result.accepted);
        assert.equal(result.groundKind, 'hostile');
        assert.deepEqual(result.groundTags.map((tag) => tag.name), ['Poison']);
        assert.ok(result.footprint.length > 1, 'an enemy field still fills the caster range');
    });

    it('stamps kind only on buff tiles, so stored enemy fields keep their shape', () => {
        const tile = createCanonicalGroundEffect({ id: 'a', owner: 'p1', name: 'A', plan: plan([{ name: 'Absorb', percent: 30 }]) as JutsuActionPlan });
        const field = createCanonicalGroundEffect({ id: 'b', owner: 'p1', name: 'B', plan: plan([{ name: 'Poison', percent: 30 }]) as JutsuActionPlan });
        assert.equal(tile.kind, 'occupant');
        assert.equal('kind' in field, false);
    });
});

describe('buff tile occupancy', () => {
    it('grants its buff at once to whoever stands on it, with the jutsu percent in the log', () => {
        const result = applyOccupantGroundEffect(fighter('Rin', 5), buffTile([{ name: 'Decrease Damage Taken', percent: 30 }]), 1);
        const status = result.fighter.statuses.find((entry) => entry.name === 'Decrease Damage Taken');
        assert.ok(status);
        assert.equal(status.percent, 30);
        assert.equal(status.kind, 'positive');
        assert.equal(status.source, 'ground:tile');
        assert.equal(status.activeRound, undefined, 'active immediately');
        assert.deepEqual(result.lines, ['Golden Ground: Rin takes 30% less damage while standing on this tile.']);
    });

    it('refreshes instead of stacking and logs only the first grant', () => {
        const first = applyOccupantGroundEffect(fighter('Rin', 5), buffTile([{ name: 'Absorb', percent: 30 }]), 1);
        const again = applyOccupantGroundEffect(first.fighter, buffTile([{ name: 'Absorb', percent: 30 }]), 1);
        assert.equal(again.fighter.statuses.filter((entry) => entry.name === 'Absorb').length, 1);
        assert.deepEqual(again.lines, []);
    });

    it('affects the opponent of the caster too: anyone standing on it gains it', () => {
        const tile = buffTile([{ name: 'Reflect', percent: 30 }], { owner: 'p1' });
        const enemy = settleOccupantGroundStatuses(fighter('Enemy', 5), [tile], 1).fighter;
        assert.ok(enemy.statuses.some((entry) => entry.name === 'Reflect'));
        // reconcile keeps it for the owner's opponent and for the owner alike.
        assert.equal(reconcileGroundStatuses(enemy, [tile], 'p2').statuses.length, 1);
        assert.equal(reconcileGroundStatuses({ ...enemy }, [tile], 'p1').statuses.length, 1);
    });

    it('does nothing off the tile, and leaving or expiry removes the buff', () => {
        const tile = buffTile([{ name: 'Lifesteal', percent: 30 }]);
        assert.equal(applyOccupantGroundEffect(fighter('Rin', 6), tile, 1).fighter.statuses.length, 0);
        const standing = applyOccupantGroundEffect(fighter('Rin', 5), tile, 1).fighter;
        assert.equal(reconcileGroundStatuses({ ...standing, pos: 6 }, [tile], 'p1').statuses.length, 0);
        assert.equal(reconcileGroundStatuses(standing, [], 'p1').statuses.length, 0);
    });

    it('Buff Prevent blocks the tile, logged once at cast and never on every settle', () => {
        const prevented = fighter('Rin', 5, [{ name: 'Buff Prevent', rounds: 2, kind: 'negative' }]);
        const tile = buffTile([{ name: 'Absorb', percent: 30 }]);
        const result = applyOccupantGroundEffect(prevented, tile, 1);
        assert.equal(result.fighter.statuses.some((entry) => entry.name === 'Absorb'), false);
        assert.deepEqual(result.lines, [], 'a settle stays silent');
        assert.deepEqual(settleOccupantGroundStatuses(result.fighter, [tile], 1).lines, []);
        assert.deepEqual(buffTileBlockedLines([prevented, fighter('Other', 6)], tile, 1), ["Rin's Buff Prevent blocks Golden Ground."]);
    });

    it('holds amp tags to the caster rank ceiling', () => {
        const tile = buffTile([{ name: 'Absorb', percent: 50 }], { bloodlineRank: 'A Rank' });
        const status = applyOccupantGroundEffect(fighter('Rin', 5), tile, 1).fighter.statuses[0];
        assert.equal(status?.percent, 35);
    });

    it('applyGroundEffectToFighter routes a buff tile to occupancy, ignoring the pending round', () => {
        const tile = buffTile([{ name: 'Increase Heal', percent: 30 }], { activeRound: 3 });
        const result = applyGroundEffectToFighter(fighter('Rin', 5), tile, 1);
        assert.ok(result.fighter.statuses.some((entry) => entry.name === 'Increase Heal' && entry.kind === 'positive'));
    });

    it('lasts the cast round plus two rounds, like an enemy field cast by the same player', () => {
        let effects: PvpGroundEffect[] = [buffTile([{ name: 'Absorb', percent: 30 }], { activeRound: 2 })];
        effects = tickGroundEffects(effects, 1);
        assert.equal(effects[0]?.rounds, 2, 'the cast round does not age it');
        effects = tickGroundEffects(effects, 2);
        assert.equal(effects[0]?.rounds, 1);
        effects = tickGroundEffects(effects, 3);
        assert.equal(effects.length, 0);
    });

    it('a buff tile really reduces damage taken while the defender stands on it', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hit: any = { id: 'h', name: 'Hit', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 4, effectPower: 40, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [] };
        const guarded = applyOccupantGroundEffect(fighter('Rin', 5), buffTile([{ name: 'Decrease Damage Taken', percent: 30 }]), 1).fighter;
        const plain = applyJutsu(fighter('A', 6), fighter('Rin', 5), hit, 1, 'central', 1);
        const onTile = applyJutsu(fighter('A', 6), guarded, hit, 1, 'central', 1);
        assert.ok(1000 - onTile.opponent.hp < 1000 - plain.opponent.hp, 'the tile lowers the hit');
    });

    it('Copy never steals a buff that belongs to a tile', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const copy: any = { id: 'c', name: 'Copy', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 4, effectPower: 40, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [{ name: 'Copy', percent: 0 }] };
        const onTile = applyOccupantGroundEffect(fighter('Rin', 5), buffTile([{ name: 'Reflect', percent: 30 }]), 1).fighter;
        const result = applyJutsu(fighter('A', 6), onTile, copy, 1, 'central', 1);
        assert.equal(result.self.statuses.some((entry) => entry.name === 'Reflect'), false);
    });
});
