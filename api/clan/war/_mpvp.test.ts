import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import type { ClanChallenge, ClanWar } from './_storage.js';

type Kv = typeof import('../../_storage.js').kv;

let kv: Kv;
let startClanWar2v2Match: typeof import('./_mpvp.js').startClanWar2v2Match;
let clanWar2v2Sides: typeof import('./_mpvp.js').clanWar2v2Sides;
let readClanWar2v2Match: typeof import('./_mpvp.js').readClanWar2v2Match;
let settleClanWar2v2Match: typeof import('./_mpvp-settlement.js').settleClanWar2v2Match;
let clanWar2v2Result: typeof import('./_mpvp-settlement.js').clanWar2v2Result;
let clanWar2v2ItemsUsed: typeof import('./_mpvp-consumables.js').clanWar2v2ItemsUsed;
let settleClanWar2v2Consumables: typeof import('./_mpvp-consumables.js').settleClanWar2v2Consumables;

const WAR_ID = 'alpha__beta';
const CHALLENGE_ID = 'cw-2v2-test';
const FROM = ['ash', 'briar'] as const;
const TO = ['cinder', 'dune'] as const;
const ALL = [...FROM, ...TO];

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ startClanWar2v2Match, clanWar2v2Sides, readClanWar2v2Match } = await import('./_mpvp.js'));
    ({ settleClanWar2v2Match, clanWar2v2Result } = await import('./_mpvp-settlement.js'));
    ({ clanWar2v2ItemsUsed, settleClanWar2v2Consumables } = await import('./_mpvp-consumables.js'));
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

function challenge(overrides: Partial<ClanChallenge> = {}): ClanChallenge {
    return {
        id: CHALLENGE_ID,
        mode: 'pvp2v2',
        fromClan: 'alpha',
        fromPlayer: FROM[0],
        fromPlayer2: FROM[1],
        acceptedPlayer: TO[0],
        acceptedPlayer2: TO[1],
        status: 'accepted',
        createdAt: 1,
        expiresAt: Date.now() + 3_600_000,
        ...overrides,
    } as ClanChallenge;
}

function war(overrides: Partial<ClanWar> = {}): ClanWar {
    return {
        id: WAR_ID,
        clans: ['alpha', 'beta'],
        villages: { alpha: 'moonshadow', beta: 'stormveil' },
        hp: { alpha: 1000, beta: 1000 },
        startedAt: 1,
        updatedAt: 1,
        declaredBy: FROM[0],
        pendingChallenges: [challenge()],
        completedChallenges: [],
        ...overrides,
    } as ClanWar;
}

async function seed(record: ClanWar = war()): Promise<void> {
    for (const key of await kv.keys('clan-war:*')) await kv.del(key);
    for (const key of await kv.keys('battle-lock:*')) await kv.del(key);
    for (const key of await kv.keys('tower-pvp:*')) await kv.del(key);
    await kv.set(`clan-war:${record.id}`, record);
    for (const slug of ALL) {
        await kv.set(`save:${slug}`, {
            character: {
                name: slug,
                level: 40,
                maxHp: 1200, maxChakra: 200, maxStamina: 200,
                specialty: 'Taijutsu',
                stats: { strength: 200, speed: 200, intelligence: 200, willpower: 200 },
                jutsu: [],
            },
        });
    }
}

beforeEach(async () => { await seed(); });

