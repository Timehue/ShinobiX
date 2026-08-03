import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
    pveBandLevelForSession,
    pveDifficultyGuardEnabled,
    sealPveDifficultyBand,
    type PveBandMode,
} from './_pve-band-seal.js';
import { readSession, writeSession } from './towers/_tower-store.js';
import type { TowerSession, TowerActor } from './towers/_tower-session.js';

/*
 * Step B: arming the standard-PvE difficulty layer on the other server PvE modes.
 *
 * The curve itself is parity-tested in scripts/pve-difficulty-parity.test.ts and
 * the engine half in api/towers/_pve-guard.test.ts + _pve-band-ai.test.ts. What
 * THIS file pins is the seal: that it scales the right actors by the right band,
 * that it is idempotent (double-scaling would compound 0.6 x 0.6 into a trivial
 * fight), that both kill switches work, and that each entry point still calls it.
 */

function actor(id: string, side: TowerActor['side'], level: number, maxHp: number): TowerActor {
    return {
        id, side, name: id, ownerSlug: null, ai: side !== 'squad',
        hp: maxHp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos: 0,
        character: { level, stats: { ninjutsuOffense: 1000, taijutsuDefense: 500 } },
    };
}

function session(...actors: TowerActor[]): TowerSession {
    return { actors } as unknown as TowerSession;
}

const enemyStats = (s: TowerSession, id = 'boss') =>
    (s.actors.find(a => a.id === id)!.character.stats as Record<string, number>);

