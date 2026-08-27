import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bloodlinePoints, pointBudgetForRank } from '../api/_jutsu-points.js';
import { LOADOUT_CAP_BASE, LOADOUT_CAP_SUB } from '../api/_entitlements.js';
import { earnedForLevel, maxHpForLevel, STAT_KEYS } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import { CANONICAL_TAG_NAMES, canonicalTagName } from '../api/pvp/_tags.js';
import type { CatalogItem } from '../api/pvp/_item-catalog.js';
import type { PvpGroundEffect, PvpStatus } from '../api/pvp/session.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import {
    ARCHETYPES,
    AI_UNDERSTOOD_TAGS,
    BLOODLINE_RANKS,
    COMPETITIVE_ARCHETYPES,
    COMPETITIVE_PROFILES,
    TEST_LEVELS,
    chooseAction,
    makeBuild,
    makeCompetitiveTemplateRoster,
    makeLevelRoster,
    runEntitlementComparison,
    runRankIsolationControl,
    scoredRate,
    sealPlayerBloodlineKit,
    simulateFight,
    upperEarnedForExactLevel,
} from './pvp-level-balance-sim.js';

const active = (name: string, kind: 'positive' | 'negative', percent?: number): PvpStatus => ({
    name,
    kind,
    rounds: 2,
    activeRound: 1,
    ...(percent === undefined ? {} : { percent }),
});

