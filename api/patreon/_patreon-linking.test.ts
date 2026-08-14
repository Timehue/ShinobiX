import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before } from 'node:test';

let kv: (typeof import('../_storage.js'))['kv'];
let patreon: typeof import('./_patreon.js');

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('../_storage.js'));
    patreon = await import('./_patreon.js');
});

const paid = { active: true, tier: 'shinobi-supporter', entitledCents: 1500 };
const save = async (name: string) => kv.set(`save:${name}`, { version: 1, character: { name } });
const readSave = async (name: string) => {
    const record = await kv.get<{ version: number; character: Record<string, unknown> }>(`save:${name}`);
    assert.ok(record);
    return record;
};

test('Patreon relinks are one-to-one and stale webhooks cannot restore displaced saves', async () => {
    const userX = 'patreon-link-user-x';
    const userY = 'patreon-link-user-y';
    const playerA = 'patreon-link-a';
    const playerB = 'patreon-link-b';
    await save(playerA);
    await save(playerB);

    await patreon.linkPlayer(userX, playerA);
    assert.equal(await patreon.applyEntitlementToSave(playerA, userX, paid), true);
    assert.equal(patreon.isPatreonSubscriber((await readSave(playerA)).character), true);

    await patreon.linkPlayer(userX, playerB);
    assert.equal(await patreon.getLinkedPlayer(userX), playerB);
    assert.equal(await patreon.getLinkedPatreonUserId(playerA), null);
    assert.equal(await patreon.getLinkedPatreonUserId(playerB), userX);
    assert.equal(patreon.isPatreonSubscriber((await readSave(playerA)).character), false);
    assert.equal(await patreon.applyEntitlementToSave(playerA, userX, paid), false);

    assert.equal(await patreon.applyEntitlementToSave(playerB, userX, paid), true);
    await patreon.linkPlayer(userY, playerB);
    assert.equal(await patreon.getLinkedPlayer(userX), null);
    assert.equal(await patreon.getLinkedPlayer(userY), playerB);
    assert.equal(await patreon.getLinkedPatreonUserId(playerB), userY);
    assert.equal(patreon.isPatreonSubscriber((await readSave(playerB)).character), false);
    assert.equal(await patreon.applyEntitlementToSave(playerB, userX, paid), false);
});

test('concurrent relinks leave exactly one consistent forward and reverse pair', async () => {
    const user = 'patreon-concurrent-user';
    const players = ['patreon-concurrent-a', 'patreon-concurrent-b'];
    await Promise.all(players.map(save));
    await Promise.all(players.map((player) => patreon.linkPlayer(user, player)));

    const winner = await patreon.getLinkedPlayer(user);
    assert.ok(winner && players.includes(winner));
    assert.equal(await patreon.getLinkedPatreonUserId(winner), user);
    const loser = players.find((player) => player !== winner)!;
    assert.equal(await patreon.getLinkedPatreonUserId(loser), null);
});

test('a paid refresh canonicalizes away an admin-comp expiry before idempotence', async (t) => {
    const user = 'patreon-paid-comp-user';
    const player = 'patreon-paid-comp-player';
    await save(player);
    await patreon.linkPlayer(user, player);
    assert.equal(await patreon.applyEntitlementToSave(player, user, paid), true);
    await patreon.applyAdminSubscription(player, { active: true, days: 1 });

    const comp = (await readSave(player)).character.patreon as Record<string, unknown>;
    assert.equal(comp.source, 'admin');
    assert.equal(typeof comp.expiresAt, 'number');
    const oldExpiry = Number(comp.expiresAt);

    assert.equal(await patreon.applyEntitlementToSave(player, user, paid), true);
    const refreshed = await readSave(player);
    const flag = refreshed.character.patreon as Record<string, unknown>;
    assert.equal(Object.hasOwn(flag, 'source'), false);
    assert.equal(Object.hasOwn(flag, 'expiresAt'), false);
    assert.equal(patreon.isPatreonSubscriber(refreshed.character), true);

    const version = refreshed.version;
    assert.equal(await patreon.applyEntitlementToSave(player, user, paid), true);
    assert.equal((await readSave(player)).version, version, 'canonical webhook redelivery stays idempotent');

    t.mock.method(Date, 'now', () => oldExpiry + 1);
    assert.equal(
        patreon.isPatreonSubscriber((await readSave(player)).character),
        true,
        'the paid entitlement remains active after the superseded comp expiry',
    );
});

