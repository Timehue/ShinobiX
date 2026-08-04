import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyJutsu } from './pvp/move.js';
import { endTurn, runAiUntilHuman, startRound } from './towers/_engine.js';
import { makeRng } from './towers/_sim.js';
import { buildAiFightEncounter } from './missions/_ai-fight-encounter.js';
import { AI_PROFILE_CATALOG } from './_ai-profile-catalog.js';
import { pveAiMasteryForLevel } from './_pve-difficulty.js';
import { pveAiMasteryEnabled, sealPveAiMastery, type PveMasteryMode } from './_pve-ai-mastery.js';
import type { TowerSession, TowerActor } from './towers/_tower-session.js';

/*
 * Step C: server AI enemies get their jutsu mastery.
 *
 * The bug: applyJutsu reads mastery off the caster, no enemy TEMPLATE carried
 * one, so every server AI cast at masteryDamageFrac(0) = 0.3. This file pins
 * that the seal happens, that it is worth roughly the 3.3x the finding claimed,
 * that it never overwrites an actor sealed from a real save, and that it ships ON.
 */

const KIT = [
    { id: 'j-fire', name: 'J', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 4, effectPower: 30, tags: [] },
    { id: 'j-wind', name: 'K', type: 'Ninjutsu', element: 'Wind', ap: 40, range: 3, effectPower: 18, tags: [] },
];

function actor(id: string, side: TowerActor['side'], level: number, extra: Record<string, unknown> = {}): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: side !== 'squad',
        hp: 1000, maxHp: 1000, chakra: 900, maxChakra: 900, stamina: 900, maxStamina: 900,
        shield: 0, statuses: [], cooldowns: {}, pos: 0,
        character: {
            level, stats: { ninjutsuOffense: 900, ninjutsuDefense: 200 },
            jutsu: KIT.map(j => ({ ...j })), ...extra,
        },
    };
}
const session = (...actors: TowerActor[]): TowerSession => ({ actors } as unknown as TowerSession);
const masteryOf = (a: TowerActor) => a.character.jutsuMastery as Array<{ jutsuId: string; level: number }> | undefined;

