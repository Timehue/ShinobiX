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

const WAR_ID = 'alpha__beta';
const CHALLENGE_ID = 'cw-2v2-test';
const FROM = ['ash', 'briar'] as const;
const TO = ['cinder', 'dune'] as const;
const ALL = [...FROM, ...TO];

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ startClanWar2v2Match, clanWar2v2Sides, readClanWar2v2Match } = await import('./_mpvp.js'));
    ({ settleClanWar2v2Match, clanWar2v2Result } = await import('./_mpvp-settlement.js'));
    ({ clanWar2v2ItemsUsed } = await import('./_mpvp-consumables.js'));
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