describe('Clan War 2v2 match creation', { concurrency: false }, () => {
    it('accepts only a fully crewed, accepted 2v2', () => {
        assert.ok(clanWar2v2Sides(challenge()));
        assert.equal(clanWar2v2Sides(challenge({ status: 'pending' })), null, 'half-accepted');
        assert.equal(clanWar2v2Sides(challenge({ acceptedPlayer2: undefined })), null, 'missing 4th');
        assert.equal(clanWar2v2Sides(challenge({ mode: 'pvp1v1' })), null, 'wrong mode');
        assert.equal(clanWar2v2Sides(challenge({ acceptedPlayer2: FROM[0] })), null, 'duplicate fighter');
    });

    it('fields clan against clan rather than balancing teams by skill', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.equal(started.ok, true);
        if (!started.ok) return;
        const amber = started.match.roster.filter(m => m.teamId === 'amber').map(m => m.slug).sort();
        const violet = started.match.roster.filter(m => m.teamId === 'violet').map(m => m.slug).sort();
        assert.deepEqual(amber, [...FROM].sort(), 'challengers are amber');
        assert.deepEqual(violet, [...TO].sort(), 'defenders are violet');
        assert.equal(started.match.binding?.kind, 'clan-war');
    });

    it('converges all four members onto one match instead of minting four', async () => {
        const results = await Promise.all(ALL.map(actor => (
            startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor })
        )));
        assert.ok(results.every(r => r.ok), 'every member gets a match');
        const ids = new Set(results.map(r => (r.ok ? r.match.matchId : 'x')));
        assert.equal(ids.size, 1, 'exactly one published match');
    });

    it('claims a clan-war lease so the public queue cannot adopt the fight', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.equal(started.ok, true);
        for (const slug of ALL) {
            const lease = await kv.get<{ meta?: { mode?: string } }>(`battle-lock:${slug}`);
            assert.equal(lease?.meta?.mode, 'clan-war-mpvp', `${slug} holds a clan-war lease`);
        }
    });

    it('fields real consumables, matching clan-war 1v1 rather than the open queue', async () => {
        // The open Team Arena fights consumable-free because it settles no
        // economy. A clan-war duel is reward-bearing (60 war HP), so burning a
        // potion there is the same trade every other rated fight makes.
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        assert.equal(started.match.rules.consumables, 'enabled',
            'a reward-bearing duel plays by consumable rules even on an empty pack');
        assert.ok(started.match.combat.actors.every(actor => actor.itemCharges !== undefined),
            'every fighter carries a sealed charge budget');
        // And the open queue must NOT have inherited it: it settles no economy,
        // so spending a real potion there would be a pure loss.
        const source = readFileSync(join(process.cwd(), 'api', 'clan', 'war', '_mpvp.ts'), 'utf8');
        assert.match(source, /loadTowerPvpFighter\(slug, \{ consumables: true \}\)/);
        const queueSource = readFileSync(join(process.cwd(), 'api', 'towers', 'pvp-queue.ts'), 'utf8');
        assert.doesNotMatch(queueSource, /consumables: true/);
    });

    it('refuses a non-member and an unaccepted challenge', async () => {
        const outsider = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: 'stranger' });
        assert.equal(outsider.ok, false);
        if (!outsider.ok) assert.equal(outsider.status, 403);

        await seed(war({ pendingChallenges: [challenge({ status: 'pending' })] }));
        const early = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.equal(early.ok, false);
        if (!early.ok) assert.equal(early.status, 409);
    });
});