describe('sealPveAiMastery', () => {
    it('seals every enemy jutsu at the level-derived mastery', () => {
        const s = session(actor('boss', 'enemy', 80));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 1);
        const mastery = masteryOf(s.actors[0])!;
        assert.deepEqual(mastery.map(m => m.jutsuId).sort(), ['j-fire', 'j-wind']);
        for (const entry of mastery) assert.equal(entry.level, pveAiMasteryForLevel(80));
    });

    it('leaves squad members alone — they carry their REAL mastery', () => {
        const s = session(actor('sq-0', 'squad', 80), actor('boss', 'enemy', 80));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 1, 'only the enemy is sealed');
        assert.equal(masteryOf(s.actors.find(a => a.id === 'sq-0')!), undefined);
    });

    it('leaves NPC allies alone — merc fighters are already built with mastery 50', () => {
        const s = session(actor('npc-0', 'npc', 50), actor('boss', 'enemy', 50));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 1);
        assert.equal(masteryOf(s.actors.find(a => a.id === 'npc-0')!), undefined);
    });

    it('NEVER overwrites an existing mastery array', () => {
        // The safety property for anything sealed from a real save
        // (sealTowerFighter carries the player's own mastery) and for encounters
        // that seal their own. Also what makes a re-seal idempotent.
        const existing = [{ jutsuId: 'j-fire', level: 7 }];
        const s = session(actor('boss', 'enemy', 80, { jutsuMastery: existing }));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 0, 'skipped');
        assert.deepEqual(masteryOf(s.actors[0]), existing, 'untouched');
    });

    it('is idempotent — a second seal cannot ratchet the boss upward', () => {
        const s = session(actor('boss', 'enemy', 80));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 1);
        const first = JSON.stringify(masteryOf(s.actors[0]));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 0, 'second call is a no-op');
        assert.equal(JSON.stringify(masteryOf(s.actors[0])), first);
    });

    it('skips an enemy with no jutsu at all', () => {
        const s = session(actor('boss', 'enemy', 80, { jutsu: [] }));
        assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 0);
        assert.equal(masteryOf(s.actors[0]), undefined);
    });

    it('is worth roughly the 3.3x the finding claimed', () => {
        // Closes the loop through the REAL resolver: seal the mastery, then
        // check the damage applyJutsu actually produces against an unsealed
        // caster. Without this the test above only proves an array was written.
        const fighter = (mastery?: Array<{ jutsuId: string; level: number }>) => ({
            name: 'A', hp: 500, maxHp: 500, chakra: 900, maxChakra: 900,
            stamina: 900, maxStamina: 900, shield: 0, statuses: [], pos: 0,
            character: {
                level: 80, stats: { ninjutsuOffense: 900, ninjutsuDefense: 200 }, jutsu: [],
                ...(mastery ? { jutsuMastery: mastery } : {}),
            },
        });
        const defender = () => ({
            name: 'D', hp: 50_000, maxHp: 50_000, chakra: 900, maxChakra: 900,
            stamina: 900, maxStamina: 900, shield: 0, statuses: [], pos: 0,
            character: { level: 80, stats: { ninjutsuOffense: 200, ninjutsuDefense: 200 }, jutsu: [] },
        });

        const s = session(actor('boss', 'enemy', 80));
        sealPveAiMastery(s, { mode: 'MISSION', env: {} });
        const sealedMastery = masteryOf(s.actors[0])!;

        const before = applyJutsu(fighter() as never, defender() as never, KIT[0] as never, 1, 'central', 1);
        const after = applyJutsu(fighter(sealedMastery) as never, defender() as never, KIT[0] as never, 1, 'central', 1);
        assert.ok(before.metadata.damage > 0, 'fixture check: the unsealed cast deals damage');
        const ratio = after.metadata.damage / Math.max(1, before.metadata.damage);
        // Asserted as a band, not an exact figure, so tuning the mastery ramp
        // does not spuriously fail this.
        assert.ok(ratio > 2.5 && ratio < 4, `expected roughly a 3.3x lift, got ${ratio.toFixed(2)}x`);
    });

    describe('kill switches', () => {
        const MODES: PveMasteryMode[] = ['MISSION', 'STORY', 'TOWER', 'SPIRE', 'CLAN_BOSS'];

        it('ships ON — an empty environment arms every mode', () => {
            for (const mode of MODES) assert.equal(pveAiMasteryEnabled(mode, {}), true, `${mode} must be ON by default`);
        });

        it('the global switch disarms every mode', () => {
            for (const mode of MODES) {
                assert.equal(pveAiMasteryEnabled(mode, { DISABLE_PVE_AI_MASTERY: '1' }), false, mode);
            }
            const s = session(actor('boss', 'enemy', 80));
            assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: { DISABLE_PVE_AI_MASTERY: '1' } }), 0);
            assert.equal(masteryOf(s.actors[0]), undefined, 'and nothing was sealed');
        });

        it('Spire has its own dial, independent of the story towers', () => {
            // Spire bosses are level 100 = peer band, where the step-B hit guard
            // is an intentional no-op — so this uplift is unbounded there and
            // must be separately reversible.
            const env = { DISABLE_PVE_AI_MASTERY_SPIRE: '1' };
            assert.equal(pveAiMasteryEnabled('SPIRE', env), false);
            assert.equal(pveAiMasteryEnabled('TOWER', env), true, 'story floors stay armed');
        });

        it('only the exact value "1" disarms', () => {
            assert.equal(pveAiMasteryEnabled('MISSION', { DISABLE_PVE_AI_MASTERY: 'true' }), true);
            assert.equal(pveAiMasteryEnabled('MISSION', { DISABLE_PVE_AI_MASTERY: '0' }), true);
        });
    });
});

describe('the sealed mastery reaches the damage the ENGINE applies', () => {
    it('a sealed enemy out-damages an unsealed one over a real enemy turn', () => {
        // End-to-end, and the reason it matters: the tests above prove an array
        // was written and that applyJutsu responds to one, but the engine
        // resolves through actorToFighter -> towerActorToPvpFighter -> the PvP
        // resolver. Both of those rebuild the fighter object; if either ever
        // narrows `character` instead of passing it by reference, step C becomes
        // a silent no-op and nothing else here would notice.
        //
        // Level 95 on purpose: the PEER band, where the step-B hit guard is an
        // intentional no-op. In any lower band the per-hit cap would clamp both
        // runs to the same ceiling and mask the difference entirely.
        const build = (seal: boolean): TowerSession => {
            const s = buildAiFightEncounter({
                playerName: 'Rill',
                save: {
                    character: {
                        name: 'Rill', level: 60, specialty: 'Ninjutsu', maxHp: 40_000, hp: 40_000,
                        stats: {
                            strength: 100, speed: 100, intelligence: 100, willpower: 100,
                            ninjutsuOffense: 200, ninjutsuDefense: 100, taijutsuOffense: 100,
                            taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100,
                            genjutsuOffense: 100, genjutsuDefense: 100,
                        },
                        equippedJutsuIds: ['starter-universal-flicker'],
                    },
                    savedBloodlines: [], creatorJutsus: [],
                },
                profile: AI_PROFILE_CATALOG['builtin-ai-academy-sparring'] as never,
                runId: `mastery-e2e-${seal}`, seed: 99, now: 1_770_000_000_000,
                scaling: { level: 95, statBonus: 200 },
            });
            // buildAiFightEncounter seals its own mastery (step 3b). Strip it to
            // model the pre-step-C world, then re-seal via THIS module for the
            // sealed arm, so both arms differ only by the mastery.
            const boss = s.actors.find(a => a.id === 'boss')!;
            delete boss.character.jutsuMastery;
            if (seal) assert.equal(sealPveAiMastery(s, { mode: 'MISSION', env: {} }), 1);
            startRound(s);
            return s;
        };

        const damageOverOneEnemyTurn = (s: TowerSession): number => {
            const floor = s.encounterFloor as never;
            const rng = makeRng(s.seed);
            const hero = () => s.actors.find(a => a.ai === false)!;
            const before = hero().hp;
            endTurn(s, floor);                 // human passes -> the enemy is up
            runAiUntilHuman(s, floor, rng);    // enemy acts, then stops at the human
            return before - hero().hp;
        };

        const unsealed = damageOverOneEnemyTurn(build(false));
        const sealed = damageOverOneEnemyTurn(build(true));

        // NON-VACUITY: both arms must actually have landed a hit, or "sealed is
        // bigger" could hold for two zeroes or one missed turn.
        assert.ok(unsealed > 0, `fixture check: the unsealed enemy must land damage (got ${unsealed})`);
        assert.ok(sealed > 0, `fixture check: the sealed enemy must land damage (got ${sealed})`);
        assert.ok(
            sealed > unsealed,
            `the sealed mastery must reach the engine's damage (${unsealed} -> ${sealed})`,
        );
    });
});