describe('sealPveDifficultyBand', () => {
    it('scales enemy stats + HP by the band and seals the guard', () => {
        const s = session(actor('sq-0', 'squad', 20, 800), actor('boss', 'enemy', 20, 1000));
        assert.equal(sealPveDifficultyBand(s, { mode: 'MISSION', env: {} }), true);
        // Easy band (level 20): stats x0.6, HP x0.75.
        assert.equal(enemyStats(s).ninjutsuOffense, 600);
        assert.equal(s.actors.find(a => a.id === 'boss')!.maxHp, 750);
        assert.deepEqual(s.pveGuard, { enemyLevel: 20, turnStartHp: {}, dealtThisTurn: {} });
    });

    it('never touches squad actors', () => {
        const s = session(actor('sq-0', 'squad', 20, 800), actor('boss', 'enemy', 20, 1000));
        sealPveDifficultyBand(s, { mode: 'MISSION', env: {} });
        const hero = s.actors.find(a => a.id === 'sq-0')!;
        assert.equal(hero.maxHp, 800, 'player HP untouched');
        assert.equal((hero.character.stats as Record<string, number>).ninjutsuOffense, 1000, 'player stats untouched');
    });

    it('is idempotent — a second call cannot compound the scaling', () => {
        // The failure this guards: 0.6 x 0.6 = 0.36 would turn a tuned fight trivial.
        const s = session(actor('boss', 'enemy', 20, 1000));
        assert.equal(sealPveDifficultyBand(s, { mode: 'MISSION', env: {} }), true);
        const afterFirst = { hp: s.actors[0].maxHp, off: enemyStats(s).ninjutsuOffense };
        assert.equal(sealPveDifficultyBand(s, { mode: 'MISSION', env: {} }), false, 'second call is a no-op');
        assert.equal(s.actors[0].maxHp, afterFirst.hp);
        assert.equal(enemyStats(s).ninjutsuOffense, afterFirst.off);
    });

    it('is idempotent per-actor even for a scale-only call that seals no guard', () => {
        // Scale-only modes leave no pveGuard to check, so the per-actor stamp is
        // the only thing standing between them and compounding.
        const s = session(actor('boss', 'enemy', 20, 1000));
        sealPveDifficultyBand(s, { mode: 'MISSION', sealGuard: false, env: {} });
        const off = enemyStats(s).ninjutsuOffense;
        assert.equal(s.pveGuard, undefined, 'fixture check: no guard was sealed');
        sealPveDifficultyBand(s, { mode: 'MISSION', sealGuard: false, env: {} });
        assert.equal(enemyStats(s).ninjutsuOffense, off, 'the per-actor stamp blocks the second scale');
    });

    it('guard-only mode seals the guard and leaves stats + HP alone', () => {
        // Towers / Spire / Clan Boss: already floor-, party- and ascension-scaled.
        const s = session(actor('boss', 'enemy', 20, 1000));
        assert.equal(sealPveDifficultyBand(s, { mode: 'TOWER', scaleHp: false, scaleStats: false, env: {} }), true);
        assert.equal(s.actors[0].maxHp, 1000, 'HP untouched');
        assert.equal(enemyStats(s).ninjutsuOffense, 1000, 'stats untouched');
        assert.equal(s.pveGuard?.enemyLevel, 20, 'but the hit guard IS armed');
    });

    it('clamps current HP down but never heals on re-seal', () => {
        const s = session(actor('boss', 'enemy', 20, 1000));
        s.actors[0].hp = 400; // already damaged, below the post-band ceiling of 750
        sealPveDifficultyBand(s, { mode: 'MISSION', env: {} });
        assert.equal(s.actors[0].hp, 400, 'a damaged enemy is not healed by the band');
        assert.equal(s.actors[0].maxHp, 750);
    });

    it('is a peer-band no-op on stats and HP, but still arms the guard', () => {
        const s = session(actor('boss', 'enemy', 95, 1000));
        sealPveDifficultyBand(s, { mode: 'MISSION', env: {} });
        assert.equal(s.actors[0].maxHp, 1000, 'peer HP multiplier is 1');
        assert.equal(enemyStats(s).ninjutsuOffense, 1000, 'peer stat multiplier is 1');
        assert.equal(s.pveGuard?.enemyLevel, 95);
    });

    describe('band level derivation', () => {
        it('prefers the boss actor', () => {
            const s = session(actor('add-1', 'enemy', 90, 100), actor('boss', 'enemy', 20, 100));
            assert.equal(pveBandLevelForSession(s), 20);
        });
        it('finds a tower/spire boss by phaseState.bossId, not the literal id "boss"', () => {
            // Only the SOLO encounter builders name the actor 'boss'. Tower,
            // Spire and clan-boss floors generate ids, so matching the string
            // alone would silently fall through to the max-scan and band a boss
            // floor on whichever mob happened to be highest.
            const s = session(actor('en-0', 'enemy', 40, 100), actor('en-1', 'enemy', 80, 9000));
            (s as unknown as { phaseState: { bossId: string } }).phaseState = { bossId: 'en-1' };
            assert.equal(pveBandLevelForSession(s), 80, 'bands on the boss');
            // ...and the boss is NOT merely the highest here:
            const s2 = session(actor('en-0', 'enemy', 90, 100), actor('en-1', 'enemy', 40, 9000));
            (s2 as unknown as { phaseState: { bossId: string } }).phaseState = { bossId: 'en-1' };
            assert.equal(pveBandLevelForSession(s2), 40, 'the boss wins over a higher-level add');
        });
        it('falls back to the highest enemy level when there is no boss', () => {
            const s = session(actor('add-1', 'enemy', 12, 100), actor('add-2', 'enemy', 44, 100));
            assert.equal(pveBandLevelForSession(s), 44);
        });
        it('an explicit enemyLevel wins over the board', () => {
            const s = session(actor('boss', 'enemy', 95, 1000));
            sealPveDifficultyBand(s, { mode: 'MISSION', enemyLevel: 20, env: {} });
            assert.equal(s.pveGuard?.enemyLevel, 20);
            assert.equal(s.actors[0].maxHp, 750, 'and the band follows the explicit level');
        });
    });

    describe('kill switches', () => {
        const MODES: PveBandMode[] = ['MISSION', 'STORY', 'AI_FIGHT', 'TOWER', 'CLAN_BOSS'];

        it('ships ON — an empty environment arms every mode', () => {
            // The load-bearing assertion for "nothing ships turned off": the
            // DEFAULT path is armed, and the env var is a rollback, not a gate.
            for (const mode of MODES) {
                assert.equal(pveDifficultyGuardEnabled(mode, {}), true, `${mode} must be ON by default`);
            }
        });

        it('the global switch disarms every mode', () => {
            for (const mode of MODES) {
                assert.equal(pveDifficultyGuardEnabled(mode, { DISABLE_PVE_DIFFICULTY_GUARD: '1' }), false, mode);
            }
            const s = session(actor('boss', 'enemy', 20, 1000));
            assert.equal(sealPveDifficultyBand(s, { mode: 'MISSION', env: { DISABLE_PVE_DIFFICULTY_GUARD: '1' } }), false);
            assert.equal(s.pveGuard, undefined, 'no guard');
            assert.equal(s.actors[0].maxHp, 1000, 'and no scaling');
        });

        it('a per-mode switch disarms only that mode', () => {
            const env = { DISABLE_PVE_DIFFICULTY_GUARD_TOWER: '1' };
            assert.equal(pveDifficultyGuardEnabled('TOWER', env), false);
            assert.equal(pveDifficultyGuardEnabled('MISSION', env), true, 'other modes stay armed');
        });

        it('only the exact value "1" disarms — a stray truthy string does not', () => {
            assert.equal(pveDifficultyGuardEnabled('MISSION', { DISABLE_PVE_DIFFICULTY_GUARD: 'true' }), true);
            assert.equal(pveDifficultyGuardEnabled('MISSION', { DISABLE_PVE_DIFFICULTY_GUARD: '0' }), true);
        });
    });
});