describe('Clan War 2v2 settlement', { concurrency: false }, () => {
    it('maps the sealed team winner to a challenge result', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const base = started.match;
        assert.equal(clanWar2v2Result({ ...base, status: 'done', winner: 'amber' }), 'from-wins');
        assert.equal(clanWar2v2Result({ ...base, status: 'done', winner: 'violet' }), 'to-wins');
        assert.equal(clanWar2v2Result({ ...base, status: 'done', winner: 'draw' }), 'draw');
        // A cancelled duel deals no HP either way rather than rewarding a no-show.
        assert.equal(clanWar2v2Result({ ...base, status: 'cancelled', winner: null }), 'draw');
        assert.equal(clanWar2v2Result({ ...base, status: 'active', winner: null }), null);
    });

    it('applies the war HP exactly once no matter how many members settle', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const terminal = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };

        const first = await settleClanWar2v2Match(terminal);
        assert.equal(first?.outcome, 'applied');
        assert.equal(first?.result, 'from-wins');

        const afterFirst = await kv.get<ClanWar>(`clan-war:${WAR_ID}`);
        assert.equal(afterFirst?.hp.beta, 940, 'defending clan takes exactly one 60 HP hit');
        assert.equal(afterFirst?.completedChallenges.length, 1);
        assert.equal(afterFirst?.pendingChallenges.length, 0);

        // The other three members settle too, plus a lost-response retry.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const again = await settleClanWar2v2Match(terminal);
            assert.equal(again?.replayed, true, 'a repeat settle is a replay, not a second hit');
        }
        const afterAll = await kv.get<ClanWar>(`clan-war:${WAR_ID}`);
        assert.equal(afterAll?.hp.beta, 940, 'war HP never moves twice for one duel');
    });

    it('pays the duel once when the war write lands but its reply is lost', async (t) => {
        // The settle used to reject on the lost reply. A retry then found the
        // challenge completed, recorded it as superseded and skipped the war
        // points, so none of the four fighters was ever paid.
        for (const [slug, clan] of [[FROM[0], 'alpha'], [FROM[1], 'alpha'], [TO[0], 'beta'], [TO[1], 'beta']] as const) {
            const save = await kv.get<Record<string, any>>(`save:${slug}`);
            await kv.set(`save:${slug}`, { ...save, character: { ...save!.character, clan } });
        }
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const terminal = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };
        const warKey = `clan-war:${WAR_ID}`;
        const realCompareSet = kv.compareSet.bind(kv);
        let lostReplies = 0;
        const lossy = t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            const landed = await realCompareSet(key, expected, value, options);
            if (key !== warKey || !landed || lostReplies > 0) return landed;
            lostReplies += 1;
            throw new Error('Connection terminated unexpectedly');
        });
        const first = await settleClanWar2v2Match(terminal).then(value => value, (error: Error) => error);
        lossy.mock.restore();
        assert.equal(lostReplies, 1, 'the war write landed and only its reply was lost');
        // A member whose settle failed settles again.
        const settled = first instanceof Error ? await settleClanWar2v2Match(terminal) : first;
        assert.equal(settled?.outcome, 'applied', 'the duel that moved war HP is settled as applied');

        const clanPoints = async () => Promise.all(ALL.map(async slug => (
            (await kv.get<Record<string, any>>(`save:${slug}`))!.character.clanPoints ?? 0
        )));
        assert.deepEqual(await clanPoints(), [50, 50, 25, 25], 'winners earn participation and the win, losers participation');
        assert.equal((await settleClanWar2v2Match(terminal))?.replayed, true);
        assert.deepEqual(await clanPoints(), [50, 50, 25, 25], 'a later settle never pays twice');
        assert.equal((await kv.get<ClanWar>(warKey))?.hp.beta, 940, 'war HP moved exactly once');
    });

    it('charges spent consumables so a potion costs the same as it does in 1v1', async () => {
        // The engine spends from a sealed in-memory budget; without settlement the
        // item is never removed and a clan-war duel hands out FREE potions —
        // strictly better than the 1v1 it is scored beside.
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const match = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };
        // Seal a budget and leave one charge unspent for the challenger.
        match.sealedItemCharges = { [FROM[0]]: { potion: 2 } };
        const member = match.roster.find(m => m.slug === FROM[0])!;
        const actor = match.combat.actors.find(a => a.id === member.actorId)!;
        actor.itemCharges = { potion: 1 };
        assert.deepEqual(clanWar2v2ItemsUsed(match, FROM[0]), { potion: 1 }, 'spent = sealed - remaining');
        // An absent or larger remainder can only under-charge, never invent a debt.
        actor.itemCharges = { potion: 5 };
        assert.deepEqual(clanWar2v2ItemsUsed(match, FROM[0]), {});
        assert.deepEqual(clanWar2v2ItemsUsed(match, TO[0]), {}, 'no sealed budget means nothing owed');
    });

    it('a member whose item charge failed on the first settle is charged on the replay, exactly once', async (t) => {
        // The first pass swallows a charge failure (it must not block the war
        // result) and commits the match receipt. Replays used to return early on
        // that receipt without charging again, so the member kept the potions
        // for free. Force both commit attempts to lose their race, then replay.
        const saveKey = `save:${FROM[0]}`;
        const save = await kv.get<Record<string, any>>(saveKey);
        await kv.set(saveKey, { ...save, character: { ...save!.character, itemStacks: [{ itemId: 'potion', count: 3 }] } });
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const match = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };
        match.sealedItemCharges = { [FROM[0]]: { potion: 2 } };
        const member = match.roster.find(m => m.slug === FROM[0])!;
        match.combat.actors.find(a => a.id === member.actorId)!.itemCharges = { potion: 0 };

        const realCompareSet = kv.compareSet.bind(kv);
        // Lose only the item-charge commit (its receipt fingerprint), not the
        // war-point award that writes the same save through another helper.
        const losing = t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => (
            key === saveKey && JSON.stringify(value).includes('clan-war-2v2-consumables')
                ? false
                : realCompareSet(key, expected, value, options)
        ));
        assert.equal((await settleClanWar2v2Match(match))?.outcome, 'applied', 'the war result never waits on an item charge');
        const potions = async () => (await kv.get<Record<string, any>>(saveKey))!.character.itemStacks?.[0]?.count ?? 0;
        assert.equal(await potions(), 3, 'both commit attempts lost, so nothing was charged yet');

        losing.mock.restore();
        assert.equal((await settleClanWar2v2Match(match))?.replayed, true);
        assert.equal(await potions(), 1, 'the replay charges the two potions still owed');
        await settleClanWar2v2Match(match);
        assert.equal(await potions(), 1, 'and never charges them twice');

        // The in-save receipt window keeps only the newest receipts. Even with
        // this match's receipt evicted, a late teammate's replay must not charge
        // the member a second time from whatever they hold now.
        const charged = await kv.get<Record<string, any>>(saveKey);
        await kv.set(saveKey, { ...charged, character: { ...charged!.character, serverSettlementReceipts: [], itemStacks: [{ itemId: 'potion', count: 5 }] } });
        await settleClanWar2v2Match(match);
        assert.equal(await potions(), 5, 'the durable charged marker blocks a re-charge after receipt eviction');
    });

    // A save last written 30 s ago, tired enough to show any recovery.
    async function tire(slug: string, extra: Record<string, unknown> = {}): Promise<number> {
        const at = Date.now() - 30_000;
        const save = await kv.get<Record<string, any>>(`save:${slug}`);
        await kv.set(`save:${slug}`, {
            ...save, _saveVersion: 1, _saveAt: at, _regenAt: at,
            character: { ...save!.character, ...extra, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
        });
        return at;
    }

    async function assertRecovered(slug: string, at: number): Promise<Record<string, any>> {
        const saved = (await kv.get<Record<string, any>>(`save:${slug}`))!;
        assert.ok(saved.character.hp >= 40, `${slug}: hp ${saved.character.hp} lost the idle recovery`);
        assert.ok(saved.character.chakra >= 50, `${slug}: chakra ${saved.character.chakra} lost the idle recovery`);
        assert.ok(saved.character.stamina >= 30, `${slug}: stamina ${saved.character.stamina} lost the idle recovery`);
        // Points and item charges move no vital, so the write carries the cursor.
        assert.ok(Number(saved._regenAt) >= at + 30_000 - 1_000, `${slug}: cursor ${saved._regenAt} fell behind the recovery`);
        assert.equal((Number(saved._regenAt) - at) % 1_000, 0, `${slug}: cursor ${saved._regenAt} was fenced to the write, not carried`);
        return saved;
    }

    it('pays war points without discarding the idle recovery each fighter earned', async () => {
        // Whoever settles first pays all four, usually after the others closed
        // the game. A version write that fenced the regeneration cursor to now
        // discarded every point of HP, chakra and stamina recovered since.
        for (const [slug, clan] of [[FROM[0], 'alpha'], [FROM[1], 'alpha'], [TO[0], 'beta'], [TO[1], 'beta']] as const) {
            const save = await kv.get<Record<string, any>>(`save:${slug}`);
            await kv.set(`save:${slug}`, { ...save, character: { ...save!.character, clan } });
        }
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        // The route releases the fight's battle leases before it settles; a
        // held lease is a battle, not idle time.
        const { releaseTowerBattleLeases } = await import('../../towers/_battle-lease.js');
        await releaseTowerBattleLeases(started.match.matchId, ALL);
        const at = await tire(TO[0]);
        const terminal = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };
        assert.equal((await settleClanWar2v2Match(terminal))?.outcome, 'applied');
        const loser = await assertRecovered(TO[0], at);
        assert.equal(loser.character.clanPoints, 25, 'the losing fighter was still paid participation');
    });

    it('charges spent items without discarding the idle recovery the fighter earned', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const { releaseTowerBattleLeases } = await import('../../towers/_battle-lease.js');
        await releaseTowerBattleLeases(started.match.matchId, ALL);
        const match = { ...started.match, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };
        match.sealedItemCharges = { [FROM[0]]: { potion: 2 } };
        const member = match.roster.find(m => m.slug === FROM[0])!;
        match.combat.actors.find(a => a.id === member.actorId)!.itemCharges = { potion: 0 };
        const at = await tire(FROM[0], { itemStacks: [{ itemId: 'potion', count: 3 }] });
        await settleClanWar2v2Consumables(match);
        const charged = await assertRecovered(FROM[0], at);
        assert.deepEqual(charged.character.itemStacks, [{ itemId: 'potion', count: 1 }], 'the two potions were still charged');
    });

    it('refuses to settle a match that has not ended', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        await assert.rejects(() => settleClanWar2v2Match(started.match), /not-terminal/);
    });

    it('ignores a public-queue match entirely', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const publicMatch = {
            ...started.match,
            binding: { kind: 'public-queue' as const },
            status: 'done' as const,
            winner: 'amber' as const,
        };
        assert.equal(await settleClanWar2v2Match(publicMatch), null, 'no war may be written from the open queue');
        const untouched = await kv.get<ClanWar>(`clan-war:${WAR_ID}`);
        assert.equal(untouched?.hp.beta, 1000);
    });

    it('records a draw without moving HP', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: FROM[0] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const drawn = { ...started.match, status: 'cancelled' as const, winner: null, updatedAt: Date.now() };
        const settled = await settleClanWar2v2Match(drawn);
        assert.equal(settled?.result, 'draw');
        const record = await kv.get<ClanWar>(`clan-war:${WAR_ID}`);
        assert.equal(record?.hp.alpha, 1000);
        assert.equal(record?.hp.beta, 1000);
        assert.equal(record?.completedChallenges[0]?.result, 'draw');
    });

    it('keeps the published match resolvable for reconnecting members', async () => {
        const started = await startClanWar2v2Match({ warId: WAR_ID, challengeId: CHALLENGE_ID, actor: TO[1] });
        assert.ok(started.ok);
        if (!started.ok) return;
        const resolved = await readClanWar2v2Match(CHALLENGE_ID);
        assert.equal(resolved?.matchId, started.match.matchId);
    });
});
