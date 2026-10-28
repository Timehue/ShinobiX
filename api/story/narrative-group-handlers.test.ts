import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { groupFinisher } from '../../scripts/narrative-group-fixtures.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'narrative-group-handler-test-secret';

test('authored groups finish through original routes and pay/progress exactly once', async t => {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const { writeSoloPveSession } = await import('../solo-pve/_store.js');
    const { STORY_REWARDS } = await import('./_settle.js');
    type Handler = (req: never, res: never) => Promise<unknown>;
    const storyStart = (await import('./boss-start.js')).default as unknown as Handler;
    const action = (await import('../solo-pve/action.js')).default as unknown as Handler;
    const settle = (await import('./settle.js')).default as unknown as Handler;
    const aiStart = (await import('../missions/ai-fight-start.js')).default as unknown as Handler;
    const aiReport = (await import('../missions/report-ai-fight.js')).default as unknown as Handler;
    const quest = (await import('../sector/questbook.js')).default as unknown as Handler;
    async function call(handler: Handler, name: string, body: Record<string, unknown>) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(value: Record<string, unknown>) { out.body = value; return this; }, end() { return this; } };
        await handler({ method: 'POST', body: { playerName: name, ...body }, headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '198.51.100.92' } } as never, res as never);
        return out;
    }
    function character(name: string, village: string, progress: number) {
        return { name, village, level: 65, storyProgress: progress, specialty: 'Ninjutsu', hp: 10000, maxHp: 10000,
            chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
            stats: { ninjutsuOffense: 2200, ninjutsuDefense: 2200, taijutsuDefense: 2200, bukijutsuDefense: 2200, genjutsuDefense: 2200 },
            jutsu: [], inventory: [], equipment: {}, pets: [], ryo: 100, unspentStats: 0, starterCardsClaimed: true, tileCards: [] };
    }
    let seq = 0;
    async function finish(name: string, initial: SoloPveSession, onFirst: () => Promise<void>) {
        let s = initial;
        const ids = s.huntCombat!.requiredEnemyIds!;
        for (const [i, id] of ids.entries()) {
            // Controlled last hits keep lifecycle testing independent of balance.
            s.huntCombat!.battle.actors[0].hp = s.huntCombat!.battle.actors[0].maxHp;
            s.huntCombat!.battle.actors[0].character.jutsu = [groupFinisher];
            if (i) {
                await writeSoloPveSession(s);
                const wait = await call(action, name, { sessionId: s.sessionId, expectedVersion: s.version, moveToken: `group-wait-${++seq}`, type: 'huntAction', action: { type: 'wait' } });
                assert.equal(wait.status, 200, JSON.stringify(wait.body)); s = wait.body.session as SoloPveSession;
            }
            // The enemy turn may add shields or smoke. Set up the controlled
            // last hit afterwards; this test owns settlement, not AI balance.
            const target = s.huntCombat!.battle.actors.find(a => a.id === id)!;
            target.hp = 1; target.shield = 0; target.statuses = [];
            await writeSoloPveSession(s);
            const hit = await call(action, name, { sessionId: s.sessionId, expectedVersion: s.version, moveToken: `group-hit-${++seq}`, type: 'huntAction', action: { type: 'jutsu', jutsuId: groupFinisher.id, targetId: id } });
            assert.equal(hit.status, 200, JSON.stringify(hit.body)); assert.equal(hit.body.applied, true, JSON.stringify(hit.body));
            s = hit.body.session as SoloPveSession;
            if (!i) { assert.equal(s.status, 'active'); await onFirst(); }
        }
        assert.equal(s.status, 'done'); assert.equal(s.winner, 'player');
        const late = await call(action, name, { sessionId: s.sessionId, expectedVersion: s.version, moveToken: `group-late-${++seq}`, type: 'huntAction', action: { type: 'wait' } });
        assert.equal(late.body.applied, false);
        return s;
    }
    for (const [village, progress, count] of [['Stormveil Village', 5, 9], ['Ashen Leaf Village', 5, 3], ['Frostfang Village', 3, 13], ['Frostfang Village', 5, 3]] as const) await t.test(`${village} chapter ${progress}`, async () => {
        const name = `group${village.split(' ')[0].toLowerCase()}${progress}`;
        await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: 1, character: character(name, village, progress) });
        const begun = await call(storyStart, name, {});
        assert.equal(begun.status, 200, JSON.stringify(begun.body));
        const s = begun.body.session as SoloPveSession;
        assert.equal(s.huntCombat!.requiredEnemyIds!.length, count);
        await finish(name, s, async () => assert.equal((await call(settle, name, { kind: 'storyBoss', runId: s.sessionId })).status, 409));
        const paid = await call(settle, name, { kind: 'storyBoss', runId: s.sessionId });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        const ch = paid.body.character as Record<string, unknown>;
        assert.equal(ch.storyProgress, progress + 1); assert.equal(ch.ryo, 100 + STORY_REWARDS[progress].ryo);
        const replay = await call(settle, name, { kind: 'storyBoss', runId: s.sessionId });
        assert.equal(replay.body.replayed, true); assert.equal((replay.body.character as Record<string, unknown>).ryo, ch.ryo);
        assert.ok(Number(ch.hp) > 0);
    });
    for (const [questId, stage] of [['qb-defector', 1], ['qb-debt', 1], ['qb-ashes', 0]] as const) await t.test(`${questId}: whole group required before durable quest advancement`, async () => {
        const name = `group${questId.replace('qb-', '')}`;
        await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: 1, character: character(name, 'Stormveil Village', 0), activeQuestbookSeal: { id: questId, stage, baseline: 0, at: Date.now() } });
        const begun = await call(aiStart, name, { worldEncounter: { kind: 'questbook-boss', sourceId: questId, sector: 1 } });
        assert.equal(begun.status, 200, JSON.stringify(begun.body));
        const s = begun.body.session as SoloPveSession;
        assert.equal(s.huntCombat!.requiredEnemyIds!.length, 3);
        await finish(name, s, async () => {
            assert.equal((await call(aiReport, name, { aiFightToken: begun.body.token })).status, 409);
            assert.equal((await kv.get<{ activeQuestbookSeal: { stage: number } }>(`save:${name}`))!.activeQuestbookSeal.stage, stage);
        });
        const paid = await call(aiReport, name, { aiFightToken: begun.body.token });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        const saved = await kv.get<{ activeQuestbookSeal: { stage: number } }>(`save:${name}`);
        // Final stages stay on their seal until Claim; intermediate stages advance.
        assert.equal(saved!.activeQuestbookSeal.stage, questId === 'qb-ashes' ? stage + 1 : stage);
        await call(aiReport, name, { aiFightToken: begun.body.token });
        assert.deepEqual(await kv.get(`save:${name}`), saved);
        if (questId !== 'qb-ashes') {
            const claimed = await call(quest, name, { action: 'claim' });
            assert.equal(claimed.body.ok, true, JSON.stringify(claimed.body));
            assert.equal((await kv.get<{ activeQuestbookSeal: unknown }>(`save:${name}`))!.activeQuestbookSeal, null);
        }
    });
    await t.test('Goro: three real two-enemy waves, durable proof, no duplicate payout, next stage unlocked', async () => {
        const name = 'groupcaravan';
        await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: 1, character: character(name, 'Stormveil Village', 0), activeQuestbookSeal: { id: 'qb-caravan', stage: 1, baseline: 0, at: Date.now() } });
        const runs = new Set<string>();
        for (let wave = 1; wave <= 3; wave++) {
            const begun = await call(aiStart, name, { worldEncounter: { kind: 'questbook-boss', sourceId: 'qb-caravan', sector: 1 } });
            assert.equal(begun.status, 200, JSON.stringify(begun.body));
            const s = begun.body.session as SoloPveSession;
            assert.equal(s.huntCombat!.groupId, ['goro-vanguard', 'goro-flank', 'goro-command'][wave - 1]);
            assert.equal(s.huntCombat!.requiredEnemyIds!.length, 2);
            assert.ok(!runs.has(s.sessionId)); runs.add(s.sessionId);
            const token = begun.body.token;
            assert.ok(token);
            await finish(name, s, async () => assert.equal((await call(aiReport, name, { aiFightToken: token })).status, 409));
            const paid = await call(aiReport, name, { aiFightToken: token });
            assert.equal(paid.status, 200, JSON.stringify(paid.body));
            const before = await kv.get(`save:${name}`);
            await call(aiReport, name, { aiFightToken: token });
            assert.deepEqual(await kv.get(`save:${name}`), before, 'a report replay neither pays nor advances the wave twice');
        }
        const saved = await kv.get<{ activeQuestbookSeal: { stage: number } }>(`save:${name}`);
        assert.equal(saved!.activeQuestbookSeal.stage, 2, 'the original durable quest advances only after all three waves');
    });
});