describe('the sealed guard survives the session store', () => {
    it('round-trips through writeSession/readSession intact', async () => {
        // Every test above works on an in-memory session, so none of them would
        // notice the store dropping the field. The guard is only useful if it is
        // still there on the NEXT request — the engine reads it per action, not
        // once at start.
        const s = session(actor('sq-0', 'squad', 20, 800), actor('boss', 'enemy', 20, 1000));
        (s as unknown as { runId: string }).runId = 'tower-band-roundtrip';
        sealPveDifficultyBand(s, { mode: 'MISSION', env: {} });
        assert.ok(s.pveGuard, 'fixture check: sealed before the write');

        const store = new Map<string, unknown>();
        const fakeKv = {
            get: async <T>(k: string) => (JSON.parse(JSON.stringify(store.get(k) ?? null)) as T),
            set: async (k: string, v: unknown) => { store.set(k, v); },
        };
        await writeSession(s, { kv: fakeKv as never });
        const back = await readSession('tower-band-roundtrip', { kv: fakeKv as never });
        assert.deepEqual(back?.pveGuard, s.pveGuard, 'pveGuard survived the round-trip');
        assert.equal(
            (back?.actors.find(a => a.id === 'boss')!.character.stats as Record<string, number>).ninjutsuOffense,
            600,
            'and so did the banded stats',
        );
    });
});

describe('step B wiring — every armed entry point still calls the seal', () => {
    // A source-level assertion, in the spirit of server-routes.test.ts: the
    // handlers need live KV + auth to exercise end to end, but silently DROPPING
    // the call is the regression that matters and this catches it.
    // Walk up to the repo root rather than using import.meta.dirname — this file
    // is also compiled into the CommonJS server build, where import.meta is a
    // hard TS error (TS1470).
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
    const EXPECT: Array<[string, string]> = [
        ['api/missions/combat-start.ts', "mode: 'MISSION'"],
        ['api/story/boss-start.ts', "mode: 'STORY'"],
        ['api/towers/start.ts', "mode: 'TOWER'"],
        ['api/clan-boss/assault-start.ts', "mode: 'CLAN_BOSS'"],
    ];

    for (const [file, marker] of EXPECT) {
        it(`${file} arms the layer`, () => {
            const src = readFileSync(join(root, file), 'utf8');
            assert.ok(src.includes('sealPveDifficultyBand'), `${file} no longer calls sealPveDifficultyBand`);
            assert.ok(src.includes(marker), `${file} no longer passes ${marker}`);
        });
    }

    it('towers and clan boss arm BEFORE the first AI turn is advanced', () => {
        // Both call startRound + runAiUntilHuman inline at start. Sealing after
        // that point would leave the opening enemy turn unguarded — a bug no
        // unit test on the helper could see.
        for (const file of ['api/towers/start.ts', 'api/clan-boss/assault-start.ts']) {
            const src = readFileSync(join(root, file), 'utf8');
            const seal = src.indexOf('sealPveDifficultyBand(session');
            const start = src.indexOf('startRound(session)');
            assert.ok(seal > 0 && start > 0, `${file}: fixture check — both calls present`);
            assert.ok(seal < start, `${file}: the seal must precede startRound`);
        }
    });

    it('the weekly boss and Anbu Vault stay deliberately unarmed', () => {
        // Documented in the _pve-band-seal.ts header. Weekly boss needs its own
        // (much tighter) weeklyBossGuardedHit port; Anbu's opponent is a real
        // player's sealed ANBU defender. If either is armed later, that is a
        // deliberate decision — update this test with it.
        for (const file of ['api/weekly-boss.ts', 'api/village/anbu-infiltration.ts']) {
            const src = readFileSync(join(root, file), 'utf8');
            assert.ok(!src.includes('sealPveDifficultyBand'), `${file} armed the standard band — see the _pve-band-seal.ts header`);
        }
    });
});
