import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    AI_FIGHT_FLOOR_ID,
    aiFightFloor,
    buildAiFightEncounter,
    loadAiFightProfile,
    type AiFightProfile,
} from './_ai-fight-encounter.js';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { pveAiMasteryForLevel, pveDifficultyHpMultiplier, pveDifficultyStatMultiplier } from '../_pve-difficulty.js';
import { relevelAiProfile } from '../_ai-level-curves.js';

/*
 * Step 2 of the generic AI-fight migration (docs/runbooks/combat-mode-migration.md):
 * ai-fight-start seals a real encounter instead of only minting a reward token.
 *
 * The contract these pin: the sealed fight is the SAME fight the player was
 * shown — the authored opponent, at its authored power, with its own kit — and
 * it is WINNABLE. A server fight that is secretly harder (no pet, generic kit)
 * or secretly easier (client-chosen level) would make the migration a
 * regression, not a fix.
 */

const profile = AI_PROFILE_CATALOG['builtin-ai-ember-duelist'] as unknown as AiFightProfile;

function makeSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        character: {
            name: 'Rill',
            level: 30,
            specialty: 'Ninjutsu',
            maxHp: 3000,
            hp: 3000,
            stats: {
                strength: 300, speed: 300, intelligence: 400, willpower: 350,
                ninjutsuOffense: 800, ninjutsuDefense: 600,
                taijutsuOffense: 200, taijutsuDefense: 200,
                bukijutsuOffense: 200, bukijutsuDefense: 200,
                genjutsuOffense: 200, genjutsuDefense: 200,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
            ...overrides,
        },
        savedBloodlines: [],
        creatorJutsus: [],
    };
}

const base = {
    playerName: 'Rill',
    runId: 'aifight-test-1',
    seed: 4242,
    now: 1_770_000_000_000,
};

describe('loadAiFightProfile', () => {
    it('resolves a built-in AI from the generated mirror', async () => {
        const found = await loadAiFightProfile('builtin-ai-ember-duelist');
        assert.ok(found, 'built-in AI must resolve');
        assert.equal(found.id, 'builtin-ai-ember-duelist');
        assert.equal(found.name, 'Ember Duelist');
    });

    it('rejects malformed ids without a storage lookup', async () => {
        for (const bad of ['', '   ', 'has spaces', 'bad/slash', null, 42, {}]) {
            assert.equal(await loadAiFightProfile(bad), null, `should reject ${JSON.stringify(bad)}`);
        }
    });
});

describe('aiFightFloor', () => {
    it('is a defeat-boss floor on the neutral biome', () => {
        const floor = aiFightFloor(profile);
        assert.equal(floor.id, AI_FIGHT_FLOOR_ID);
        assert.equal(floor.objective, 'defeat-boss', 'an AI fight is won by defeating the opponent');
        // A biome grants the +10% school-vs-terrain buff. The local Arena fight
        // this replaces has no server-known terrain, so sealing one would hand
        // out an unearned advantage to whichever side matched it.
        assert.equal(floor.biome, 'central');
        assert.equal(floor.boss?.aiId, profile.id);
    });
});

