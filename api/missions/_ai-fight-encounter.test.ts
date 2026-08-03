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
        assert.equal(boss.maxHp, profile.hp, 'the opponent fights at its authored HP');
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
        assert.equal(bonusedStats.strength, plainStats.strength + 55, 'the rank bonus lifts every stat');
        // The floor only binds below the natural curve — that is the client's rule.
        assert.ok(bossAt({ level: 2, hpFloor: 1400 }).maxHp >= 1400, 'a low-level foe is floored, not one-tappable');
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

    it('still builds a fighting opponent from a profile with no resolvable jutsu', () => {
        const broken = { ...profile, jutsuIds: ['not-a-real-jutsu'] } as AiFightProfile;
        const session = buildAiFightEncounter({ ...base, save: makeSave(), profile: broken });
        const jutsu = (session.actors.find((a) => a.id === 'boss')?.character?.jutsu ?? []) as Array<{ id: string }>;
        assert.ok(jutsu.length > 0, 'a fallback signature keeps the opponent able to act');
    });
});
