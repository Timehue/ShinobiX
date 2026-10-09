import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { makePveEngineTestSession } from '../towers/_pve-engine-test-fixture.js';
import {
    applyAiFightOutcomeToCharacter,
    sessionSeededVitals,
    settlementOwnsHpOnWin,
    vitalLostSinceSeal,
    type SeededVitals,
} from '../missions/_ai-fight-outcome.js';
import { applyPveOutcomeBodyOnce, applyPveOutcomeWithReceipt } from './_fight-outcome-settlement.js';

/*
 * The "delayed first settlement" free heal: the pure rules. Settlement wrote a
 * fight's surviving HP as an ABSOLUTE value, which is right only while the save
 * still holds what the fight was seeded from. A report held back past a fight
 * in another mode set HP back up to the held fight's end value. A fight seeded
 * from the save now seals what the save held (`seededVitals`: HP always, chakra
 * and stamina for a continuous fight), and settlement charges whatever the
 * save has lost since on top of what the fight left.
 * The handler-level journeys are in _delayed-settlement-journeys.test.ts.
 */

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number, maxHp = 600, chakra = 100, stamina = 100): PvpFighter {
    return {
        name, hp, maxHp, chakra, maxChakra: 300, stamina, maxStamina: 300,
        shield: 0, statuses: [], pos: 62,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

/** A finished fight seeded from a save that held `seeded`, which left the player on `end`. */
function sealedFight(seeded: SeededVitals | undefined, end: Partial<PvpFighter>, over: Partial<SoloPveSession> = {}): SoloPveSession {
    const session = createSoloPveSession({
        sessionId: 'delayed-solo',
        ownerSlug: 'alice',
        encounter: { kind: 'generic-ai', id: 'rival' },
        player: fighter('Alice', seeded?.hp ?? 600),
        enemy: fighter('Rival', 0),
        now: NOW,
        ...(seeded ? { seededVitals: seeded } : {}),
    });
    const done: SoloPveSession = { ...session, player: { ...session.player, ...end }, status: 'done', winner: 'player', outcome: 'win', ...over };
    return {
        ...done,
        terminalEvidence: {
            finishedAt: NOW, finalMoveToken: 'terminal', finalVersion: done.version, finalEventSeq: done.eventSeq,
            winner: done.winner ?? 'player', outcome: done.outcome ?? 'win', itemsUsed: {}, settlementState: 'pending',
        },
    };
}

/** The same fight sealed as a CONTINUOUS (open-world) encounter. */
function continuousFight(seeded: SeededVitals, end: Partial<PvpFighter>): SoloPveSession {
    const session = sealedFight(seeded, end);
    return { ...session, encounter: { ...session.encounter, metadata: { continuousVitals: true } } };
}

const save = (hp: unknown, maxHp = 600, chakra: unknown = 300, stamina: unknown = 300) =>
    ({ name: 'alice', hp, maxHp, chakra, maxChakra: 300, stamina, maxStamina: 300 });

describe('a fight seeded from the save seals what the save held', () => {
    const build = (character: Record<string, unknown>, opts: { continuous?: boolean; storedVitals?: Record<string, unknown> } = {}) => buildSoloPveAiEncounter({
        sessionId: 'delayed-built',
        playerName: 'alice',
        save: { character: { ...character, level: 10, stats: {}, jutsu: [], equipment: {} } },
        profile: { id: 'delayed-profile', name: 'Sparring Partner', level: 10, hp: 900, stats: {}, jutsu: [] },
        now: NOW,
        admin: null,
        difficultyMode: false,
        ...(opts.continuous ? { continuousVitals: true } : {}),
        ...(opts.storedVitals ? { storedVitals: opts.storedVitals } : {}),
    });

    it('seals HP for every fight it builds, and chakra and stamina only for a continuous one', () => {
        const fresh = build(save(437, 600, 120, 80));
        assert.equal(fresh.player.hp, 437);
        assert.deepEqual(fresh.seededVitals, { hp: 437 }, 'a fresh-start pool is not the save\'s and is never carried back');
        const open = build(save(437, 600, 120, 80), { continuous: true });
        assert.deepEqual(open.seededVitals, { hp: 437, chakra: 120, stamina: 80 });
        assert.deepEqual(sessionSeededVitals(open), { hp: 437, chakra: 120, stamina: 80 });
    });

    it('seals at full what a save with no readable value is seeded at', () => {
        assert.deepEqual(build(save(undefined, 600, undefined, undefined), { continuous: true }).seededVitals, { hp: 600, chakra: 300, stamina: 300 });
    });

    it('a caller that projected unwritten idle recovery seals what the save STORES', () => {
        // The fighter starts on the projected 460; the save still stores 400.
        const session = build(save(460, 600, 250, 250), { continuous: true, storedVitals: { hp: 400, chakra: 200, stamina: 'n/a' } });
        assert.equal(session.player.hp, 460, 'the fight keeps its projected start');
        assert.deepEqual(session.seededVitals, { hp: 400, chakra: 200, stamina: 250 }, 'an unreadable stored value falls back to the seeded one');
        assert.deepEqual(build(save(460), { storedVitals: { hp: 999 } }).seededVitals, { hp: 460 }, 'never above what the fighter was seeded with');
    });

    it('a session sealed without one (an older session, or a full-pool seat) has none', () => {
        assert.equal(sealedFight(undefined, { hp: 500 }).seededVitals, undefined);
        assert.equal('seededVitals' in sealedFight(undefined, { hp: 500 }), false, 'nothing is stamped that was not given');
        assert.equal(sessionSeededVitals(sealedFight(undefined, { hp: 500 })), undefined);
        const run = makePveEngineTestSession({ enemyLevel: 10, runId: 'delayed-tower', playerMaxHp: 600 });
        assert.equal(sessionSeededVitals(run), undefined, 'a Tower run seats a full pool');
        const ambush: TowerSession = { ...run, caravanAmbush: { runId: 'caravan-run', playerSlug: 'alice', nodeId: 'node-1', seededVitals: { hp: 410, chakra: 90, stamina: 70 } } };
        assert.deepEqual(sessionSeededVitals(ambush), { hp: 410, chakra: 90, stamina: 70 }, 'the caravan ambush re-seeds from the save and seals it');
    });
});

describe('vitalLostSinceSeal counts only what the save has LOST since the seal', () => {
    it('is the drop below the sealed value, per vital', () => {
        assert.equal(vitalLostSinceSeal(save(200), 'hp', { hp: 600 }), 400);
        assert.equal(vitalLostSinceSeal(save(600), 'hp', { hp: 600 }), 0);
        assert.equal(vitalLostSinceSeal(save(600, 600, 100), 'chakra', { hp: 600, chakra: 250 }), 150);
        assert.equal(vitalLostSinceSeal(save(600, 600, 300, 40), 'stamina', { stamina: 100 }), 60);
    });

    it('never counts a gain: idle recovery keeps running on the save during a Solo-PvE fight', () => {
        assert.equal(vitalLostSinceSeal(save(520), 'hp', { hp: 300 }), 0);
        assert.equal(vitalLostSinceSeal(save(600, 600, 290), 'chakra', { chakra: 120 }), 0);
    });

    it('is nothing for a vital that was not sealed', () => {
        assert.equal(vitalLostSinceSeal(save(10), 'hp', undefined), 0);
        assert.equal(vitalLostSinceSeal(save(600, 600, 5), 'chakra', { hp: 600 }), 0, 'a fresh-start fight seals no chakra');
    });

    it('does not mistake a pool that shrank since for a loss', () => {
        assert.equal(vitalLostSinceSeal(save(900, 900), 'hp', { hp: 1000 }), 0, 'gear taken off, nothing lost');
        assert.equal(vitalLostSinceSeal(save(700, 900), 'hp', { hp: 1000 }), 200);
    });

    it('reads a save with no readable value as full, as the seeding did', () => {
        assert.equal(vitalLostSinceSeal(save(undefined), 'hp', { hp: 600 }), 0);
        assert.equal(vitalLostSinceSeal(save('ninety'), 'hp', { hp: 600 }), 0);
        assert.equal(vitalLostSinceSeal(save(600, 600, undefined), 'chakra', { chakra: 300 }), 0);
    });
});

describe('applyAiFightOutcomeToCharacter charges what the save lost since the seal', () => {
    const actor = (hp: number, chakra = 100, stamina = 100) => fighter('Alice', hp, 600, chakra, stamina);

    it('a prompt settlement is unchanged: the save lost nothing, so it writes what the fight left', () => {
        assert.equal(applyAiFightOutcomeToCharacter(save(600), 'win', actor(550), NOW, false, false, false, { hp: 600 }).hp, 550);
        // Idle recovery accrued on the save while the fight ran is not credited.
        assert.equal(applyAiFightOutcomeToCharacter(save(420), 'win', actor(250), NOW, false, false, false, { hp: 300 }).hp, 250);
    });

    it('a late settlement cannot write HP back up over damage taken since', () => {
        // Seeded at 600, ended at 550; the save fell to 200 in another fight before the report.
        const late = applyAiFightOutcomeToCharacter(save(200), 'win', actor(550), NOW, false, false, false, { hp: 600 });
        assert.equal(late.hp, 150, '600 - 50 - 400, not the 550 the held fight ended on');
        assert.equal(late.hospitalized, undefined);
    });

    it('a fight that healed still credits its own heal on top of what is left', () => {
        // Seeded at 300, healed to 500 inside the fight; the save fell to 100 since.
        assert.equal(applyAiFightOutcomeToCharacter(save(100), 'win', actor(500), NOW, false, false, false, { hp: 300 }).hp, 300);
    });

    it('keeps a survivor on 1 HP and out of the hospital: only the fight\'s own 0 HP admits', () => {
        const floored = applyAiFightOutcomeToCharacter(save(50), 'win', actor(120), NOW, false, false, false, { hp: 600 });
        assert.equal(floored.hp, 1);
        assert.equal(floored.hospitalized, undefined);
        const down = applyAiFightOutcomeToCharacter(save(50), 'loss', actor(0), NOW, false, false, false, { hp: 600 });
        assert.equal(down.hp, 0);
        assert.equal(down.hospitalized, true, 'a knockout is admitted exactly as before');
    });

    it('a session sealed before the seed existed keeps the absolute write', () => {
        assert.equal(applyAiFightOutcomeToCharacter(save(200), 'win', actor(550), NOW).hp, 550);
    });

    it('leaves a spar, an unknown outcome and a full-pool run on their own rules', () => {
        assert.deepEqual(applyAiFightOutcomeToCharacter(save(200), 'win', actor(550), NOW, false, true, false, { hp: 600 }), save(200));
        assert.deepEqual(applyAiFightOutcomeToCharacter(save(200), 'unknown', actor(550), NOW, false, false, false, { hp: 600 }), save(200));
        assert.equal(applyAiFightOutcomeToCharacter(save(200), 'loss', actor(550), NOW, false, false, true).hp, 200);
    });

    it('a continuous fight settles chakra and stamina the same way', () => {
        const sealed = { hp: 600, chakra: 250, stamina: 200 };
        // Prompt: the bar is where the seal left it (or recovered); the fight's own cost lands.
        const prompt = applyAiFightOutcomeToCharacter(save(600, 600, 260, 200), 'win', actor(550, 180, 150), NOW, true, false, false, sealed);
        assert.deepEqual([prompt.chakra, prompt.stamina], [180, 150]);
        // Late: 150 chakra and 120 stamina were spent elsewhere since. A held
        // report used to waive the fight's own cost (min(100, 180) = 100).
        const late = applyAiFightOutcomeToCharacter(save(600, 600, 100, 80), 'win', actor(550, 180, 150), NOW, true, false, false, sealed);
        assert.deepEqual([late.chakra, late.stamina], [30, 30], '250 - 70 for the fight - 150 elsewhere; 200 - 50 - 120');
        // Never below empty, and still never above the bar as it stands.
        const drained = applyAiFightOutcomeToCharacter(save(600, 600, 10, 10), 'win', actor(550, 180, 150), NOW, true, false, false, sealed);
        assert.deepEqual([drained.chakra, drained.stamina], [0, 0]);
        const restored = applyAiFightOutcomeToCharacter(save(600, 600, 250, 200), 'win', actor(550, 290, 290), NOW, true, false, false, sealed);
        assert.deepEqual([restored.chakra, restored.stamina], [250, 200], 'decrease-only, as before');
    });

    it('a fresh-start fight never touches chakra or stamina, sealed or not', () => {
        const fresh = applyAiFightOutcomeToCharacter(save(600, 600, 100, 80), 'win', actor(550, 10, 10), NOW, false, false, false, { hp: 600 });
        assert.deepEqual([fresh.chakra, fresh.stamina], [100, 80]);
    });
});

describe('both settlement paths read the seal off the session', () => {
    it('the generic pve-outcome path charges what the save lost since', () => {
        const settled = applyPveOutcomeWithReceipt({
            character: save(200), session: sealedFight({ hp: 600 }, { hp: 550 }), playerName: 'alice', outcome: 'win', now: NOW,
        });
        assert.equal(settled.ok && settled.character.hp, 150);
    });

    it('so does a mode writing the body itself (applyPveOutcomeBodyOnce)', () => {
        const mode = applyPveOutcomeBodyOnce({ character: save(200), session: sealedFight({ hp: 600 }, { hp: 550 }), playerName: 'alice', now: NOW });
        assert.equal(mode.bodyWritten, true);
        assert.equal(mode.character.hp, 150);
    });

    it('and the caravan ambush, the Tower run seeded from the save', () => {
        const run = makePveEngineTestSession({ enemyLevel: 10, runId: 'delayed-ambush', playerMaxHp: 600 });
        run.actors[0] = { ...run.actors[0], ownerSlug: 'alice', hp: 500 };
        const ambush: TowerSession = { ...run, status: 'done', winner: 'squad', caravanAmbush: { runId: 'caravan-run', playerSlug: 'alice', nodeId: 'node-1', seededVitals: { hp: 600 } } };
        const mode = applyPveOutcomeBodyOnce({ character: save(250), session: ambush, playerName: 'alice', now: NOW, outcome: 'win', continuousVitals: true });
        assert.equal(mode.character.hp, 150, 'the ambush cost 100; the 350 lost since still counts');
    });

    it('the caravan escort keeps its potions\' recovery but not chakra spent elsewhere since', () => {
        const base = continuousFight({ hp: 600, chakra: 200, stamina: 200 }, { hp: 550, chakra: 260, stamina: 150 });
        const escort: SoloPveSession = { ...base, encounter: { ...base.encounter, kind: 'caravan', metadata: { continuousVitals: true } } };
        const prompt = applyPveOutcomeWithReceipt({ character: save(600, 600, 200, 200), session: escort, playerName: 'alice', outcome: 'win', now: NOW });
        assert.deepEqual(prompt.ok && [prompt.character.chakra, prompt.character.stamina], [260, 150], 'a potion drunk in the fight survives the trip back');
        const late = applyPveOutcomeWithReceipt({ character: save(600, 600, 120, 200), session: escort, playerName: 'alice', outcome: 'win', now: NOW });
        assert.equal(late.ok && late.character.chakra, 180, '260 less the 80 spent elsewhere since');
    });
});

describe('a fight\'s body is written at most once, so its delta is never charged twice', () => {
    it('a generic write after a mode\'s is a replay', () => {
        const session = sealedFight({ hp: 600 }, { hp: 550 });
        const first = applyPveOutcomeBodyOnce({ character: save(600), session, playerName: 'alice', now: NOW });
        assert.equal(first.character.hp, 550);
        const second = applyPveOutcomeWithReceipt({ character: first.character, session, playerName: 'alice', outcome: 'win', now: NOW + 1 });
        assert.equal(second.ok && second.value.replayed, true);
        assert.equal(second.ok && second.character.hp, 550, 'the fight\'s own cost is not charged again as "lost since"');
    });

    it('a mode\'s write after a generic one leaves HP, chakra and stamina where the generic path put them', () => {
        const session = continuousFight({ hp: 600, chakra: 250, stamina: 200 }, { hp: 550, chakra: 180, stamina: 150 });
        const generic = applyPveOutcomeWithReceipt({ character: save(600, 600, 250, 200), session, playerName: 'alice', outcome: 'win', now: NOW });
        assert.ok(generic.ok);
        if (!generic.ok) return;
        assert.deepEqual([generic.character.hp, generic.character.chakra, generic.character.stamina], [550, 180, 150]);
        const mode = applyPveOutcomeBodyOnce({ character: generic.character, session, playerName: 'alice', now: NOW + 1, continuousVitals: true });
        assert.equal(mode.bodyWritten, false);
        assert.deepEqual([mode.character.hp, mode.character.chakra, mode.character.stamina], [550, 180, 150],
            'charging chakra again would read the generic path\'s own charge as a loss since the seal');
    });

    it('but still charges the chakra and stamina of a Tower run the generic path did not see as continuous', () => {
        const run = makePveEngineTestSession({ enemyLevel: 10, runId: 'delayed-ambush-2', playerMaxHp: 600 });
        run.actors[0] = { ...run.actors[0], ownerSlug: 'alice', hp: 500, chakra: 150, stamina: 120 };
        const ambush: TowerSession = { ...run, status: 'done', winner: 'squad', caravanAmbush: { runId: 'caravan-run', playerSlug: 'alice', nodeId: 'node-1', seededVitals: { hp: 600, chakra: 250, stamina: 200 } } };
        const generic = applyPveOutcomeWithReceipt({ character: save(600, 600, 250, 200), session: ambush, playerName: 'alice', outcome: 'win', now: NOW });
        assert.ok(generic.ok);
        if (!generic.ok) return;
        assert.deepEqual([generic.character.hp, generic.character.chakra], [500, 250], 'the generic path charges a Tower run no chakra');
        const mode = applyPveOutcomeBodyOnce({ character: generic.character, session: ambush, playerName: 'alice', now: NOW + 1, outcome: 'win', continuousVitals: true });
        assert.deepEqual([mode.character.hp, mode.character.chakra, mode.character.stamina], [500, 150, 120]);
    });
});

describe('the story boss joins the shared receipt', () => {
    it('only the Academy spar still owns its winning HP; a won story boss is written like any fight', () => {
        const spar = sealedFight({ hp: 600 }, { hp: 550 }, { encounter: { kind: 'academy-spar', id: 'dummy' } });
        const boss = sealedFight({ hp: 600 }, { hp: 550 }, { encounter: { kind: 'story-boss', id: 'boss' } });
        assert.equal(settlementOwnsHpOnWin(spar), true);
        assert.equal(settlementOwnsHpOnWin(boss), false, 'its +25 is a reward, added once by the story settle on top of this body');
        const written = applyPveOutcomeWithReceipt({ character: save(600), session: boss, playerName: 'alice', outcome: 'win', now: NOW });
        assert.equal(written.ok && written.character.hp, 550);
    });
});
