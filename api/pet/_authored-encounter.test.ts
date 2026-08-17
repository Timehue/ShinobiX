/*
 * Authored pet encounters — the opponent is the SERVER's, always.
 *
 * These two encounters (the relic-dungeon Rare Beast Seal, an admin-authored VN
 * pet battle) are the reason the legacy client duel sim outlived every other
 * entry: porting them meant inventing a Showdown entry that fights an opponent
 * the arena did not choose, and the lazy version of that takes stats over the
 * wire. This file pins the version that does not.
 *
 * What is worth guarding here:
 *  - the dungeon beast is a function of (player, run token) — stable across
 *    retries, so a reload cannot reroll a softer boss;
 *  - seal 3 stays behind seal 1, which used to be enforced only by the dungeon
 *    screen's own stage machine;
 *  - an authored encounter is FOUND, not built from the request — an unknown
 *    event, an event with no pet battle, or a petId naming no species all come
 *    back empty rather than inventing an opponent;
 *  - the difficulty ladder is the client's original, so the port moves the
 *    ENGINE and nothing else.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    authoredDifficultyMultiplier,
    buildAuthoredEventBeast,
    buildDungeonSealBeast,
    cleanAuthoredDifficulty,
    dungeonSealRunIssue,
    findAuthoredPetBattle,
} from './_authored-encounter.js';
import { PET_CATALOG } from './_catalog.js';
import type { AdminEvent } from '../_admin-event-catalog.js';

const RUN = 'run-token-abcdefgh';

const activeRun = (over: Record<string, unknown> = {}) => ({
    activeDungeonRun: { token: RUN, startedAt: 1, entry: 'key', wardenDefeated: true, ...over },
});

const eventWith = (battles: Record<string, unknown>[]): AdminEvent => ({
    id: 'relic-of-ash',
    vnPages: [{ choices: battles.map((battle) => ({ text: 'Fight', nextPage: 1, battle })) }],
});

describe('dungeon Rare Beast Seal', () => {
    it('derives one beast per run, and the same one on every retry', () => {
        const first = buildDungeonSealBeast('Tester', RUN);
        const again = buildDungeonSealBeast('Tester', RUN);
        assert.ok(first, 'the catalog must yield a rare-or-better beast');
        assert.deepEqual(first, again, 'a retry must not reroll the boss');
        // A different run is a different fight; a different player likewise.
        const otherRun = buildDungeonSealBeast('Tester', 'run-token-zyxwvuts');
        const otherPlayer = buildDungeonSealBeast('Someone', RUN);
        assert.ok(first!.templateId !== otherRun!.templateId || first!.templateId !== otherPlayer!.templateId,
            'the pick must vary with the run token / player, not be a constant');
    });

    it('applies the client boost verbatim, so only the engine changed', () => {
        const beast = buildDungeonSealBeast('Tester', RUN)!;
        const base = PET_CATALOG[beast.templateId!];
        assert.ok(base, 'the beast must name a real catalog species');
        assert.equal(beast.rarity, 'rare', 'the seal forces rare, as the screen did');
        assert.equal(beast.level, Math.max(55, Math.floor(Number(base.level) || 1) + 25));
        assert.equal(beast.hp, Math.max(900, Math.floor(Number(base.hp) * 2.1)));
        assert.equal(beast.attack, Math.max(110, Math.floor(Number(base.attack) * 1.9)));
        assert.equal(beast.defense, Math.max(100, Math.floor(Number(base.defense) * 1.8)));
        assert.equal(beast.speed, Math.max(90, Math.floor(Number(base.speed) * 1.6)));
        assert.ok(beast.jutsus.length > 0, 'and it brings the species kit');
        assert.ok(beast.jutsus.every((j) => j.currentCooldown === 0), 'with a clean cooldown slate');
    });

    it('is gated on the caller\'s own active run, past its Warden', () => {
        assert.equal(dungeonSealRunIssue(activeRun(), RUN), null);
        assert.match(String(dungeonSealRunIssue({}, RUN)), /active dungeon run/i);
        assert.match(String(dungeonSealRunIssue(activeRun(), 'run-token-someoneelse')), /active dungeon run/i);
        assert.match(String(dungeonSealRunIssue(activeRun({ wardenDefeated: false }), RUN)), /Warden/);
        // A junk / absent token is rejected before anything is looked up.
        assert.match(String(dungeonSealRunIssue(activeRun(), 'short')), /run token is required/i);
        assert.match(String(dungeonSealRunIssue(activeRun(), undefined)), /run token is required/i);
    });
});

describe('admin-authored VN pet encounters', () => {
    const known = Object.keys(PET_CATALOG)[0];

    it('finds the authored row the caller names, and nothing else', () => {
        const event = eventWith([
            { encounterType: 'pet', petId: known, difficulty: 'hard', bossName: 'Ashen Maw' },
            { encounterType: 'ai', aiProfileId: 'someone' },
        ]);
        const found = findAuthoredPetBattle(event, known, 'hard');
        assert.deepEqual(found, { petId: known, difficulty: 'hard', bossName: 'Ashen Maw' });

        assert.equal(findAuthoredPetBattle(undefined, known, 'hard'), null, 'an unknown event has no encounter');
        assert.equal(findAuthoredPetBattle(eventWith([{ encounterType: 'ai' }]), known, 'hard'), null,
            'an event with no pet battle has no encounter');
        assert.equal(findAuthoredPetBattle(event, 'not-a-species', 'hard'), null,
            'a petId the event never authored has no encounter');
    });

    it('falls back to the same petId when the difficulty does not line up', () => {
        // The selector identifies WHICH authored fight; a difficulty that drifted
        // (an admin edited the row while the player was reading the scene) still
        // resolves to the authored fight rather than dropping the player out of
        // the encounter — and it resolves to the AUTHORED difficulty, not the
        // requested one.
        const event = eventWith([{ encounterType: 'pet', petId: known, difficulty: 'impossible' }]);
        assert.equal(findAuthoredPetBattle(event, known, 'easy')?.difficulty, 'impossible');
    });

    it('scales off the catalog species with the client difficulty ladder', () => {
        assert.equal(authoredDifficultyMultiplier('easy'), 0.75);
        assert.equal(authoredDifficultyMultiplier('normal'), 1);
        assert.equal(authoredDifficultyMultiplier('hard'), 1.35);
        assert.equal(authoredDifficultyMultiplier('impossible'), 2.1);
        assert.equal(authoredDifficultyMultiplier(undefined), 1);

        const base = PET_CATALOG[known];
        const boss = buildAuthoredEventBeast({ petId: known, difficulty: 'hard', bossName: 'Ashen Maw' })!;
        assert.equal(boss.name, 'Ashen Maw', 'the authored name wins');
        assert.equal(boss.hp, Math.max(1, Math.round(Number(base.hp) * 1.35)));
        assert.equal(boss.attack, Math.max(1, Math.round(Number(base.attack) * 1.35)));
        // Speed is capped at 1.5x so no tier can permanently out-tempo the player.
        const wild = buildAuthoredEventBeast({ petId: known, difficulty: 'impossible' })!;
        assert.equal(wild.speed, Math.max(1, Math.round(Number(base.speed) * 1.5)));
        assert.ok(wild.level <= 100, 'and the level stays inside the game\'s ceiling');
    });

    it('never invents a species the catalog does not have', () => {
        assert.equal(buildAuthoredEventBeast({ petId: 'no-such-pet', difficulty: 'normal' }), null);
    });

    it('rejects a difficulty that is not one of the authored four', () => {
        assert.equal(cleanAuthoredDifficulty('nightmare'), undefined);
        assert.equal(cleanAuthoredDifficulty(7), undefined);
        assert.equal(cleanAuthoredDifficulty('hard'), 'hard');
    });
});
