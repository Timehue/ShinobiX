import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexNeighbors } from '../combat-core/grid.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { LIBERATOR_TITLES, STORY_LEVELS, STORY_REWARDS } from './_settle.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'late-story-handler-audit-test-secret';

// The balance matrices exercise the production engine without HTTP/storage.
// Prove that the real entry/retry routes seal those same opponents, and that
// every late solo boss exits through the durable reward/progression handler.
test('all four villages deliver the audited level 65/75/85/100 fights through the real handlers', async t => {
    // Idle recovery also settles against Date.now(). Pin it so replay checks
    // cannot cross a regeneration tick on a busy full-suite worker.
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    // Offline audit entry points use the scripts' module context. Keep them
    // outside the server's NodeNext compilation graph, as with client adapters.
    const fixture65Module = '../../scripts/story-65-balance-audit.js';
    const fixtureLateModule = '../../scripts/story-late-balance-audit.js';
    const { story65Save, story65Session } = await import(fixture65Module);
    const { lateStorySave, lateStorySession, LATE_STORY_VILLAGES } = await import(fixtureLateModule);
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    type Handler = (req: never, res: never) => Promise<unknown>;
    const start = (await import('./boss-start.js')).default as unknown as Handler;
    const action = (await import('../solo-pve/action.js')).default as unknown as Handler;
    const settle = (await import('./settle.js')).default as unknown as Handler;
    async function call(handler: Handler, name: string, body: Record<string, unknown>) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; },
            json(value: Record<string, unknown>) { out.body = value; return this; }, end() { return this; } };
        await handler({ method: 'POST', body: { playerName: name, ...body },
            headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '198.51.100.93' } } as never, res as never);
        return out;
    }
    function assertOpponent(actual: SoloPveSession, expected: SoloPveSession) {
        assert.equal(actual.encounter.kind, 'story-boss');
        assert.equal(actual.encounter.sourceId, expected.encounter.sourceId);
        assert.equal(actual.encounter.id, expected.encounter.id);
        assert.equal(actual.encounter.bindingId, actual.sessionId);
        assert.equal(actual.environment.biome, expected.environment.biome);
        assert.equal(actual.enemy.maxHp, expected.enemy.maxHp, 'no additional Tower/ordinary-AI HP multiplier');
        assert.equal(actual.enemy.maxChakra, expected.enemy.maxChakra);
        assert.equal(actual.enemy.maxStamina, expected.enemy.maxStamina);
        assert.deepEqual(actual.enemy.character, expected.enemy.character, 'stats, art, kit, costs, mastery and AI policy match the audited encounter');
        assert.equal(actual.huntCombat?.purpose, expected.huntCombat?.purpose);
        if (expected.huntCombat) {
            const roster = (session: SoloPveSession) => session.huntCombat!.battle.actors.filter(actor => actor.side === 'enemy')
                .map(actor => ({ id: actor.id, name: actor.name, maxHp: actor.maxHp, ai: actor.ai, character: actor.character }));
            assert.deepEqual(roster(actual), roster(expected), 'each group member keeps its own audited stats, health and abilities');
            assert.deepEqual(actual.huntCombat!.requiredEnemyIds, expected.huntCombat.requiredEnemyIds);
        }
    }
    for (const village of LATE_STORY_VILLAGES) for (const level of [65, 75, 85, 100] as const) {
        await t.test(`${village} level ${level}`, async () => {
            const name = `late${village.split(' ')[0].toLowerCase()}${level}`;
            const progress = STORY_LEVELS.indexOf(level);
            const save = level === 65 ? story65Save('Ninjutsu', false) : lateStorySave(level, 'Ninjutsu', false);
            Object.assign(save.character, { name, village, storyProgress: progress, ryo: 100 });
            save.currentSector = 0;
            await kv.set(`save:${name}`, { ...save, _saveVersion: 1 });
            const expected = level === 65 ? await story65Session(village, 'Ninjutsu', false)
                : lateStorySession(village, level, 'Ninjutsu', false);
            // Client-supplied opponent/budget/progress must never replace the save's milestone.
            const begun = await call(start, name, { level: 4, progressIndex: 0, village: 'fake', hp: 1, opponentId: 'dummy' });
            assert.equal(begun.status, 200, JSON.stringify(begun.body));
            const initial = begun.body.session as SoloPveSession;
            assertOpponent(initial, expected);
            assert.deepEqual(await readSoloPveSession(initial.sessionId), initial, 'the response and durable combat record agree');
            assert.equal((await call(settle, name, { kind: 'storyBoss', runId: initial.sessionId, won: true })).status, 409);

            const lossBody = { sessionId: initial.sessionId, expectedVersion: initial.version, moveToken: `late-loss-${level}`,
                type: 'abandon' };
            const lost = await call(action, name, lossBody);
            assert.equal(lost.status, 200, JSON.stringify(lost.body));
            const terminal = lost.body.session as SoloPveSession;
            assert.equal(terminal.status, 'done');
            assert.equal(terminal.winner, 'enemy');
            const afterLoss = await kv.get<{ character: Record<string, unknown> }>(`save:${name}`);
            assert.equal(afterLoss!.character.storyProgress, progress);
            assert.equal(afterLoss!.character.ryo, 100);
            assert.equal(afterLoss!.character.hp, terminal.player.hp, 'the real action handler writes the physical loss');
            await call(action, name, lossBody);
            assert.deepEqual(await kv.get(`save:${name}`), afterLoss, 'replaying the loss charges nothing twice');
            assert.equal((await call(settle, name, { kind: 'storyBoss', runId: initial.sessionId })).status, 409);

            const retried = await call(start, name, {});
            assert.equal(retried.status, 200, JSON.stringify(retried.body));
            const retry = retried.body.session as SoloPveSession;
            assert.notEqual(retry.sessionId, initial.sessionId);
            assertOpponent(retry, expected);
            assert.equal(retry.player.hp, terminal.player.hp, 'retry starts with the saved health, not fresh health');
            // Separate group-handler tests kill every member and reject early
            // claims. Here their 65 start/retry budgets are checked unchanged.
            if (retry.huntCombat) return;

            // A controlled last hit isolates API completion from balance. The
            // unchanged balance matrices already test full-health opponents.
            retry.enemy.hp = 1;
            retry.enemy.pos = hexNeighbors(retry.player.pos).find(pos => !retry.environment.blockedTiles.includes(pos))!;
            assert.ok(Number.isFinite(retry.enemy.pos));
            await writeSoloPveSession(retry);
            const won = await call(action, name, { sessionId: retry.sessionId, expectedVersion: retry.version,
                moveToken: `late-win-${level}`, type: 'basicAttack' });
            assert.equal(won.status, 200, JSON.stringify(won.body));
            assert.equal((won.body.session as SoloPveSession).winner, 'player');
            const paid = await call(settle, name, { kind: 'storyBoss', runId: retry.sessionId });
            assert.equal(paid.status, 200, JSON.stringify(paid.body));
            const awarded = paid.body.character as Record<string, unknown>;
            assert.equal(awarded.storyProgress, progress + 1);
            assert.equal(awarded.ryo, 100 + STORY_REWARDS[progress].ryo);
            assert.ok(Number(awarded.hp) > 0);
            assert.equal((await readSoloPveSession(retry.sessionId))!.settlementState, 'settled');
            if (level === 100) {
                assert.equal(awarded.storyTitle, LIBERATOR_TITLES[village]);
                assert.ok((awarded.inventory as string[]).includes('hollow-gate-key'));
                assert.equal(paid.body.finale, true);
            }
            const paidSave = await kv.get(`save:${name}`);
            const replay = await call(settle, name, { kind: 'storyBoss', runId: retry.sessionId });
            assert.equal(replay.status, 200, JSON.stringify(replay.body));
            assert.equal(replay.body.replayed, true);
            assert.deepEqual(await kv.get(`save:${name}`), paidSave, 'retries cannot duplicate any reward or progression');
            if (level === 100) assert.equal((await call(start, name, {})).status, 409, 'completed finales cannot reopen');
            else {
                const next = await call(start, name, {});
                assert.equal(next.status, 403, 'the next chapter stays locked until its level requirement');
                assert.match(String(next.body.error), /level/i);
            }
        });
    }
});