describe('step C wiring', () => {
    const root = (() => {
        let dir = process.cwd();
        for (let i = 0; i < 8; i++) {
            if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'api'))) return dir;
            const up = dirname(dir);
            if (up === dir) break;
            dir = up;
        }
        return process.cwd();
    })();
    const read = (f: string) => readFileSync(join(root, f), 'utf8');

    const EXPECT: Array<[string, string]> = [
        ['api/clan-boss/assault-start.ts', "mode: 'CLAN_BOSS'"],
    ];
    for (const [file, marker] of EXPECT) {
        it(`${file} seals AI mastery`, () => {
            const src = read(file);
            assert.ok(src.includes('sealPveAiMastery'), `${file} no longer seals AI mastery`);
            assert.ok(src.includes(marker), `${file} no longer passes ${marker}`);
        });
    }

    for (const [file, marker] of [
        ['api/missions/combat-start.ts', "difficultyMode: 'MISSION'"],
        ['api/story/boss-start.ts', "difficultyMode: 'STORY'"],
    ] as const) {
        it(`${file} delegates AI mastery to the Solo-PvE builder`, () => {
            const src = read(file);
            assert.ok(src.includes('buildSoloPveAiEncounter'), `${file} no longer uses the Solo-PvE encounter builder`);
            assert.ok(src.includes(marker), `${file} no longer passes ${marker}`);
            assert.ok(!src.includes('sealPveAiMastery'), `${file} must not re-seal mastery through the retired Tower hook`);
        });
    }

    it('towers/start.ts routes Spire to its own mode', () => {
        const src = read('api/towers/start.ts');
        assert.ok(src.includes('sealPveAiMastery'), 'towers no longer seal AI mastery');
        assert.ok(/mode === 'spire' \? 'SPIRE' : 'TOWER'/.test(src), 'Spire must not share the TOWER dial');
    });

    it('mastery is sealed AFTER the guard, and before the first AI turn', () => {
        // The owner ruling in order form: the guard must bound the uplift, and
        // both must precede the inline startRound in the tower-style handlers.
        for (const file of ['api/towers/start.ts', 'api/clan-boss/assault-start.ts']) {
            const src = read(file);
            const guard = src.indexOf('sealPveDifficultyBand(session');
            const mastery = src.indexOf('sealPveAiMastery(session');
            const start = src.indexOf('startRound(session)');
            assert.ok(guard > 0 && mastery > 0 && start > 0, `${file}: fixture check — all three present`);
            assert.ok(guard < mastery, `${file}: the guard must be sealed before mastery`);
            assert.ok(mastery < start, `${file}: mastery must be sealed before the first AI turn`);
        }
    });

    it('the weekly boss and Anbu Vault stay deliberately unarmed', () => {
        // Weekly boss has NO server boss->player clamp, so tripling its damage is
        // exactly the "mastery before the guard" failure the ruling forbids.
        // Anbu's opponent is a real player whose own mastery is already sealed.
        for (const file of ['api/weekly-boss.ts', 'api/village/anbu-infiltration.ts']) {
            assert.ok(!read(file).includes('sealPveAiMastery'), `${file} armed AI mastery — see the _pve-ai-mastery.ts header`);
        }
    });
});
