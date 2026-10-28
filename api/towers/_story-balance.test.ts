import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_CATALOG, getFloor, type TowerFloor } from './_floor-catalog.js';
import { requireEnemyTemplate } from './_enemy-templates.js';
import { storyTowerEnemy } from './_story-balance.js';
import { buildTowerEncounter } from './_encounter.js';
import { applyPartyScaling, applyAction } from './_engine.js';
import { sealTowerCatalogFloor, floorForSession } from './_session-floor.js';
import { validateFloor } from './_floor-validate.js';

const squad = (size: number) => Array.from({ length: size }, (_, i) => ({
    id: `sq-${i}`, name: `Player ${i}`, ownerSlug: `player${i}`, ai: false,
    character: { level: 30, maxHp: 3400, maxChakra: 3600, maxStamina: 3600, stats: {} },
}));
const build = (floor: TowerFloor, size = 4) => buildTowerEncounter({ floor, squad: squad(size), partySize: size, runId: 'balance-test', seed: 101, now: 0, gapClosingJutsu: [] });
const enemies = (session: ReturnType<typeof build>) => [...session.actors,
    ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)].filter(actor => actor.side === 'enemy');

test('Story has an explicit increasing level-30 to level-100 four-player balance curve', () => {
    let previousHp = 0;
    for (const floor of FLOOR_CATALOG) {
        assert.equal(floor.recommendedLevel, 30 + (floor.id - 1) * 5);
        assert.equal(floor.balanceFor, 4);
        assert.deepEqual(validateFloor(floor), []);
        const enemy = storyTowerEnemy(requireEnemyTemplate('grunt-bandit'), floor);
        assert.ok(enemy.hp > previousHp);
        previousHp = enemy.hp;
        for (const discipline of ['taijutsu', 'bukijutsu', 'genjutsu', 'ninjutsu']) {
            assert.ok(enemy.stats[`${discipline}Defense`]! >= 450);
        }
    }
});

test('ordinary enemy combat composites train through the middle ranks and reach their strongest floor at level 100', () => {
    const template = requireEnemyTemplate('grunt-bandit');
    const before = structuredClone(template);
    const mid = storyTowerEnemy(template, getFloor(9)!);
    const end = storyTowerEnemy(template, getFloor(15)!);
    assert.equal(getFloor(9)!.recommendedLevel, 70);
    assert.equal(getFloor(15)!.recommendedLevel, 100);
    assert.ok(mid.stats.taijutsuOffense! >= 1480);
    for (const key of ['strength', 'speed', 'intelligence', 'willpower']) {
        assert.ok(mid.stats[key]! >= 750, `${key}: middle ranks cannot retain Academy-era secondaries`);
        assert.ok(end.stats[key]! > mid.stats[key]!, `${key}: level 100 is endgame`);
    }
    assert.ok(end.stats.taijutsuOffense! > mid.stats.taijutsuOffense!);
    assert.deepEqual(template, before, 'the shared and embedded enemy template must remain untouched');
    assert.deepEqual([5, 7, 10].map(id => getFloor(id)!.boss!.hp), [30000, 38000, 60000]);
});
test('all public Story pods, bosses, delayed waves and summons retain four-player strength for one to four entrants', () => {
    for (const floor of FLOOR_CATALOG) {
        const full = enemies(build(floor));
        for (const size of [1, 2, 3]) {
            const session = build(floor, size);
            assert.deepEqual(enemies(session).map(actor => ({ hp: actor.maxHp, character: actor.character })),
                full.map(actor => ({ hp: actor.maxHp, character: actor.character })), `floor ${floor.id}, size ${size}`);
            const before = structuredClone(enemies(session));
            applyPartyScaling(session, floor);
            assert.deepEqual(enemies(session), before, 'repeat scaling cannot weaken the encounter');
        }
        const boss = full.find(actor => actor.id === 'boss');
        if (floor.boss?.mechanic === 'summon') {
            const template = boss!.character.summonTemplate as { hp: number };
            assert.ok(template.hp > requireEnemyTemplate(floor.boss.summonAiId ?? 'grunt-bandit').hp);
        }
    }
});

test('Story bosses keep their authored HP, offense and mechanics with usable defenses against every discipline', () => {
    for (const floor of FLOOR_CATALOG.filter(candidate => candidate.boss)) {
        const template = requireEnemyTemplate(floor.boss!.aiId);
        const before = structuredClone(template);
        const balanced = storyTowerEnemy(template, floor);
        const builtBoss = enemies(build(floor)).find(actor => actor.id === 'boss')!;
        assert.equal(balanced.hp, template.hp);
        assert.equal(builtBoss.maxHp, floor.boss?.hp ?? template.hp);
        assert.equal(builtBoss.character.level, Math.max(template.level, floor.recommendedLevel!));
        assert.equal(balanced.armorRawDR, template.armorRawDR);
        assert.deepEqual(balanced.jutsu, template.jutsu);
        for (const [key, value] of Object.entries(template.stats)) if (key.endsWith('Offense')) assert.equal(balanced.stats[key], value);
        for (const discipline of ['taijutsu', 'bukijutsu', 'genjutsu', 'ninjutsu']) {
            const key = `${discipline}Defense`;
            assert.equal(balanced.stats[key], Math.max(template.stats[key] ?? 0, 450 + (floor.id - 1) * 65));
            assert.equal((builtBoss.character.stats as Record<string, number>)[key], balanced.stats[key], 'new encounters must actually use the defense floor');
        }
        assert.deepEqual(template, before, 'the shared template must not mutate');
    }
});
test('an on-level ordinary burst cannot one-shot a new Story bandit', () => {
    const floor = getFloor(1)!;
    const session = build(floor);
    const caster = session.actors[0]!;
    const target = enemies(session)[0]!;
    caster.character = { level: 30, specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1211, intelligence: 939, willpower: 939 },
        bloodlineMult: 1.15, itemDamagePct: 15,
        jutsu: [{ id: 'burst', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50 }], jutsuMastery: [{ jutsuId: 'burst', level: 10 }] };
    caster.pos = 0; target.pos = 1;
    session.map.features = []; session.turnQueue = [caster.id]; session.activeIndex = 0; session.round = 1; session.activeAp = 100;
    const hp = target.hp;
    assert.equal(applyAction(session, floor, { actorId: caster.id, type: 'jutsu', jutsuId: 'burst', targetId: target.id }, () => .5).applied, true);
    assert.ok(target.hp > 0 && target.hp < hp, `burst dealt ${hp - target.hp} to ${hp} HP`);
});
test('legacy sealed Story floors retain their exact pre-growth rules and enemy snapshots', () => {
    const oldFloor = structuredClone(getFloor(2)!);
    delete oldFloor.squadBalance; delete oldFloor.recommendedLevel;
    const template = requireEnemyTemplate('grunt-bandit');
    const unchanged = structuredClone(template);
    assert.equal(storyTowerEnemy(template, oldFloor), template);
    assert.deepEqual(template, unchanged);
    const session = build(oldFloor, 2);
    sealTowerCatalogFloor(session, oldFloor, 'story');
    session.floorProvenance!.contentVersion = 'story-tower-v6';
    assert.equal(floorForSession(session)?.squadBalance, undefined);
    assert.equal(enemies(session)[0]!.maxHp, Math.round(template.hp * .6));
});
