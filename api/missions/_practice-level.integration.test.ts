import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'offline-practice-level-regression';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
let start: Handler;
let report: Handler;
function importedHandler(module: unknown): Handler {
    // tsx supplies the function directly; Node's CJS dynamic-import interop
    // exposes the transpiled module object under a second default export.
    const exported = (module as { default?: unknown }).default;
    const handler = typeof exported === 'function' ? exported : (exported as { default?: unknown })?.default;
    assert.equal(typeof handler, 'function', 'the imported API route must expose a callable handler');
    return handler as Handler;
}
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    start = importedHandler(await import('./ai-fight-start.js'));
    report = importedHandler(await import('./report-ai-fight.js'));
});

async function call(handler: typeof start, playerName: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName, ...body },
        headers: { 'x-player-token': issuePlayerToken(playerName) ?? '' }, socket: { remoteAddress: '127.7.1.1' } } as never, res as never);
    return out;
}

async function seed(name: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: 0, character: {
        name, level: 100, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        ryo: 456, xp: 0, specialty: 'Ninjutsu', rankTitle: 'Kage', stats: {}, inventory: [], itemStacks: [], equippedJutsuIds: [],
    }, creatorJutsus: [], savedBloodlines: [], acceptedMissionIds: [], missionProgress: {} });
}

test('Arena practice seals the selected level, resumes that exact session and settles once without rewards', async () => {
    for (const level of [1, 45, 100]) {
        const name = `practicechoice${level}`;
        await seed(name);
        const opened = await call(start, name, { battleKind: 'practice', opponentId: 'builtin-ai-central-champion', opponentLevel: 70, practiceLevel: level });
        assert.equal(opened.status, 200, JSON.stringify(opened.body));
        const session = opened.body.session as SoloPveSession;
        assert.equal(session.enemy.character.level, level);
        assert.equal(session.encounter.level, level);
        assert.equal(session.encounter.metadata?.spar, true);
        const token = await kv.get<Record<string, unknown>>(`ai-fight-token:${name}:${opened.body.token}`);
        assert.equal(token?.opponentLevel, level);

        const blocked = await call(start, name, { battleKind: 'practice', opponentId: 'builtin-ai-central-champion', practiceLevel: 20 });
        assert.equal(blocked.status, 409, 'a different selector cannot replace a live fight');
        const resumed = await call(start, name, { resumeAiFight: true, recoveryProbeVersion: 2 });
        assert.equal(resumed.status, 200);
        assert.equal(resumed.body.sessionId, opened.body.sessionId);
        assert.equal((resumed.body.session as SoloPveSession).enemy.character.level, level);

        // Shorten combat only in the isolated memory store, then use the real
        // engine to seal terminal usage evidence. Report receives no outcome.
        const { executeSoloPveAction } = await import('../solo-pve/_action-service.js');
        const ready = { ...session, activeSide: 'player' as const, ap: { ...session.ap, player: 100 },
            enemy: { ...session.enemy, hp: 1, pos: session.player.pos - 1 } };
        await kv.set(`solo-pve:${session.sessionId}`, ready);
        const action = await executeSoloPveAction({ sessionId: session.sessionId, ownerSlug: name,
            expectedVersion: session.version, moveToken: `practice-finish-${level}`, action: { type: 'basicAttack' } });
        assert.equal(action.status, 200, JSON.stringify(action.body));
        assert.equal(action.body.session?.outcome, 'win');
        const settled = await call(report, name, { aiFightToken: opened.body.token });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.outcome, 'win');
        assert.equal(settled.body.xp, 0);
        assert.equal(settled.body.ryo, 0);
        const after = await kv.get(`save:${name}`);
        const retry = await call(report, name, { aiFightToken: opened.body.token });
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        assert.equal(retry.body.xp, 0);
        assert.equal(retry.body.ryo, 0);
        assert.deepEqual(await kv.get(`save:${name}`), after, 'duplicate report cannot reward or mutate the save twice');
        assert.equal((await call(start, name, { resumeAiFight: true, recoveryProbeVersion: 2 })).status, 204, 'completed fight does not reopen after reload');
    }
});

test('an authored practice without a selector retains its level and ignores legacy opponentLevel', async () => {
    const name = 'practiceauthored'; await seed(name);
    const opened = await call(start, name, { battleKind: 'practice', opponentId: 'builtin-ai-central-champion', opponentLevel: 100 });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal((opened.body.session as SoloPveSession).enemy.character.level, 70);
});

test('a won exam bout records the exam AI so the Chunin and Jonin exams can pass; a re-levelled bout does not', async () => {
    const { passRankExam } = await import('../exams/_pass.js');
    const { executeSoloPveAction } = await import('../solo-pve/_action-service.js');
    async function winPractice(name: string, opponentId: string, practiceLevel?: number) {
        const opened = await call(start, name, { battleKind: 'practice', opponentId, ...(practiceLevel ? { practiceLevel } : {}) });
        assert.equal(opened.status, 200, JSON.stringify(opened.body));
        const session = opened.body.session as SoloPveSession;
        await kv.set(`solo-pve:${session.sessionId}`, { ...session, activeSide: 'player' as const, ap: { ...session.ap, player: 100 },
            enemy: { ...session.enemy, hp: 1, pos: session.player.pos - 1 } });
        const action = await executeSoloPveAction({ sessionId: session.sessionId, ownerSlug: name,
            expectedVersion: session.version, moveToken: `exam-${opponentId}-${practiceLevel ?? 0}`, action: { type: 'basicAttack' } });
        assert.equal(action.body.session?.outcome, 'win');
        const settled = await call(report, name, { aiFightToken: opened.body.token });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.xp, 0, 'an exam bout still pays nothing');
        assert.equal(settled.body.ryo, 0);
        return ((await kv.get<{ character: Record<string, unknown> }>(`save:${name}`))!.character);
    }

    const weakened = 'examweakened'; await seed(weakened);
    assert.deepEqual((await winPractice(weakened, 'builtin-ai-exam-proctor', 5)).defeatedAiIds ?? [], [], 'a proctor re-levelled to 5 is not the exam');

    const name = 'examcandidate'; await seed(name);
    const afterProctor = await winPractice(name, 'builtin-ai-exam-proctor');
    assert.deepEqual(afterProctor.defeatedAiIds, ['builtin-ai-exam-proctor']);
    assert.equal(afterProctor.ryo, 456, 'no purse');
    const chuninReady = { ...afterProctor, level: 39, examsPassed: ['genin'], elements: ['Fire', 'Water'], totalMissionsCompleted: 50, totalTilesExplored: 100, clan: 'Emberfall' };
    assert.equal(passRankExam(chuninReady, 'chunin').ok, true);

    const afterRogue = await winPractice(name, 'builtin-ai-rogue-ninja');
    assert.deepEqual(afterRogue.defeatedAiIds, ['builtin-ai-exam-proctor', 'builtin-ai-rogue-ninja']);

    const ordinary = 'examordinary'; await seed(ordinary);
    assert.deepEqual((await winPractice(ordinary, 'builtin-ai-central-champion')).defeatedAiIds ?? [], [], 'other practice opponents stay unrecorded');
});
