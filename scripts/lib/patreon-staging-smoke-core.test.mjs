import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
    classifyFixtureLinkFields,
    expectedEntitlementCaps,
    fixtureIdentity,
    fixtureMemberRecordOwned,
    fixtureStorageNamespace,
    signedWebhookRequest,
    validateAuthorizeUrl,
    validateStagingBaseUrl,
} from './patreon-staging-smoke-core.mjs';

test('staging URL validation requires credential-free HTTPS', () => {
    assert.equal(validateStagingBaseUrl('https://staging.example.test/').href, 'https://staging.example.test/');
    assert.throws(() => validateStagingBaseUrl('http://staging.example.test'), /HTTPS/);
    assert.throws(() => validateStagingBaseUrl('https://user:pass@staging.example.test'), /credentials/);
    assert.throws(() => validateStagingBaseUrl('https://staging.example.test?token=secret'), /query or fragment/);
    assert.throws(() => validateStagingBaseUrl('https://staging.example.test/game'), /without a path/);
});

test('fixture cleanup classifies only marker-namespace link and member values as owned', () => {
    const fixture = fixtureIdentity('ABCDEF12-3456-7890');
    const namespace = fixtureStorageNamespace(fixture);
    const [safeField, unsafeField] = namespace.linkFields;
    const classified = classifyFixtureLinkFields({
        [safeField]: fixture.players.activeA,
        [unsafeField]: 'unrelated-real-player',
    }, namespace, fixture);
    assert.deepEqual(classified.safe, [safeField]);
    assert.deepEqual(classified.unsafe, [unsafeField]);
    assert.equal(fixtureMemberRecordOwned({ userId: fixture.users.supporterA }, fixture.users.supporterA), true);
    assert.equal(fixtureMemberRecordOwned({ userId: 'someone-else' }, fixture.users.supporterA), false);
    assert.equal(fixtureMemberRecordOwned(null, fixture.users.supporterA), false);
});

test('fixture names are bounded, namespaced, and unique by role', () => {
    const fixture = fixtureIdentity('ABCDEF12-3456-7890');
    const namespace = fixtureStorageNamespace(fixture);
    assert.match(fixture.markerKey, /^maintenance:patreon-smoke:/);
    assert.equal(new Set(Object.values(fixture.players)).size, 4);
    assert.equal(new Set(Object.values(fixture.users)).size, 2);
    assert.equal(Math.max(...Object.values(fixture.players).map((name) => name.length)) <= 32, true);
    assert.equal(namespace.saveKeys.length, 4);
    assert.equal(namespace.linkFields.length, 6);
    assert.equal(namespace.legacyLinkKeys.length, 6);
    assert.deepEqual(namespace.memberKeys.map(({ userId }) => userId).sort(), Object.values(fixture.users).sort());
    assert.equal(new Set([
        ...namespace.saveKeys,
        ...namespace.linkFields,
        ...namespace.legacyLinkKeys,
        ...namespace.memberKeys.map(({ key }) => key),
    ]).size, 18);
    assert.throws(() => fixtureStorageNamespace({ players: {}, users: {} }), /incomplete/);
});

test('webhook fixtures are signed over the exact raw bytes sent', () => {
    const request = signedWebhookRequest('webhook-secret', 'user-1', { active: true });
    assert.equal(
        request.signature,
        createHmac('md5', 'webhook-secret').update(request.body).digest('hex'),
    );
    assert.equal(JSON.parse(request.body).data.relationships.user.data.id, 'user-1');
});

test('authorize URL certification checks redirect, state, and exact scopes', () => {
    const url = new URL('https://www.patreon.com/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'client-id');
    url.searchParams.set('redirect_uri', 'https://staging.example.test/api/patreon/oauth-callback');
    url.searchParams.set('state', 'x'.repeat(40));
    url.searchParams.set('scope', 'identity identity[email] identity.memberships');
    const result = validateAuthorizeUrl(url, {
        clientId: 'client-id',
        redirectUri: 'https://staging.example.test/api/patreon/oauth-callback',
    });
    assert.equal(result.ok, true);
    url.searchParams.set('redirect_uri', 'https://wrong.example.test/callback');
    assert.equal(validateAuthorizeUrl(url, {
        clientId: 'client-id',
        redirectUri: 'https://staging.example.test/api/patreon/oauth-callback',
    }).ok, false);
});

test('Base and Supporter cap expectations remain pinned', () => {
    assert.deepEqual(expectedEntitlementCaps(false), { loadout: 12, pets: 3, bloodlines: 1, customAvatar: false });
    assert.deepEqual(expectedEntitlementCaps(true), { loadout: 15, pets: 5, bloodlines: 2, customAvatar: true });
});
