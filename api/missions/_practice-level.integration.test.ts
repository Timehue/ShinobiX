import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'offline-practice-level-regression';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let start: typeof import('./ai-fight-start.js').default;
let report: typeof import('./report-ai-fight.js').default;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    start = (await import('./ai-fight-start.js')).default;
    report = (await import('./report-ai-fight.js')).default;
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
