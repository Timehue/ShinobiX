import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    RIFT_QUESTS, RIFT_DAILY_CAP, RIFT_COOLDOWN_MS,
    isRiftQuestId, riftQuestRyo, riftBossKilled, riftTargetSector,
    parseRiftQuestSeal,
} from './_rift-quest.js';

type ClientChoice = { text: string; conclusion?: string; accept?: boolean; descend?: boolean };
type ClientPage = { title: string; scene: string; speaker: string; dialogue: string[]; choices?: ClientChoice[] };
type ClientRift = {
    id: string; slug: string; giverName: string; giverArchetype: string; levelReq: number;
    floors: number; theme: string; bossAiId: string; bossName: string;
    reward: { weight: number; fateShards?: number; boneCharms?: number };
    intro: ClientPage[]; descent: ClientPage[];
};

async function loadClientRifts(): Promise<ClientRift[]> {
    // COMPUTED specifier (via a variable) so tsc does not statically pull the
    // client module into the cpanel compile; tsx resolves it at runtime.
    const specifier = '../../shinobij.client/src/data/hollow-rifts.js';
    const mod = (await import(specifier)) as { hollowRifts: ClientRift[] };
    return mod.hollowRifts;
}
async function loadClientTargetSector(): Promise<(p: string, id: string) => number> {
    const specifier = '../../shinobij.client/src/lib/hollow-rifts.js';
    const mod = (await import(specifier)) as { riftTargetSector: (p: string, id: string) => number };
    return mod.riftTargetSector;
}

test('riftQuestRyo follows the wanderer-quest band', () => {
    assert.equal(riftQuestRyo(50, 8), 8 * 170);  // weight*(20+lvl*3)
    assert.equal(riftQuestRyo(1, 8), 8 * 23);
    assert.equal(riftQuestRyo(0, 8), 8 * 23);    // level floors at 1
});

test('riftBossKilled needs one foe-kill past the sealed baseline', () => {
    assert.equal(riftBossKilled(10, 11), true);
    assert.equal(riftBossKilled(10, 10), false);
    assert.equal(riftBossKilled(10, 9), false);
});

test('riftTargetSector is deterministic, wilderness-ranged, and skips villages', () => {
    const villages = new Set([11, 31, 38, 47]);
    for (const player of ['Aki', 'Rill', 'ZZZ', 'a', 'player-two']) {
        const s = riftTargetSector(player, 'rift-hollow-stalker');
        assert.equal(s, riftTargetSector(player, 'rift-hollow-stalker'), 'stable per call');
        assert.ok(s >= 1 && s <= 55, `${player}: ${s} in 1..55`);
        assert.ok(!villages.has(s), `${player}: ${s} not a village outskirts`);
    }
});

test('the daily cap + cooldown are sane', () => {
    assert.ok(Number.isInteger(RIFT_DAILY_CAP) && RIFT_DAILY_CAP > 0 && RIFT_DAILY_CAP <= 10);
    assert.ok(RIFT_COOLDOWN_MS > 0 && RIFT_COOLDOWN_MS <= 24 * 60 * 60 * 1000);
});

test('parseRiftQuestSeal round-trips a valid durable seal', () => {
    const seal = { id: 'rift-hollow-stalker', targetSector: 22, baseline: 7, at: 1_700_000_000_000 };
    assert.deepEqual(parseRiftQuestSeal(seal), seal);
    // `at` defaults to 0 when absent (older KV writes)
    assert.deepEqual(
        parseRiftQuestSeal({ id: 'rift-hollow-stalker', targetSector: 22, baseline: 7 }),
        { id: 'rift-hollow-stalker', targetSector: 22, baseline: 7, at: 0 },
    );
});

test('parseRiftQuestSeal rejects malformed / unknown seals', () => {
    assert.equal(parseRiftQuestSeal(null), null);
    assert.equal(parseRiftQuestSeal('x'), null);
    assert.equal(parseRiftQuestSeal([]), null);
    assert.equal(parseRiftQuestSeal({ id: 'not-a-rift', targetSector: 5, baseline: 1 }), null);
    assert.equal(parseRiftQuestSeal({ id: 'rift-hollow-stalker', targetSector: 0, baseline: 1 }), null);   // sector < 1
    assert.equal(parseRiftQuestSeal({ id: 'rift-hollow-stalker', targetSector: 61, baseline: 1 }), null);  // sector > 60
    assert.equal(parseRiftQuestSeal({ id: 'rift-hollow-stalker', targetSector: 5, baseline: NaN }), null);
    assert.equal(parseRiftQuestSeal({ id: 'rift-hollow-stalker', targetSector: 5, baseline: 1, at: -1 }), null);
});

test('client rifts and the server catalog agree exactly', async () => {
    const rifts = await loadClientRifts();
    assert.ok(rifts.length >= 1);
    const clientIds = new Set<string>();
    for (const rift of rifts) {
        clientIds.add(rift.id);
        assert.match(rift.id, /^rift-[a-z-]+$/, rift.id);
        const def = RIFT_QUESTS[rift.id];
        assert.ok(def, `server def missing for ${rift.id}`);
        assert.equal(def.levelReq, rift.levelReq, rift.id);
        assert.equal(def.floors, rift.floors, rift.id);
        assert.equal(def.bossAiId, rift.bossAiId, rift.id);
        assert.equal(def.bossName, rift.bossName, rift.id);
        assert.equal(def.weight, rift.reward.weight, rift.id);
        assert.equal(def.fateShards, rift.reward.fateShards ?? 0, rift.id);
        assert.equal(def.boneCharms, rift.reward.boneCharms ?? 0, rift.id);
        assert.ok(isRiftQuestId(rift.id));
        assert.ok(rift.floors >= 1 && rift.floors <= 3, `${rift.id}: 1-3 floors`);
        assert.match(rift.bossAiId, /^rift-boss-[a-z-]+$/, `${rift.id}: boss id shape`);
    }
    assert.deepEqual(Object.keys(RIFT_QUESTS).sort(), [...clientIds].sort(), 'catalog has extra/missing ids');
});

test('server and client compute the SAME target sector (seal == display)', async () => {
    const clientTarget = await loadClientTargetSector();
    for (const [player, id] of [['Aki', 'rift-hollow-stalker'], ['Rill', 'rift-hollow-stalker']] as const) {
        assert.equal(riftTargetSector(player, id), clientTarget(player, id), `${player}/${id}`);
    }
});

test('rift VN is well-formed: intro has an accept option, descent has a descend option', async () => {
    const rifts = await loadClientRifts();
    for (const rift of rifts) {
        assert.ok(rift.intro.length >= 1 && rift.descent.length >= 1, `${rift.id}`);
        for (const page of [...rift.intro, ...rift.descent]) assert.ok(page.dialogue.length >= 1, `${rift.id} page dialogue`);
        assert.equal((rift.intro[rift.intro.length - 1].choices ?? []).filter((c) => c.accept).length, 1, `${rift.id}: one accept`);
        assert.equal((rift.descent[rift.descent.length - 1].choices ?? []).filter((c) => c.descend).length, 1, `${rift.id}: one descend`);
    }
});
