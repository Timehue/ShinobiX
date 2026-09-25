process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'spar-never-hospitalizes-test-secret-32b';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { applyAiFightOutcomeToCharacter, sessionIsSpar } from './_ai-fight-outcome.js';
import { applyPveOutcomeWithReceipt } from '../pve/_fight-outcome-settlement.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';

/*
 * Owner rule, 2026-09-24: "when your HP hits 0 you go to the hospital unless it's
 * a spar or ranked match".
 *
 * Ranked and player-vs-player spars already honoured it: both fight on a fresh
 * pool and write nothing back (api/pvp/_vitals-settlement.ts). The AI side did
 * not. A practice bout — the Arena spar, the Dojo Circuit, a Logbook exam — and
 * the Academy spar all settled through the same function as a real fight, so a
 * knockout in one put the player in a hospital bed.
 *
 * A spar now writes no physical consequence at all. Not just "no hospital":
 * no damage either, so that losing a spar never costs less than winning it.
 */

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number, maxHp = 600): PvpFighter {
    return {
        name, hp, maxHp,
        chakra: 40, maxChakra: 300, stamina: 40, maxStamina: 300,
        shield: 0, statuses: [], pos: 62,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function session(encounter: SoloPveSession['encounter'], playerHp: number, winner: 'player' | 'enemy'): SoloPveSession {
    const base = createSoloPveSession({
        sessionId: `spar-${encounter.kind}-${playerHp}`,
        ownerSlug: 'akira',
        encounter,
        player: fighter('akira', playerHp),
        enemy: fighter('Dummy', winner === 'player' ? 0 : 200),
        now: NOW,
    });
    return {
        ...base,
        status: 'done',
        winner,
        outcome: winner === 'player' ? 'win' : 'loss',
        terminalEvidence: {
            finishedAt: NOW,
            finalMoveToken: 'terminal',
            finalVersion: base.version,
            finalEventSeq: base.eventSeq,
            winner,
            outcome: winner === 'player' ? 'win' : 'loss',
            itemsUsed: {},
            settlementState: 'pending',
        },
    };
}

const healthy = (): Record<string, unknown> => ({ name: 'akira', hp: 450, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300 });

describe('sessionIsSpar — read from the sealed session', () => {
    it('recognises the Academy spar by its encounter kind', () => {
        assert.equal(sessionIsSpar(session({ kind: 'academy-spar', id: 'academy-spar-dummy' }, 0, 'enemy')), true);
    });

    it('recognises a practice bout by the flag ai-fight-start seals on it', () => {
        assert.equal(sessionIsSpar(session({ kind: 'generic-ai', id: 'x', metadata: { spar: true } }, 0, 'enemy')), true);
    });

    it('never mistakes a real fight for a spar', () => {
        assert.equal(sessionIsSpar(session({ kind: 'generic-ai', id: 'x' }, 0, 'enemy')), false, 'an explore ambush / hunt shares the generic-ai kind');
        assert.equal(sessionIsSpar(session({ kind: 'generic-ai', id: 'x', metadata: { continuousVitals: true } }, 0, 'enemy')), false);
        assert.equal(sessionIsSpar(session({ kind: 'mission', id: 'combat-e-drill' }, 0, 'enemy')), false);
        assert.equal(sessionIsSpar(session({ kind: 'story-boss', id: 'Stormveil Village:0' }, 0, 'enemy')), false);
        assert.equal(sessionIsSpar(session({ kind: 'generic-ai', id: 'x', metadata: { spar: 'yes' } as never }, 0, 'enemy')), false, 'strict === true');
        assert.equal(sessionIsSpar(null), false);
    });
});

describe('applyAiFightOutcomeToCharacter — a spar writes nothing', () => {
    it('a knockout in a spar neither hospitalizes nor zeroes HP', () => {
        const before = healthy();
        const after = applyAiFightOutcomeToCharacter({ ...before }, 'loss', fighter('akira', 0), NOW, false, true);
        assert.deepEqual(after, before);
        assert.notEqual(after.hospitalized, true);
    });

    it('winning a spar does not cost HP either, so losing is never the cheaper result', () => {
        const before = healthy();
        const won = applyAiFightOutcomeToCharacter({ ...before }, 'win', fighter('akira', 90), NOW, false, true);
        assert.equal(won.hp, before.hp);
    });

    it('walking out of a spar costs nothing physical (the loss still counts where losses are recorded)', () => {
        const before = healthy();
        assert.deepEqual(applyAiFightOutcomeToCharacter({ ...before }, 'forfeit', fighter('akira', 10), NOW, false, true), before);
    });

    it('a real fight still sends a knocked-out player to the hospital', () => {
        const after = applyAiFightOutcomeToCharacter(healthy(), 'loss', fighter('akira', 0), NOW);
        assert.equal(after.hospitalized, true);
        assert.equal(after.hp, 0);
        assert.equal(after.hospitalizedUntil, NOW + 60_000);
    });
});

describe('the PvE outcome settlement (Academy spar, lapse reconciler)', () => {
    it('settles a lost Academy spar with a receipt but no hospital stay', () => {
        const lost = session({ kind: 'academy-spar', id: 'academy-spar-dummy', bindingId: 'spar-run' }, 0, 'enemy');
        const applied = applyPveOutcomeWithReceipt({ character: healthy(), session: lost, playerName: 'akira', outcome: 'loss', now: NOW });
        assert.equal(applied.ok, true);
        if (!applied.ok) return;
        assert.notEqual(applied.character.hospitalized, true, 'a beginner who loses the spar steps back onto the mat');
        assert.equal(applied.character.hp, 450, 'and keeps the HP they walked in with');
        assert.ok(Array.isArray(applied.character.serverSettlementReceipts), 'the outcome is still settled exactly once');
    });

    it('settles a lapsed practice bout without a physical consequence', () => {
        const lapsed = session({ kind: 'generic-ai', id: 'builtin-ai-exam-proctor', metadata: { spar: true } }, 0, 'enemy');
        const applied = applyPveOutcomeWithReceipt({ character: healthy(), session: lapsed, playerName: 'akira', outcome: 'loss', now: NOW });
        assert.equal(applied.ok, true);
        if (!applied.ok) return;
        assert.notEqual(applied.character.hospitalized, true);
        assert.equal(applied.character.hp, 450);
    });

    it('still hospitalizes a lost story boss — a story fight is not a spar', () => {
        const lost = session({ kind: 'story-boss', id: 'Stormveil Village:0', bindingId: 'boss-run' }, 0, 'enemy');
        const applied = applyPveOutcomeWithReceipt({ character: healthy(), session: lost, playerName: 'akira', outcome: 'loss', now: NOW });
        assert.equal(applied.ok, true);
        if (!applied.ok) return;
        assert.equal(applied.character.hospitalized, true);
    });
});

describe('buildSoloPveAiEncounter — the spar flag rides on the encounter', () => {
    const save = { character: { name: 'akira', level: 20, hp: 450, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, stats: {}, jutsu: [], equipment: {} } };
    const profile = { id: 'spar-profile', name: 'Sparring Partner', level: 20, hp: 900, stats: {}, jutsu: [] };

    it('stamps spar without disturbing any other encounter field', () => {
        const plain = buildSoloPveAiEncounter({ sessionId: 's1', playerName: 'akira', save, profile, now: NOW, admin: null, difficultyMode: false });
        const spar = buildSoloPveAiEncounter({ sessionId: 's1', playerName: 'akira', save, profile, now: NOW, admin: null, difficultyMode: false, spar: true });
        assert.equal(plain.encounter.metadata, undefined, 'a plain encounter keeps its old shape');
        assert.deepEqual(spar.encounter, { ...plain.encounter, metadata: { spar: true } });
    });

    it('merges with continuity and with a caller-supplied metadata record', () => {
        const both = buildSoloPveAiEncounter({
            sessionId: 's2', playerName: 'akira', save, profile, now: NOW, admin: null, difficultyMode: false,
            continuousVitals: true, spar: true,
            encounter: { kind: 'world-ai', id: 'wanderer', metadata: { sector: 12 } },
        });
        assert.deepEqual(both.encounter.metadata, { sector: 12, continuousVitals: true, spar: true });
    });
});

describe('a real practice bout through ai-fight-start and report-ai-fight', { concurrency: false }, () => {
    type Handler = (req: never, res: never) => Promise<unknown>;
    let kv: typeof import('../_storage.js').kv;
    let start: Handler;
    let report: Handler;
    let token = '';
    let ipSeed = 0;

    async function call(handler: Handler, body: Record<string, unknown>) {
        const out: { status: number; body: Record<string, any> } = { status: 200, body: {} };
        const res = {
            setHeader() { return res; },
            status(code: number) { out.status = code; return res; },
            json(value: Record<string, any>) { out.body = value; return res; },
            end() { return res; },
        };
        const ip = `10.74.0.${++ipSeed}`;
        await handler({
            method: 'POST', body, query: {},
            headers: { 'content-type': 'application/json', 'x-player-name': 'akira', 'x-player-token': token, 'x-forwarded-for': ip },
            socket: { remoteAddress: ip },
        } as never, res as never);
        return out;
    }

    before(async () => {
        ({ kv } = await import('../_storage.js'));
        token = (await import('../_auth.js')).issuePlayerToken('akira')!;
        start = (await import('./ai-fight-start.js')).default as unknown as Handler;
        report = (await import('./report-ai-fight.js')).default as unknown as Handler;
    });

    beforeEach(async () => {
        for (const key of await kv.keys('*')) await kv.del(key);
        await kv.set('save:akira', {
            _saveVersion: 1, currentSector: 1, savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
            character: {
                name: 'akira', village: 'Stormveil Village', level: 25, specialty: 'Ninjutsu', rankTitle: 'Genin',
                hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
                inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
                stats: { strength: 100, speed: 100, intelligence: 140, willpower: 120, ninjutsuOffense: 300, ninjutsuDefense: 250, taijutsuOffense: 100, taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
            },
        });
    });

    it('seals the bout as a spar, and a knockout in it leaves the player out of the hospital', async () => {
        const started = await call(start, { playerName: 'akira', battleKind: 'practice', opponentId: 'builtin-ai-exam-proctor', opponentLevel: 25 });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
        const sealed = await readSoloPveSession(started.body.sessionId);
        assert.ok(sealed);
        assert.equal(sealed.encounter.metadata?.spar, true, 'ai-fight-start seals the practice bout as a spar');

        // The server's own terminal result: the player was knocked out.
        await writeSoloPveSession({
            ...sealed, status: 'done', winner: 'enemy', outcome: 'loss', settlementState: 'pending', version: sealed.version + 1,
            player: { ...sealed.player, hp: 0 },
            terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'spar-terminal', finalVersion: sealed.version + 1, finalEventSeq: sealed.eventSeq, winner: 'enemy', outcome: 'loss', itemsUsed: {}, settlementState: 'pending' },
        });
        const settled = await call(report, { playerName: 'akira', aiFightToken: started.body.token });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));

        const saved = await kv.get<{ character: Record<string, unknown> }>('save:akira');
        assert.notEqual(saved?.character.hospitalized, true, 'a spar knockout does not admit the player');
        assert.equal(saved?.character.hp, 600, 'and costs no HP');
        assert.equal(saved?.character.ryo, 500, 'a spar still pays nothing');
    });
});
