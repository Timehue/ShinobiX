/*
 * Poison balance guards (2026-09-10).
 *
 * Poison's percent is a POTENCY on its own scale: under combatResourcesV2 the
 * victim loses HP = chakra/stamina spent × potency × POISON_SPEND_FACTOR (12) on
 * every jutsu they cast. It was never rank-capped, so the starter table's flat 30%
 * creator value cost an active level-50 victim ~13% of max HP per 60-AP cast
 * (~20% per 60+40 turn, for two rounds), Serpent Dust's 55 ~24% per cast, and the
 * on-spend hit ignored armor and Decrease Damage Taken. These pin the fix: the
 * Poison rank ceiling (10 / 12 / 14, weapons 12), its mastery ramp, the ground-zone
 * rank stamp, the DoT mitigation, and the authored data behind it.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyJutsu, applyGroundEffectToFighter, poisonSpendDamage } from './move.js';
import {
    JUTSU_MAX_LEVEL,
    POISON_CAP_BY_RANK,
    WEAPON_POISON_TAG_CAP,
    poisonCapForJutsu,
    poisonPercentForTag,
} from '../combat-core/formulas.js';
import { v2JutsuResourceCost, v2PoisonOnSpend } from '../_combat-resources.js';
import { maxHpForLevel } from '../_xp-engine.js';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { ITEM_CATALOG } from './_item-catalog.js';
import { ENEMY_TEMPLATE_IDS, getEnemyTemplate } from '../towers/_enemy-templates.js';
import type { PvpFighter, PvpGroundEffect, PvpStatus } from './session.js';

function fighter(name: string, opts: { statuses?: PvpStatus[]; pos?: number; character?: Record<string, unknown> } = {}): PvpFighter {
    return {
        name, hp: 5000, maxHp: 5000, chakra: 5000, maxChakra: 5000,
        stamina: 5000, maxStamina: 5000, shield: 0, statuses: opts.statuses ?? [], pos: opts.pos ?? 0,
        character: { name, stats: {}, jutsuMastery: [], ...opts.character },
    };
}

// A caster whose jutsu `t` is fully mastered. Level 60 clears the Jonin rank cap,
// which would otherwise clamp effective mastery to 10.
function masteredCaster(): PvpFighter {
    return fighter('A', { character: { level: 60, jutsuMastery: [{ jutsuId: 't', level: JUTSU_MAX_LEVEL }] } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jutsu(tags: Array<{ name: string; percent?: number }>, overrides: Record<string, unknown> = {}): any {
    return {
        id: 't', name: 't', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE',
        tags, ...overrides,
    };
}

function appliedPoison(statuses: PvpStatus[]): number | undefined {
    return statuses.find(status => status.name === 'Poison')?.percent;
}

describe('poisonPercentForTag — Poison has its own rank ceiling', () => {
    it('holds each source to its rank ceiling', () => {
        assert.deepEqual(POISON_CAP_BY_RANK, { basic: 10, AB: 12, S: 14 });
        assert.equal(poisonPercentForTag(30, JUTSU_MAX_LEVEL, {}), 10, 'no-bloodline (starter / NPC)');
        assert.equal(poisonPercentForTag(30, JUTSU_MAX_LEVEL, { bloodlineRank: 'A Rank' }), 12);
        assert.equal(poisonPercentForTag(30, JUTSU_MAX_LEVEL, { bloodlineRank: 'B Rank' }), 12);
        assert.equal(poisonPercentForTag(35, JUTSU_MAX_LEVEL, { bloodlineRank: 'S Rank' }), 14);
        assert.equal(poisonPercentForTag(55, JUTSU_MAX_LEVEL, {}, WEAPON_POISON_TAG_CAP), 12, 'a weapon answers to the A/B ceiling');
    });

    it('keeps values authored under the ceiling', () => {
        assert.equal(poisonPercentForTag(5, JUTSU_MAX_LEVEL, {}), 5);
        assert.equal(poisonPercentForTag(8, JUTSU_MAX_LEVEL, { bloodlineRank: 'S Rank' }), 8);
    });

    it('ramps two-thirds to full with mastery, monotonically, and never collapses to 0', () => {
        assert.equal(poisonPercentForTag(10, 0, {}), 6);
        assert.equal(poisonPercentForTag(10, 25, {}), 8);
        assert.equal(poisonPercentForTag(10, JUTSU_MAX_LEVEL, {}), 10);
        assert.equal(poisonPercentForTag(12, 0, { bloodlineRank: 'A Rank' }), 8, 'the ramp applies to the capped value, so mastery still matters for bloodlines');
        let previous = 0;
        for (let mastery = 0; mastery <= JUTSU_MAX_LEVEL; mastery += 1) {
            const value = poisonPercentForTag(10, mastery, {});
            assert.ok(value >= previous, `mastery ${mastery} (${value}) must not drop below mastery ${mastery - 1} (${previous})`);
            previous = value;
        }
        assert.equal(poisonPercentForTag(1, 0, {}), 1, 'an applied Poison always bites for at least 1');
    });

    it('an unset percent falls back to the documented 6%, not the generic 30', () => {
        assert.equal(poisonPercentForTag(undefined, JUTSU_MAX_LEVEL, {}), 6);
        assert.equal(poisonPercentForTag(0, JUTSU_MAX_LEVEL, {}), 6);
    });
});

describe('applyJutsu applies the capped Poison potency', () => {
    it('a creator-scale 30% poison on a non-bloodline jutsu lands at 10%', () => {
        const r = applyJutsu(masteredCaster(), fighter('B'), jutsu([{ name: 'Poison', percent: 30 }]), 1, 'central', 1);
        assert.equal(appliedPoison(r.opponent.statuses), 10);
    });

    it('A-rank bloodline poison lands at 12%, S-rank at 14%', () => {
        const a = applyJutsu(masteredCaster(), fighter('B'), jutsu([{ name: 'Poison', percent: 30 }], { bloodlineRank: 'A Rank' }), 1, 'central', 1);
        const s = applyJutsu(masteredCaster(), fighter('B'), jutsu([{ name: 'Poison', percent: 35 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        assert.equal(appliedPoison(a.opponent.statuses), 12);
        assert.equal(appliedPoison(s.opponent.statuses), 14);
    });

    it('a weapon swing answers to the weapon ceiling (Serpent Dust at 55, forged blades at 15-40)', () => {
        const swing = jutsu([{ name: 'Poison', percent: 55 }], { id: 'weapon', weaponSwing: true, isUtility: false, ap: 20, effectPower: 0 });
        const r = applyJutsu(fighter('A'), fighter('B'), swing, 1, 'central', 1);
        assert.equal(appliedPoison(r.opponent.statuses), WEAPON_POISON_TAG_CAP);
    });

    it('an unset Poison percent applies the 6% default instead of the generic 30', () => {
        const r = applyJutsu(masteredCaster(), fighter('B'), jutsu([{ name: 'Poison' }]), 1, 'central', 1);
        assert.equal(appliedPoison(r.opponent.statuses), 6);
    });
});

describe('ground-zone Poison answers to the casting rank', () => {
    const zone = (percent: number, bloodlineRank?: string): PvpGroundEffect => ({
        id: 'z', owner: 'p1', name: 'Toxic Field', tiles: [5], rounds: 2,
        ...(bloodlineRank ? { bloodlineRank } : {}),
        tags: [{ name: 'Poison', percent }],
    });
    const inZone = () => fighter('B', { pos: 5 });

    it('a zone with no stamped rank (NPC, or laid before the stamp) takes the basic ceiling', () => {
        assert.equal(appliedPoison(applyGroundEffectToFighter(inZone(), zone(30), 1).fighter.statuses), 10);
    });

    it('a stamped zone takes its caster rank ceiling', () => {
        assert.equal(appliedPoison(applyGroundEffectToFighter(inZone(), zone(30, 'A Rank'), 1).fighter.statuses), 12);
        assert.equal(appliedPoison(applyGroundEffectToFighter(inZone(), zone(35, 'S Rank'), 1).fighter.statuses), 14);
    });

    it('a zone authored under the ceiling keeps its full value', () => {
        assert.equal(appliedPoison(applyGroundEffectToFighter(inZone(), zone(5), 1).fighter.statuses), 5);
    });
});

describe('poisonSpendDamage — the on-spend hit', () => {
    const poisoned = (percent: number, character: Record<string, unknown> = {}, extra: PvpStatus[] = []) => fighter('B', {
        statuses: [{ name: 'Poison', rounds: 2, percent, kind: 'negative' }, ...extra],
        character,
    });
    const spend = v2JutsuResourceCost(60, 50);

    it('matches the raw on-spend formula for a fighter with no armor or DDT', () => {
        assert.equal(poisonSpendDamage(poisoned(10), spend, 1), v2PoisonOnSpend(spend, 10));
    });

    it('is reduced by armor, and further by Decrease Damage Taken, like a Wound or Drain tick', () => {
        const raw = poisonSpendDamage(poisoned(10), spend, 1);
        const armored = poisonSpendDamage(poisoned(10, { armorRawDR: 0.4 }), spend, 1);
        const armoredDdt = poisonSpendDamage(
            poisoned(10, { armorRawDR: 0.4 }, [{ name: 'Decrease Damage Taken', rounds: 2, percent: 30, kind: 'positive' }]),
            spend,
            1,
        );
        assert.ok(armored < raw, `armor must reduce poison (${armored} vs ${raw})`);
        assert.ok(armoredDdt < armored, `DDT must reduce it further (${armoredDdt} vs ${armored})`);
        assert.ok(armoredDdt >= Math.floor(raw / 2), 'DR_DOT_SCALE keeps at least half, as for every DoT');
    });

    it('never computes above the S-rank ceiling (a Poison sealed onto a fighter before the caps)', () => {
        assert.equal(poisonSpendDamage(poisoned(55), spend, 1), v2PoisonOnSpend(spend, POISON_CAP_BY_RANK.S));
    });

    it('is 0 when not poisoned, when the cast is free, or when the Poison is not active yet', () => {
        assert.equal(poisonSpendDamage(fighter('B'), spend, 1), 0);
        assert.equal(poisonSpendDamage(poisoned(10), 0, 1), 0);
        const pending = fighter('B', { statuses: [{ name: 'Poison', rounds: 2, percent: 10, activeRound: 2, kind: 'negative' }] });
        assert.equal(poisonSpendDamage(pending, spend, 1), 0);
    });
});

describe('authored Poison sources sit on the Poison scale', () => {
    it('every built-in jutsu Poison is at or under its rank ceiling', () => {
        let seen = 0;
        for (const j of Object.values(JUTSU_CATALOG)) {
            for (const tag of j.tags ?? []) {
                if (tag.name !== 'Poison') continue;
                seen += 1;
                assert.ok((tag.percent ?? 0) <= poisonCapForJutsu(j), `${j.id} authors Poison ${tag.percent} over its ${poisonCapForJutsu(j)} ceiling`);
            }
        }
        assert.ok(seen >= 11, `expected the starter + bloodline poison jutsu, saw ${seen}`);
    });

    it('every built-in item Poison (Serpent Dust included) is at or under the weapon ceiling', () => {
        const dust = ITEM_CATALOG['thrown-serpent-dust'];
        assert.equal(dust?.weaponEffect, 'Poison');
        for (const item of Object.values(ITEM_CATALOG)) {
            if (item.weaponEffect === 'Poison') {
                assert.ok((item.weaponEffectValue ?? 0) <= WEAPON_POISON_TAG_CAP, `${item.id} authors Poison ${item.weaponEffectValue}`);
            }
            for (const tag of (item.weaponTags ?? []) as Array<{ name?: string; percent?: number }>) {
                if (tag.name === 'Poison') assert.ok((tag.percent ?? 0) <= WEAPON_POISON_TAG_CAP, `${item.id} weapon tag Poison ${tag.percent}`);
            }
        }
    });

    it('the Crafter shop line advertises Serpent Dust at its catalog potency', () => {
        // The recipe copy is hand-written in CentralHub and kept advertising 55% after
        // the item changed. process.cwd(), not import.meta: this file also compiles
        // into the CommonJS server build.
        const hub = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'CentralHub.tsx'), 'utf8');
        const advertised = hub.match(/Serpent Dust \((\d+)% poison/);
        assert.ok(advertised, 'Serpent Dust recipe line not found in CentralHub.tsx');
        assert.equal(Number(advertised[1]), ITEM_CATALOG['thrown-serpent-dust']?.weaponEffectValue);
    });

    it('every Battle Towers enemy Poison is at or under the no-rank ceiling', () => {
        for (const id of ENEMY_TEMPLATE_IDS) {
            for (const j of getEnemyTemplate(id).jutsu ?? []) {
                for (const tag of (j.tags ?? []) as Array<{ name?: string; percent?: number }>) {
                    if (tag.name === 'Poison') assert.ok((tag.percent ?? 0) <= POISON_CAP_BY_RANK.basic, `${id}/${j.id} authors Poison ${tag.percent}`);
                }
            }
        }
    });

    it('a mastered starter poison costs an active level-50 victim under 5% of max HP per 60-AP cast', () => {
        // The reported case: "over 10% of my health for 2 rounds". Before the fix
        // this jutsu's 30% cost 713 HP (13.2%) per 60-AP cast at level 50.
        const starter = JUTSU_CATALOG['starter-nin-fire-2']!;
        const potency = poisonPercentForTag(starter.tags[0]!.percent, JUTSU_MAX_LEVEL, starter);
        const perCast = v2PoisonOnSpend(v2JutsuResourceCost(60, 50), potency);
        assert.ok(perCast / maxHpForLevel(50) < 0.05, `${perCast} HP is ${(100 * perCast / maxHpForLevel(50)).toFixed(1)}% of max HP`);
    });
});
