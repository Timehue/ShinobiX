import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let wb: Pick<typeof import('./weekly-boss.js'), 'weeklyBossNewlyBroken' | 'announceWeeklyBossBroken'>;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    wb = await import('./weekly-boss.js');
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('the breaking blow is detected only on the >0 -> 0 pool transition, never on a replay', () => {
    const alive = { hpMax: 1_000, damageByPlayer: { a: 400 } };
    const broken = { hpMax: 1_000, damageByPlayer: { a: 400, b: 600 } };
    const deeper = { hpMax: 1_000, damageByPlayer: { a: 400, b: 600, c: 50 } };
    assert.equal(wb.weeklyBossNewlyBroken(alive, broken), true);
    assert.equal(wb.weeklyBossNewlyBroken(alive, alive), false);
    assert.equal(wb.weeklyBossNewlyBroken(broken, deeper), false, 'already-broken boss never re-breaks');
    assert.equal(wb.weeklyBossNewlyBroken(alive, broken, true), false, 'a replayed receipt moved nothing');
});

test('the Weekly Boss Broken herald posts exactly once per spawn', async () => {
    const now = 1_900_000_000_000;
    const boss = { weekKey: '2026-W34', aiId: 'ashen-dragon', bossName: 'Ashen Dragon', startedAt: now - 3_600_000, expiresAt: now + 10 * 3_600_000 };
    await wb.announceWeeklyBossBroken(boss, 'breaker', now);
    await wb.announceWeeklyBossBroken(boss, 'breaker', now + 5_000);

    const feed = (await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? [];
    const posts = feed.filter((a) => a.type === 'weekly_boss_broken');
    assert.equal(posts.length, 1, JSON.stringify(feed));
    assert.equal(posts[0].importance, 'high');
    assert.equal(posts[0].title, 'The Weekly Boss Is Broken');
    assert.equal(posts[0].message, 'breaker dealt the breaking blow to Ashen Dragon — it still roams, staggered, until it despawns in about 10h.');
    assert.equal(posts[0].receiptId, `weekly-boss-broken:2026-W34:${boss.startedAt}`);
    const chat = (await kv.get<Array<Record<string, unknown>>>('chat:village:moonshadow-village')) ?? [];
    assert.equal(chat.filter((m) => m.receiptId === posts[0].receiptId).length, 1);

    // An admin respawn in the same week is a new spawn identity -> heralds again.
    await wb.announceWeeklyBossBroken({ ...boss, startedAt: now }, 'breaker', now);
    const again = ((await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? []).filter((a) => a.type === 'weekly_boss_broken');
    assert.equal(again.length, 2);
});