describe('buildAiFightEncounter', () => {
    it('seals the authored opponent — its HP, name and level, not a score-attack boss', () => {
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        const boss = session.actors.find((a) => a.id === 'boss');
        assert.ok(boss, 'the encounter must contain a boss actor');
        assert.equal(boss.name, profile.name);
        // Authored HP, then the PvE band multiplier for the encounter's level
        // (Arena.tsx:691 does the same). Composed explicitly rather than
        // loosened to an inequality, so a change to EITHER factor still fails.
        assert.equal(
            boss.maxHp,
            Math.max(1, Math.floor(Number(profile.hp) * pveDifficultyHpMultiplier(Number(profile.level)))),
            'authored HP scaled by the encounter band',
        );
        assert.ok(boss.maxHp < 1_000_000, 'a generic AI fight is winnable, not a 99M-HP score attack');
        assert.equal(boss.character?.level, profile.level);
    });

    it('gives the opponent its OWN resolved kit, not a generic signature', () => {
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        const boss = session.actors.find((a) => a.id === 'boss');
        const jutsu = (boss?.character?.jutsu ?? []) as Array<{ id: string }>;
        assert.deepEqual(jutsu.map((j) => j.id), profile.jutsuIds as string[]);
        assert.ok(!jutsu.some((j) => j.id.endsWith('-signature')), 'must not fall back to the generic signature');
    });

    it('puts the real player in the squad and tags the run as an AI fight', () => {
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        assert.equal(session.towerId, 'ai-fight');
        assert.equal(session.runId, base.runId);
        const human = session.actors.find((a) => a.side === 'squad');
        assert.ok(human, 'the player must be on the board');
        assert.equal(human.name, 'Rill');
    });

    it('is deterministic for the same seed (a re-seal reproduces the fight)', () => {
        const a = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        const b = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    });

    it('seals the active pet so the server fight is not harder than the local one', () => {
        const withPet = makeSave({
            activePetId: 'pet-1',
            pets: [{ id: 'pet-1', name: 'Kuro', level: 20, rarity: 'rare', element: 'Fire', trait: 'Balanced', hp: 400, attack: 60, defense: 40, speed: 50 }],
        });
        const session = buildAiFightEncounter({ ...base, save: withPet, profile });
        assert.ok(session.pendingCompanion, 'the active pet must be sealed for the summon action');
        const without = buildAiFightEncounter({ ...base, save: makeSave(), profile });
        assert.ok(!without.pendingCompanion, 'no pet, no companion seal');
    });

    it('REBUILDS the opponent when scaled — stats and HP move with the level', () => {
        const bossAt = (scaling?: { level: number; statBonus?: number; hpFloor?: number }) => {
            const s = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling });
            return s.actors.find((a) => a.id === 'boss')!;
        };
        const authored = bossAt();
        const scaled = bossAt({ level: 60 });
        assert.equal(scaled.character?.level, 60);
        // The bug this guards: stamping a bare level would leave the level-18
        // profile's stats and HP untouched, so a "level 60" foe would fight like
        // a level 18 one — a secretly easier fight than the client shows.
        assert.ok(
            scaled.maxHp > authored.maxHp,
            `HP must scale up with the level (authored ${authored.maxHp} → scaled ${scaled.maxHp})`,
        );
        const authoredStats = authored.character?.stats as Record<string, number>;
        const scaledStats = scaled.character?.stats as Record<string, number>;
        assert.ok(
            scaledStats.ninjutsuOffense > authoredStats.ninjutsuOffense,
            'stats must be redistributed on the higher level budget',
        );
    });

    it('applies the stat bonus and the HP floor, and clamps the level', () => {
        const bossAt = (scaling: { level: number; statBonus?: number; hpFloor?: number }) => {
            const s = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling });
            return s.actors.find((a) => a.id === 'boss')!;
        };
        const plain = bossAt({ level: 30 });
        const bonused = bossAt({ level: 30, statBonus: 55 });
        const plainStats = plain.character?.stats as Record<string, number>;
        const bonusedStats = bonused.character?.stats as Record<string, number>;
        // The rank bonus is applied by the re-level, THEN the band multiplier
        // scales the whole block — so the observed lift is the bonus times the
        // band factor. Asserted as that exact composition (not just "bigger"),
        // so dropping either step still fails.
        assert.equal(
            bonusedStats.strength - plainStats.strength,
            Math.round(55 * pveDifficultyStatMultiplier(30)),
            'the rank bonus lifts every stat, scaled by the encounter band',
        );
        assert.ok(bonusedStats.strength > plainStats.strength, 'and it is a lift, not a cut');
        // The floor only binds below the natural curve — that is the client's rule.
        // ORDER MATTERS: the re-level applies the floor, THEN the band scales the
        // result — same order as the client (relevelBuiltinAi floors, then
        // Arena.tsx:692 multiplies by enemyHpDifficultyFactor). So the effective
        // pool is the floor times the band factor, not the raw floor.
        assert.equal(
            bossAt({ level: 2, hpFloor: 1400 }).maxHp,
            Math.max(1, Math.floor(1400 * pveDifficultyHpMultiplier(2))),
            'the HP floor binds before the band multiplier',
        );
        assert.ok(bossAt({ level: 2, hpFloor: 1400 }).maxHp > bossAt({ level: 2 }).maxHp, 'and the floor still lifts a low-level foe');
        assert.equal(
            bossAt({ level: 60, hpFloor: 1400 }).maxHp,
            bossAt({ level: 60 }).maxHp,
            'above the curve the floor is a no-op',
        );
        for (const [level, expected] of [[0, 1], [-5, 1], [999, 100]] as const) {
            assert.equal(bossAt({ level }).character?.level, expected, `level ${level} must clamp`);
        }
    });

    it('does not mutate the shared catalog profile when scaling', () => {
        const before = JSON.stringify(profile);
        buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 77, statBonus: 90, hpFloor: 9000 } });
        assert.equal(JSON.stringify(profile), before, 'the generated catalog entry must stay pristine');
    });

    // ── PvE difficulty band wiring (step 3b) ────────────────────────────────
    it('seals the AI jutsu mastery — without it the opponent casts at 30% damage', () => {
        // api/pvp/move.ts applyJutsu reads the CASTER's character.jutsuMastery.
        // No server enemy template carries one, so an unsealed AI casts at
        // mastery 0 → masteryDamageFrac(0) = 0.3. This is the single biggest
        // faithfulness gap in the migrated fight.
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 60 } });
        const boss = session.actors.find((a) => a.id === 'boss')!;
        const mastery = boss.character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        assert.ok(Array.isArray(mastery) && mastery.length > 0, 'the AI must carry a mastery entry per jutsu');
        assert.equal(mastery.length, (boss.character.jutsu as unknown[]).length, 'one entry per sealed jutsu');
        assert.equal(mastery[0].level, pveAiMasteryForLevel(60));
        assert.ok(mastery.every((m) => m.jutsuId), 'no blank jutsu ids');
        // The rank cap still binds: a low-level AI cannot cast at full mastery.
        const low = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 5 } });
        const lowMastery = low.actors.find((a) => a.id === 'boss')!.character.jutsuMastery as Array<{ level: number }>;
        assert.equal(lowMastery[0].level, pveAiMasteryForLevel(5));
        assert.ok(lowMastery[0].level < mastery[0].level, 'mastery must rise with the AI level');
    });

    it('applies the PvE band HP and stat multipliers', () => {
        // Sub-peer bands soak fewer hits and fight with scaled stats
        // (Arena.tsx:691/:695). Peer ramps through 91-99 and reaches full strength at 100.
        const easy = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 20 } });
        const easyBoss = easy.actors.find((a) => a.id === 'boss')!;
        const rebuilt = relevelAiProfile(profile as never, 20, 0, 0, []);
        assert.equal(
            easyBoss.maxHp,
            Math.max(1, Math.floor(rebuilt.hp * pveDifficultyHpMultiplier(20))),
            'easy-band HP must be multiplied down',
        );
        assert.ok(pveDifficultyHpMultiplier(20) < 1, 'fixture check: the easy band is a nerf');

        const peer = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 100 } });
        const peerRebuilt = relevelAiProfile(profile as never, 100, 0, 0, []);
        assert.equal(
            peer.actors.find((a) => a.id === 'boss')!.maxHp,
            peerRebuilt.hp,
            'the max-level peer keeps its full HP pool',
        );
    });

    it('arms the standard-PvE hit guard with the SEALED opponent level', () => {
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile, scaling: { level: 12 } });
        assert.deepEqual(session.pveGuard, { enemyLevel: 12, turnStartHp: {}, dealtThisTurn: {} });
        // Presence is the gate for the engine clamp; the level must come from
        // the sealed opponent, never from anything the client can move.
        assert.equal(session.pveGuard?.enemyLevel, session.actors.find((a) => a.id === 'boss')?.character?.level);
    });

    it('still builds a fighting opponent from a profile with no resolvable jutsu', () => {
        const broken = { ...profile, jutsuIds: ['not-a-real-jutsu'] } as AiFightProfile;
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile: broken });
        const jutsu = (session.actors.find((a) => a.id === 'boss')?.character?.jutsu ?? []) as Array<{ id: string }>;
        assert.ok(jutsu.length > 0, 'a fallback signature keeps the opponent able to act');
    });
});