test('one-sided legacy remnants cannot tear down a newer one-to-one pair', async () => {
    const owner = 'patreon-stale-owner';
    const staleUser = 'patreon-stale-forward-user';
    const newcomer = 'patreon-stale-reverse-user';
    const ownedPlayer = 'patreon-stale-owned-player';
    const staleUserTarget = 'patreon-stale-forward-target';
    const newcomerTarget = 'patreon-stale-reverse-target';
    await Promise.all([ownedPlayer, staleUserTarget, newcomerTarget].map(save));

    await patreon.linkPlayer(owner, ownedPlayer);
    assert.equal(await patreon.applyEntitlementToSave(ownedPlayer, owner, paid), true);

    // Simulate an old two-key write that persisted only its forward half. The
    // stale user must be rejected and relinking it must not clear owner<->player.
    await kv.set(`patreon:link:${staleUser}`, ownedPlayer);
    assert.equal(await patreon.getLinkedPlayer(staleUser), null);
    await patreon.linkPlayer(staleUser, staleUserTarget);
    assert.equal(await patreon.getLinkedPlayer(staleUser), staleUserTarget);
    assert.equal(await patreon.getLinkedPatreonUserId(staleUserTarget), staleUser);
    assert.equal(await patreon.getLinkedPlayer(owner), ownedPlayer);
    assert.equal(await patreon.getLinkedPatreonUserId(ownedPlayer), owner);
    assert.equal(await patreon.applyEntitlementToSave(ownedPlayer, staleUser, paid), false);

    // Exercise the symmetric half-write: a stale player->user reverse must not
    // clear the owner's valid forward mapping when a new user claims that player.
    await kv.set(`patreon:player:${newcomerTarget}`, owner);
    assert.equal(await patreon.getLinkedPatreonUserId(newcomerTarget), null);
    await patreon.linkPlayer(newcomer, newcomerTarget);
    assert.equal(await patreon.getLinkedPlayer(newcomer), newcomerTarget);
    assert.equal(await patreon.getLinkedPatreonUserId(newcomerTarget), newcomer);
    assert.equal(await patreon.getLinkedPlayer(owner), ownedPlayer);
    assert.equal(await patreon.getLinkedPatreonUserId(ownedPlayer), owner);
    assert.equal(await patreon.applyEntitlementToSave(newcomerTarget, owner, paid), false);
    assert.equal(await patreon.applyEntitlementToSave(ownedPlayer, owner, paid), true);
    assert.equal(patreon.isPatreonSubscriber((await readSave(ownedPlayer)).character), true);
});

test('a consistent legacy link migrates atomically on its first entitlement refresh', async () => {
    const user = 'patreon-legacy-user';
    const player = 'patreon-legacy-player';
    await save(player);
    await kv.set(`patreon:link:${user}`, player);
    await kv.set(`patreon:player:${player}`, user);

    assert.equal(await patreon.applyEntitlementToSave(player, user, paid), true);
    await kv.del(`patreon:link:${user}`, `patreon:player:${player}`);
    assert.equal(await patreon.getLinkedPlayer(user), player);
    assert.equal(await patreon.getLinkedPatreonUserId(player), user);
});

test('link reconciliation publishes both directions with one atomic hash mutation', () => {
    const source = readFileSync('api/patreon/_patreon.ts', 'utf8');
    const body = source.slice(source.indexOf('export async function linkPlayer'), source.indexOf('export async function getMemberRecord'));
    assert.match(body, /await kv\.hset\(LINK_LEDGER_KEY, fields\)/);
    assert.doesNotMatch(body, /kv\.set\(linkKey|kv\.set\(playerKey/);
});