describe('level-aware PvP balance harness integrity', () => {
    it('keeps the AI registry in exact parity with every canonical combat tag', () => {
        assert.deepEqual([...AI_UNDERSTOOD_TAGS].sort(), [...CANONICAL_TAG_NAMES].sort());
    });

    it('uses the same ephemeral low-level human PvP HP curve as live sessions', () => {
        const expectedMultiplier = new Map([
            [10, 1.5],
            [15, 1 + 0.5 * (10 / 15)],
            [20, 1 + 0.5 * (5 / 15)],
            [25, 1],
        ]);
        for (const [level, multiplier] of expectedMultiplier) {
            const build = makeBuild(level, 'Burst', 'B Rank');
            const expected = Math.floor(maxHpForLevel(level) * multiplier);
            assert.equal(build.fighter.maxHp, expected, `level ${level}`);
            assert.equal(build.fighter.hp, expected, `level ${level} fresh-start HP`);
        }
    });

    it('uses the upper edge of each requested exact-level progression bracket', () => {
        for (const level of TEST_LEVELS.filter((value) => value < 100)) {
            assert.equal(upperEarnedForExactLevel(level), earnedForLevel(level + 1) - 1);
        }
        assert.deepEqual(
            TEST_LEVELS.slice(0, -1).map((level) => upperEarnedForExactLevel(level)),
            [1999, 5292, 11866, 19994],
        );
    });

    it('builds legal, full, level-capped A/B rosters with level-legal gear', () => {
        for (const level of TEST_LEVELS) {
            const roster = makeLevelRoster(level);
            assert.equal(roster.length, ARCHETYPES.length * BLOODLINE_RANKS.length);
            for (const build of roster) {
                assert.equal(build.jutsu.length, LOADOUT_CAP_BASE);
                assert.equal(build.loadoutSize, LOADOUT_CAP_BASE);
                assert.equal(new Set(build.jutsu.map((jutsu) => jutsu.id)).size, build.jutsu.length);
                const mastery = build.fighter.character.jutsuMastery as Array<{ level: number }>;
                assert.ok(mastery.every((row) => row.level === jutsuLevelCapForLevel(level)));
                const items = build.fighter.character.pvpItems as CatalogItem[];
                assert.ok(items.every((item) => effectiveItemLevelReq(item) <= level));
                const stats = build.fighter.character.stats as Record<string, number>;
                if (level < 100) {
                    assert.ok(STAT_KEYS.every((key) => stats[key]! <= statCapForLevel(level)));
                }
                if (build.weapon.weaponElement) {
                    assert.equal(build.weapon.weaponElement, build.fighter.character.element);
                }
                if (level === 100) {
                    assert.ok(build.namedGear);
                    assert.match(build.weapon.id, /^named-weapon-[0-9a-f]{32}$/i);
                }
            }
        }
    });

    it('seals every simulated bloodline within its real rank count and point budget', () => {
        for (const rank of BLOODLINE_RANKS) {
            for (const archetype of ARCHETYPES) {
                const kit = sealPlayerBloodlineKit(archetype, rank, 80);
                assert.equal(kit.length, rank === 'A Rank' ? 5 : 4);
                assert.ok(bloodlinePoints(kit, rank) <= pointBudgetForRank(rank));
                for (const jutsu of kit) {
                    assert.ok(jutsu.tags.every((tag) => tag.name === canonicalTagName(tag.name)));
                }
            }
        }
    });

    it('builds the real Bloodline Maker quick-start templates as a separate competitive roster', () => {
        const expectedNames = new Set([
            'Annihilation Blast', 'Rending Strike', 'Paralyzing Grip', 'Aegis Ward',
        ]);
        for (const level of [10, 100]) {
            const roster = makeCompetitiveTemplateRoster(level);
            assert.equal(roster.length, COMPETITIVE_ARCHETYPES.length * BLOODLINE_RANKS.length);
            assert.ok(roster.every((build) => COMPETITIVE_ARCHETYPES.includes(build.archetype as typeof COMPETITIVE_ARCHETYPES[number])));
            for (const build of roster) {
                const customCount = build.bloodlineRank === 'A Rank' ? 5 : 4;
                const custom = build.jutsu.slice(0, customCount);
                assert.equal(build.jutsu.length, LOADOUT_CAP_BASE);
                assert.ok(bloodlinePoints(custom, build.bloodlineRank) <= pointBudgetForRank(build.bloodlineRank));
                assert.ok(custom.some((jutsu) => [...expectedNames].some((name) => jutsu.name.includes(name))));
                assert.ok(custom.every((jutsu) => jutsu.id.startsWith('competitive-')));

                if (build.archetype === 'Sustain') {
                    const rending = custom.find((jutsu) => jutsu.name.includes('Rending Strike'))!;
                    assert.deepEqual(
                        rending.tags.map((tag) => canonicalTagName(tag.name)),
                        ['Wound', 'Decrease Damage Given'],
                    );
                }
                if (build.archetype === 'Burst') {
                    const searing = custom.find((jutsu) => jutsu.name.includes('Searing Barrage'))!;
                    assert.deepEqual(
                        searing.tags.map((tag) => canonicalTagName(tag.name)),
                        ['Ignition', 'Wound'],
                    );
                }
                if (build.archetype === 'Control') {
                    const sever = custom.find((jutsu) => jutsu.name.includes('Bloodline Sever'))!;
                    assert.deepEqual(
                        sever.tags.map((tag) => canonicalTagName(tag.name)),
                        ['Bloodline Seal', 'Drain'],
                    );
                }
                if (build.archetype === 'Prevention') {
                    const reflective = custom.find((jutsu) => jutsu.name.includes('Reflective Guard'))!;
                    assert.deepEqual(
                        reflective.tags.map((tag) => canonicalTagName(tag.name)),
                        ['Reflect'],
                    );
                }
            }
        }

        for (const profile of COMPETITIVE_PROFILES) {
            const roster = makeCompetitiveTemplateRoster(50, {}, profile);
            assert.equal(roster.length, COMPETITIVE_ARCHETYPES.length * BLOODLINE_RANKS.length);
            assert.ok(roster.every((build) => build.profileArchetype === profile));
            assert.deepEqual(
                [...new Set(roster.map((build) => build.archetype))].sort(),
                [...COMPETITIVE_ARCHETYPES].sort(),
            );
        }
    });

    it('values Copy/Mirror payloads and falls back to an equal plain cast when their wards block them', () => {
        const build = makeBuild(80, 'Disruption', 'B Rank');
        const copy = build.jutsu.find((jutsu) => jutsu.tags.some((tag) => canonicalTagName(tag.name) === 'Copy'))!;
        const mirror = build.jutsu.find((jutsu) => jutsu.tags.some((tag) => canonicalTagName(tag.name) === 'Mirror'))!;
        const plain = build.jutsu.find((jutsu) => jutsu.id.includes('Plain-Strike-A'.toLowerCase()) || jutsu.name.toLowerCase().includes('plain strike a'))!;
        assert.ok(copy && mirror && plain);

        const selectOnly = (jutsu: Array<typeof copy>, selfStatuses: PvpStatus[], opponentStatuses: PvpStatus[]) => {
            const self = structuredClone(build.fighter);
            const opponent = structuredClone(build.fighter);
            self.pos = 40;
            opponent.pos = 41;
            self.statuses = selfStatuses;
            opponent.statuses = opponentStatuses;
            self.character.jutsu = jutsu;
            return chooseAction(self, opponent, build.weapon, {
                [build.weapon.id]: 99,
                clear: 99,
                cleanse: 99,
                basicHeal: 99,
            }, 1, 100, 0, true);
        };

        const copyOpen = selectOnly([copy, plain], [], [active('Increase Damage Given', 'positive', 30)]);
        assert.equal(copyOpen.kind, 'jutsu');
        if (copyOpen.kind === 'jutsu') assert.equal(copyOpen.jutsu.id, copy.id);
        const copyBlocked = selectOnly([copy, plain], [active('Buff Prevent', 'negative')], [active('Increase Damage Given', 'positive', 30)]);
        assert.equal(copyBlocked.kind === 'jutsu' ? copyBlocked.jutsu.id : '', plain.id);
        const copyOnlyBlocked = selectOnly([copy], [active('Buff Prevent', 'negative')], [active('Increase Damage Given', 'positive', 30)]);
        assert.equal(copyOnlyBlocked.kind === 'jutsu' ? copyOnlyBlocked.jutsu.id : '', copy.id, 'Copy remains a damaging technique');

        const mirrorOpen = selectOnly([mirror, plain], [active('Wound', 'negative', 30)], []);
        assert.equal(mirrorOpen.kind, 'jutsu');
        if (mirrorOpen.kind === 'jutsu') assert.equal(mirrorOpen.jutsu.id, mirror.id);
        const mirrorBlocked = selectOnly([mirror, plain], [active('Wound', 'negative', 30)], [active('Debuff Prevent', 'positive')]);
        assert.equal(mirrorBlocked.kind === 'jutsu' ? mirrorBlocked.jutsu.id : '', plain.id);
    });

    it('values direct Push/Pull displacement and drops that value when Debuff Prevent blocks it', () => {
        const build = makeBuild(50, 'Tempo', 'B Rank');
        const seed = build.jutsu.find((jutsu) => Number(jutsu.effectPower ?? 0) > 0)!;
        const plain = { ...seed, id: 'a-plain-spacing', name: 'Plain Spacing Hit', ap: 60, range: 4, tags: [] };
        const push = { ...plain, id: 'z-push-spacing', name: 'Push Spacing Hit', tags: [{ name: 'Push' }] };
        const pull = { ...plain, id: 'z-pull-spacing', name: 'Pull Spacing Hit', tags: [{ name: 'Pull' }] };
        const weaponCooldowns = { [build.weapon.id]: 99, clear: 99, cleanse: 99, basicHeal: 99 };
        const select = (jutsu: Array<typeof plain>, selfPos: number, opponentPos: number, opponentStatuses: PvpStatus[] = []) => {
            const self = structuredClone(build.fighter);
            const opponent = structuredClone(build.fighter);
            self.pos = selfPos;
            opponent.pos = opponentPos;
            self.hp = Math.floor(self.maxHp * 0.35);
            opponent.statuses = opponentStatuses;
            self.character.jutsu = jutsu;
            return chooseAction(self, opponent, build.weapon, weaponCooldowns, 1, 100, 0, true);
        };

        const pushOpen = select([plain, push], 40, 41);
        assert.equal(pushOpen.kind === 'jutsu' ? pushOpen.jutsu.id : '', push.id);
        const pushBlocked = select([plain, push], 40, 41, [active('Debuff Prevent', 'positive')]);
        assert.equal(pushBlocked.kind === 'jutsu' ? pushBlocked.jutsu.id : '', plain.id);

        const pullOpen = select([plain, pull], 40, 44);
        assert.equal(pullOpen.kind === 'jutsu' ? pullOpen.jutsu.id : '', pull.id);
        const pullBlocked = select([plain, pull], 40, 44, [active('Debuff Prevent', 'positive')]);
        assert.equal(pullBlocked.kind === 'jutsu' ? pullBlocked.jutsu.id : '', plain.id);
    });

    it('values Barrier and Increase Discipline, including the live Buff Prevent ward', () => {
        const build = makeBuild(80, 'Burst', 'B Rank');
        const source = build.jutsu.find((jutsu) => Number(jutsu.effectPower ?? 0) > 0)!;
        const fighter = structuredClone(build.fighter);
        const opponent = structuredClone(build.fighter);
        fighter.pos = 40;
        opponent.pos = 42;

        const barrier = {
            ...source,
            id: 'forced-barrier',
            name: 'Forced Barrier',
            ap: 40,
            effectPower: 0,
            chakraCost: 0,
            staminaCost: 0,
            target: 'OPPONENT' as const,
            method: 'SINGLE' as const,
            tags: [{ name: 'Barrier', percent: 0 }],
        };
        fighter.character.jutsu = [barrier];
        const barrierChoice = chooseAction(
            fighter, opponent, build.weapon, { [build.weapon.id]: 99 }, 1, 100, 0,
        );
        assert.equal(barrierChoice.kind === 'jutsu' ? barrierChoice.jutsu.id : '', barrier.id);

        const discipline = {
            ...barrier,
            id: 'forced-increase-discipline',
            name: 'Forced Increase Discipline',
            type: 'Ninjutsu',
            target: 'SELF' as const,
            tags: [{ name: 'Increase Discipline', percent: 30 }],
        };
        fighter.character.jutsu = [discipline];
        const disciplineChoice = chooseAction(
            fighter, opponent, build.weapon, { [build.weapon.id]: 99 }, 1, 100, 0,
        );
        assert.equal(disciplineChoice.kind === 'jutsu' ? disciplineChoice.jutsu.id : '', discipline.id);

        fighter.statuses = [active('Buff Prevent', 'negative')];
        const wardedChoice = chooseAction(
            fighter, opponent, build.weapon, { [build.weapon.id]: 99 }, 1, 100, 0,
        );
        assert.notEqual(wardedChoice.kind === 'jutsu' ? wardedChoice.jutsu.id : '', discipline.id);
    });

    it('understands the selected Rending and Reflective Guard template riders and their prevention wards', () => {
        const roster = makeCompetitiveTemplateRoster(50);
        const bruiser = roster.find((build) => build.archetype === 'Sustain' && build.bloodlineRank === 'B Rank')!;
        const support = roster.find((build) => build.archetype === 'Prevention' && build.bloodlineRank === 'B Rank')!;
        const originalRending = bruiser.jutsu.find((jutsu) => jutsu.name.includes('Rending Strike'))!;
        const originalReflective = support.jutsu.find((jutsu) => jutsu.name.includes('Reflective Guard'))!;
        const woundOnly = {
            ...originalRending,
            id: 'a-wound-only',
            tags: originalRending.tags.filter((tag) => canonicalTagName(tag.name) === 'Wound'),
        };
        const rending = { ...originalRending, id: 'z-rending-with-suppression' };
        const plainGuardHit = { ...originalReflective, id: 'a-plain-guard-hit', tags: [] };
        const reflective = { ...originalReflective, id: 'z-reflect-only-guard' };
        assert.deepEqual(reflective.tags.map((tag) => canonicalTagName(tag.name)), ['Reflect']);

        const select = (
            build: typeof bruiser,
            jutsu: Array<typeof woundOnly>,
            selfStatuses: PvpStatus[] = [],
            opponentStatuses: PvpStatus[] = [],
        ) => {
            const self = structuredClone(build.fighter);
            const opponent = structuredClone(build.fighter);
            self.pos = 40;
            opponent.pos = 41;
            self.statuses = selfStatuses;
            opponent.statuses = opponentStatuses;
            self.character.jutsu = jutsu;
            return chooseAction(self, opponent, build.weapon, {
                [build.weapon.id]: 99, clear: 99, cleanse: 99, basicHeal: 99,
            }, 1, 100, 0, true);
        };

        const rendingOpen = select(bruiser, [woundOnly, rending]);
        assert.equal(rendingOpen.kind === 'jutsu' ? rendingOpen.jutsu.id : '', rending.id);
        const rendingBlocked = select(bruiser, [woundOnly, rending], [], [active('Debuff Prevent', 'positive')]);
        assert.equal(rendingBlocked.kind === 'jutsu' ? rendingBlocked.jutsu.id : '', woundOnly.id);

        const reflectOpen = select(support, [plainGuardHit, reflective]);
        assert.equal(reflectOpen.kind === 'jutsu' ? reflectOpen.jutsu.id : '', reflective.id);
        const reflectBlocked = select(support, [plainGuardHit, reflective], [active('Buff Prevent', 'negative')]);
        assert.equal(reflectBlocked.kind === 'jutsu' ? reflectBlocked.jutsu.id : '', plainGuardHit.id);
    });

    it('conserves attempted tag telemetry into applied or blocked/no-target outcomes', () => {
        const roster = makeLevelRoster(25);
        const result = simulateFight(roster[0]!, roster.at(-1)!, 'p1');
        assert.ok(Object.keys(result.tagAttempts).length > 0);
        for (const [tag, attempts] of Object.entries(result.tagAttempts)) {
            assert.equal(attempts, (result.tagApplied[tag] ?? 0) + (result.tagBlockedOrEmpty[tag] ?? 0), tag);
        }
    });

    it('counts direct status tags even though the planner also exposes groundTags metadata', () => {
        const attacker = structuredClone(makeBuild(25, 'Control', 'A Rank'));
        const defender = structuredClone(makeBuild(25, 'Prevention', 'B Rank'));
        const poison = attacker.jutsu.find((jutsu) => jutsu.tags.some((tag) => canonicalTagName(tag.name) === 'Poison'))!;
        assert.ok(poison && poison.method === 'SINGLE');
        attacker.jutsu = [poison];
        attacker.fighter.character.jutsu = [poison];
        defender.jutsu = [];
        defender.fighter.character.jutsu = [];
        attacker.weapon = { ...attacker.weapon, id: 'disabled-attacker-weapon', weaponRange: 0, weaponEp: 0, weaponTags: [] };
        defender.weapon = { ...defender.weapon, id: 'disabled-defender-weapon', weaponRange: 0, weaponEp: 0, weaponTags: [] };
        const result = simulateFight(attacker, defender, 'p1');
        assert.ok((result.tagAttempts.Poison ?? 0) > 0);
        assert.equal(result.tagAttempts.Poison, (result.tagApplied.Poison ?? 0) + (result.tagBlockedOrEmpty.Poison ?? 0));
    });

    it('ages wards before previewing a closer zone and can leave a persistent hostile zone', () => {
        const groundBuild = makeBuild(80, 'Ground', 'A Rank');
        const poisonField = groundBuild.jutsu.find((jutsu) => jutsu.method === 'INSTANT_EFFECT')!;
        assert.ok(poisonField);
        const chooseGround = (ward: PvpStatus) => {
            const self = structuredClone(groundBuild.fighter);
            const opponent = structuredClone(groundBuild.fighter);
            self.pos = 40;
            opponent.pos = 42;
            self.character.jutsu = [poisonField];
            opponent.statuses = [ward];
            return chooseAction(self, opponent, groundBuild.weapon, { [groundBuild.weapon.id]: 99 }, 1, 100, 0, false, [], 'p2');
        };
        const expiringWard = chooseGround({ ...active('Debuff Prevent', 'positive'), rounds: 1 });
        assert.equal(expiringWard.kind === 'jutsu' ? expiringWard.jutsu.id : '', poisonField.id);
        const pendingWard = chooseGround({ ...active('Debuff Prevent', 'positive'), activeRound: 2 });
        assert.notEqual(pendingWard.kind === 'jutsu' ? pendingWard.jutsu.id : '', poisonField.id);

        const self = structuredClone(groundBuild.fighter);
        const opponent = structuredClone(groundBuild.fighter);
        self.pos = 40;
        opponent.pos = 41;
        self.character.jutsu = [];
        const zone: PvpGroundEffect = {
            id: 'hostile-zone', owner: 'p2', name: 'Suppression Field',
            tiles: [40], rounds: 2, activeRound: 1,
            tags: [{ name: 'Decrease Damage Given', percent: 30 }],
        };
        const escape = chooseAction(self, opponent, groundBuild.weapon, { [groundBuild.weapon.id]: 99 }, 1, 100, 0, true, [zone], 'p1');
        assert.equal(escape.kind, 'move');
        if (escape.kind === 'move') assert.notEqual(escape.tile, self.pos);
    });

    it('mirrors identical-build outcomes when the opener is swapped', () => {
        for (const archetype of ARCHETYPES) {
            const build = makeBuild(50, archetype, 'A Rank');
            const p1Open = simulateFight(build, build, 'p1');
            const p2Open = simulateFight(build, build, 'p2');
            const swap = (winner: typeof p1Open.winner) => winner === 'p1' ? 'p2' : winner === 'p2' ? 'p1' : 'draw';
            assert.equal(p1Open.winner, swap(p2Open.winner), archetype);
            assert.equal(p1Open.rounds, p2Open.rounds, archetype);
            assert.equal(p1Open.p1Health, p2Open.p2Health, archetype);
            assert.equal(p1Open.p2Health, p2Open.p1Health, archetype);
        }
    });

    it('isolates the intended A-rank edge with identical 12-button loadouts', () => {
        const report = runRankIsolationControl(50);
        assert.equal(report.games, COMPETITIVE_PROFILES.length * COMPETITIVE_ARCHETYPES.length * 4);
        assert.ok(scoredRate(report) >= 0.50 && scoredRate(report) <= 0.70, `${scoredRate(report)}`);
    });

    it('verifies that human PvP seals 12-slot and 15-slot origins to combat parity', () => {
        const normal = makeLevelRoster(25, { loadoutSize: LOADOUT_CAP_BASE });
        const supporter = makeLevelRoster(25, { loadoutSize: LOADOUT_CAP_SUB });
        assert.equal(normal.length, supporter.length);
        for (let i = 0; i < normal.length; i += 1) {
            assert.equal(normal[i]!.jutsu.length, LOADOUT_CAP_BASE);
            assert.equal(supporter[i]!.jutsu.length, LOADOUT_CAP_SUB);
            assert.equal(normal[i]!.archetype, supporter[i]!.archetype);
            assert.equal(normal[i]!.bloodlineRank, supporter[i]!.bloodlineRank);
            assert.equal(normal[i]!.earnedStats, supporter[i]!.earnedStats);
            assert.deepEqual(normal[i]!.fighter.character.stats, supporter[i]!.fighter.character.stats);
        }
        const report = runEntitlementComparison(25);
        assert.equal(report.fights, ARCHETYPES.length * BLOODLINE_RANKS.length * 4);
        assert.equal(report.base.games, report.fights);
        assert.equal(report.supporter.games, report.fights);
        assert.equal(scoredRate(report.supporter), 0.5, 'human PvP seals both entitlement tiers to the same 12 techniques');
        assert.deepEqual(report.issues, []);
    });
});
