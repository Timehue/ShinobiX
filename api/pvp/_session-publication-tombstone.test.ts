import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-session-publication-tombstone-test';

import {
    isPvpSessionPublicationCapability,
    makePvpSessionPublicationTombstone,
    parsePvpSessionPublicationTombstone,
    pvpSessionPublicationTombstoneFor,
    pvpSessionPublicationTombstoneMatchesCapability,
    PVP_PUBLICATION_ADMIN_CREATOR,
    PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION,
    type PvpSessionPublicationCapability,
} from './_session-publication-tombstone.js';

const BATTLE_ID = 'pvp-55555555-5555-4555-8555-555555555555';
const OTHER_BATTLE_ID = 'pvp-66666666-6666-4666-8666-666666666666';
const FINGERPRINT = 'a'.repeat(64);

function capability(
    overrides: Partial<PvpSessionPublicationCapability> = {},
): PvpSessionPublicationCapability {
    return {
        battleId: BATTLE_ID,
        creator: 'fencecreator',
        p1: 'fencecreator',
        p2: 'fenceopponent',
        createRequestFingerprint: FINGERPRINT,
        ...overrides,
    };
}

test('a capability needs a well-formed battle id, creator, distinct fighters and digest', () => {
    assert.equal(isPvpSessionPublicationCapability(capability()), true);
    assert.equal(isPvpSessionPublicationCapability(capability({ creator: PVP_PUBLICATION_ADMIN_CREATOR })), true);
    assert.equal(isPvpSessionPublicationCapability(capability({ battleId: 'not-a-battle' })), false);
    assert.equal(isPvpSessionPublicationCapability(capability({ creator: '' })), false);
    assert.equal(isPvpSessionPublicationCapability(capability({ creator: 'Mixed Case' })), false);
    // A self-duel cannot fence a battle id; the create path rejects it anyway.
    assert.equal(isPvpSessionPublicationCapability(capability({ p2: 'fencecreator' })), false);
    assert.equal(isPvpSessionPublicationCapability(capability({ createRequestFingerprint: 'short' })), false);
});

test('the tombstone round-trips and rejects near-misses', () => {
    const tombstone = makePvpSessionPublicationTombstone(capability(), 1_800_000_000_000);
    assert.equal(tombstone.version, PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION);
    assert.deepEqual(parsePvpSessionPublicationTombstone(tombstone), tombstone);
    assert.equal(parsePvpSessionPublicationTombstone({ ...tombstone, version: 'other' }), null);
    assert.equal(parsePvpSessionPublicationTombstone({ ...tombstone, rolledBackAt: 0 }), null);
    // Extra or missing fields are never a tombstone — an ordinary session row
    // carries battleId + createRequestFingerprint too.
    assert.equal(parsePvpSessionPublicationTombstone({ ...tombstone, status: 'active' }), null);
    const { creator, ...withoutCreator } = tombstone;
    assert.equal(creator, 'fencecreator');
    assert.equal(parsePvpSessionPublicationTombstone(withoutCreator), null);
    assert.equal(pvpSessionPublicationTombstoneFor(tombstone, BATTLE_ID)?.battleId, BATTLE_ID);
    assert.equal(pvpSessionPublicationTombstoneFor(tombstone, OTHER_BATTLE_ID), null);
    assert.equal(makePvpSessionPublicationTombstone(capability(), -5).rolledBackAt, 1);
    assert.throws(
        () => makePvpSessionPublicationTombstone(capability({ p2: 'fencecreator' }), 1),
        /capability-invalid/,
    );
});

test('only the identical create capability may replace a publication fence', () => {
    const owner = capability();
    const tombstone = makePvpSessionPublicationTombstone(owner, 1_800_000_000_000);
    assert.equal(pvpSessionPublicationTombstoneMatchesCapability(tombstone, owner), true);
    // Every field is load-bearing: a different creator, a different fighter
    // pairing, swapped slots, or different sealed create parameters are all
    // different capabilities and must not take the battle id.
    for (const foreign of [
        capability({ creator: 'fenceopponent' }),
        capability({ creator: PVP_PUBLICATION_ADMIN_CREATOR }),
        capability({ p2: 'thirdparty' }),
        capability({ p1: 'fenceopponent', p2: 'fencecreator' }),
        capability({ createRequestFingerprint: 'b'.repeat(64) }),
        capability({ battleId: OTHER_BATTLE_ID }),
    ]) {
        assert.equal(pvpSessionPublicationTombstoneMatchesCapability(tombstone, foreign), false);
    }
    // A malformed capability never unlocks anything, even against itself.
    const malformed = capability({ createRequestFingerprint: 'nope' });
    assert.equal(
        pvpSessionPublicationTombstoneMatchesCapability(
            { ...tombstone, createRequestFingerprint: 'nope' },
            malformed,
        ),
        false,
    );
});

/**
 * End-to-end half of the rule: the fenced battle id stays bound to the creator
 * that rolled it back. The opponent is an authenticated fighter in that very
 * battle and still cannot claim the id.
 */
test('a fenced battle id rejects a second creator and still readmits the first', async () => {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('./session.js')).default as unknown as
        (req: never, res: never) => Promise<unknown>;
    const creator = 'fencedcreator';
    const opponent = 'fencedopponent';
    const battleId = 'pvp-77777777-7777-4777-8777-777777777777';

    const character = (name: string) => ({
        name,
        level: 20,
        village: 'Leaf',
        maxHp: 500,
        maxChakra: 500,
        maxStamina: 500,
        hp: 500,
        chakra: 500,
        stamina: 500,
        stats: {},
        equipment: {},
        inventory: [],
        itemStacks: [],
        jutsu: [],
        jutsuMastery: [],
    });
    for (const name of [creator, opponent]) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: character(name) });
    }
    const response = () => {
        const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
        const res = {
            setHeader: () => res,
            status(code: number) { out.statusCode = code; return res; },
            json(body: Record<string, any>) { out.body = body; return res; },
            end: () => res,
        };
        return { out, res: res as never };
    };
    const request = (playerName: string) => ({
        method: 'POST',
        body: {
            battleId,
            p1Character: { name: creator },
            p2Character: { name: opponent },
        },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(playerName),
            'x-forwarded-for': '127.0.0.6',
        },
        socket: { remoteAddress: '127.0.0.6' },
    } as never);

    const originalCompareSet = kv.compareSet.bind(kv);
    let failActivation = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (failActivation && key === `pvp:pending-session:${creator}` && typeof next === 'string') {
            if ((JSON.parse(next) as { phase?: string }).phase === 'active') {
                failActivation = false;
                throw new Error('forced-pointer-activation-precommit');
            }
        }
        return originalCompareSet(key, expected, next, options as never);
    };
    try {
        const rolledBack = response();
        await handler(request(creator), rolledBack.res);
        assert.equal(rolledBack.out.statusCode, 503);
        const fence = await kv.get<Record<string, unknown>>(`pvp:${battleId}`);
        assert.equal(fence?.version, PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION);

        // The opponent is a real fighter in this battle — and still not the
        // capability that owns the id.
        const hijack = response();
        await handler(request(opponent), hijack.res);
        assert.equal(hijack.out.statusCode, 409);
        assert.equal(
            (await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.version,
            PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION,
        );

        const retry = response();
        await handler(request(creator), retry.res);
        assert.equal(retry.out.statusCode, 200);
        assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.status, 'active');
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }
});
