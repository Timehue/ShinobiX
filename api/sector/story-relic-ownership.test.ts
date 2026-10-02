import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { STORY_RECKONINGS } from './_story-reckoning.js';
import { VILLAGE_RELICS } from '../../shared/relics.js';
import { VILLAGE_OUTSKIRTS } from '../../shared/sector-geo.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'story-relic-ownership-test-secret';

let handler: (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let advance: typeof import('../missions/_world-ai-fight.js').applyWorldAiDurableProgression;
const player = 'relicquestplayer';
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: issueToken } = await import('../_auth.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ applyWorldAiDurableProgression: advance } = await import('../missions/_world-ai-fight.js'));
    handler = (await import('./story-reckoning.js')).default as unknown as typeof handler;
});
beforeEach(async () => {
    const keys = await kv.keys(`*${player}*`);
    if (keys.length) await kv.del(...keys);
    online.remove(player);
});
after(() => online.remove(player));

async function post(questId: string, action: string) {
    const result = { status: 200, body: {} as Record<string, unknown> };
    const response = { setHeader() { return this; }, status(code: number) { result.status = code; return this; },
        json(body: Record<string, unknown>) { result.body = body; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { 'x-player-token': issueToken(player) },
        body: { playerName: player, questId, action }, socket: { remoteAddress: '127.5.6.8' } } as never, response as never);
    assert.equal(result.status, 200);
    return result.body;
}

for (const [village, itemId] of Object.entries(VILLAGE_RELICS)) {
    test(`${village}: a worn reward survives battle recovery, abandon/restart, turn-in and replay without a second copy`, async () => {
        const def = Object.values(STORY_RECKONINGS).find(entry => entry.dropItemId === itemId)!;
        const seal = { id: def.id, stage: 'task', baseline: 0, at: 1 };
        const sealVersion = `${def.id}:task:0:1`;
        const character = { name: player, level: 58, storyVillage: village, storyProgress: 5,
            storyTraits: [], ryo: 100, fateShards: 0, inventory: [], itemStacks: [], equipment: { relic: itemId }, totalAiKills: 1,
            worldAiContextWins: [{ kind: 'story-reckoning', sourceId: def.id, stage: 0, sealVersion, proofId: 'earned-win' }] };
        const record = { _saveVersion: 1, character, activeStoryReckoningSeal: seal };
        const battle = advance(record, character, {
            kind: 'story-reckoning', sourceId: def.id, stage: 0, sealVersion,
        } as WorldAiFightContext, 'win');
        assert.deepEqual(battle.character.inventory, [], 'automatic battle settlement must not mint another worn relic');
        assert.equal((battle.recordPatch?.activeStoryReckoningSeal as Record<string, unknown>).stage, 'return');

        // Exercise the recovery/report endpoint from the original sealed task too.
        await kv.set(`save:${player}`, record);
        online.upsert({ name: player, sector: VILLAGE_OUTSKIRTS[village], character: null });
        const reported = await post(def.id, 'report');
        assert.equal(reported.ok, true);
        assert.deepEqual((reported.character as Record<string, unknown>).inventory, []);
        // A player can leave before turn-in and restart while still wearing the
        // recovered keepsake. Finishing the new sealed task must not mint it again.
        const abandoned = await post(def.id, 'abandon');
        assert.equal(abandoned.ok, true);
        assert.equal((abandoned.character as Record<string, unknown>).ryo, 100);
        assert.equal((await post(def.id, 'accept')).ok, true);
        const resumed = (await kv.get(`save:${player}`)) as {
            character: Record<string, unknown>;
            activeStoryReckoningSeal: { id: string; stage: string; baseline: number; at: number };
        };
        const resumedSeal = resumed.activeStoryReckoningSeal;
        assert.equal(resumedSeal.stage, 'task');
        resumed.character.totalAiKills = resumedSeal.baseline + def.target;
        resumed.character.worldAiContextWins = [...resumed.character.worldAiContextWins as unknown[], {
            kind: 'story-reckoning', sourceId: def.id, stage: 0, proofId: 'earned-restart-win',
            sealVersion: `${def.id}:${resumedSeal.stage}:${resumedSeal.baseline}:${resumedSeal.at}`,
        }];
        await kv.set(`save:${player}`, resumed);
        const finishedAgain = await post(def.id, 'report');
        assert.equal(finishedAgain.ok, true);
        assert.deepEqual((finishedAgain.character as Record<string, unknown>).inventory, []);
        assert.deepEqual((finishedAgain.character as Record<string, unknown>).equipment, { relic: itemId });
        assert.equal((finishedAgain.character as Record<string, unknown>).ryo, 100);
        const claimed = await post(def.id, 'turn-in');
        assert.equal(claimed.ok, true, 'equipped relic is valid turn-in proof');
        const paid = claimed.character as Record<string, unknown>;
        assert.deepEqual(paid.equipment, { relic: itemId });
        assert.deepEqual(paid.inventory, []);
        assert.equal((paid.redeemedStoryReckonings as unknown[]).length, 1);
        const replay = await post(def.id, 'turn-in');
        assert.equal(replay.replayed, true);
        assert.equal((replay.character as Record<string, unknown>).ryo, paid.ryo);
        assert.equal((replay.character as Record<string, unknown>).fateShards, paid.fateShards);
        assert.deepEqual((replay.character as Record<string, unknown>).inventory, []);
        assert.equal((await post(def.id, 'accept')).reason, 'ineligible');
    });
}
