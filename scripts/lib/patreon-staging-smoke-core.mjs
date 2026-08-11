import { createHmac } from 'node:crypto';

export function validateStagingBaseUrl(raw) {
    const url = new URL(String(raw ?? ''));
    if (url.username || url.password) throw new Error('STAGING_BASE_URL must not contain credentials.');
    if (url.search || url.hash) throw new Error('STAGING_BASE_URL must not contain a query or fragment.');
    if (url.protocol !== 'https:') throw new Error('STAGING_BASE_URL must use HTTPS.');
    if (url.pathname !== '/' && url.pathname !== '') throw new Error('STAGING_BASE_URL must be an origin without a path.');
    url.pathname = '/';
    return url;
}

export function fixtureIdentity(runId) {
    const suffix = String(runId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    if (suffix.length < 8) throw new Error('A fixture run id needs at least eight alphanumeric characters.');
    return {
        markerKey: `maintenance:patreon-smoke:${suffix}`,
        players: {
            base: `qa-pat-${suffix}-base`,
            activeA: `qa-pat-${suffix}-a`,
            activeB: `qa-pat-${suffix}-b`,
            expired: `qa-pat-${suffix}-expired`,
        },
        users: {
            supporterA: `qa-patreon-${suffix}-a`,
            supporterB: `qa-patreon-${suffix}-b`,
        },
    };
}

export function fixtureStorageNamespace(fixture) {
    const players = Object.values(fixture?.players ?? {}).map(String);
    const users = Object.values(fixture?.users ?? {}).map(String);
    if (players.length !== 4 || users.length !== 2 || players.some((name) => !name) || users.some((id) => !id)) {
        throw new Error('The Patreon fixture namespace is incomplete.');
    }
    return {
        saveKeys: players.map((name) => `save:${name}`),
        linkFields: [
            ...users.map((id) => `user:${id}`),
            ...players.map((name) => `player:${name}`),
        ],
        legacyLinkKeys: [
            ...users.map((id) => `patreon:link:${id}`),
            ...players.map((name) => `patreon:player:${name}`),
        ],
        memberKeys: users.map((id) => ({ key: `patreon:member:${id}`, userId: id })),
    };
}

export function classifyFixtureLinkFields(ledger, namespace, fixture) {
    const values = ledger && typeof ledger === 'object' ? ledger : {};
    const fixtureValues = new Set([
        ...Object.values(fixture?.players ?? {}),
        ...Object.values(fixture?.users ?? {}),
        '',
    ]);
    const safe = [];
    const unsafe = [];
    for (const field of namespace?.linkFields ?? []) {
        if (!Object.prototype.hasOwnProperty.call(values, field)) continue;
        (fixtureValues.has(values[field]) ? safe : unsafe).push(field);
    }
    return { safe, unsafe };
}

export function fixtureMemberRecordOwned(record, expectedUserId) {
    return Boolean(record && typeof record === 'object' && record.userId === expectedUserId);
}

export function memberWebhookPayload(userId, {
    active,
    entitledCents = active ? 1500 : 0,
    patronStatus = active ? 'active_patron' : 'declined_patron',
    lastChargeStatus = active ? 'Paid' : 'Declined',
} = {}) {
    return {
        data: {
            type: 'member',
            id: `fixture-member-${String(userId)}`,
            attributes: {
                patron_status: patronStatus,
                currently_entitled_amount_cents: entitledCents,
                last_charge_status: lastChargeStatus,
            },
            relationships: { user: { data: { type: 'user', id: String(userId) } } },
        },
    };
}

export function signedWebhookRequest(secret, userId, options = {}) {
    const body = JSON.stringify(memberWebhookPayload(userId, options));
    return {
        body,
        signature: createHmac('md5', String(secret)).update(body).digest('hex'),
        event: options.event ?? 'members:update',
    };
}

export function validateAuthorizeUrl(raw, expected) {
    const url = new URL(String(raw ?? ''));
    const scopes = new Set(String(url.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean));
    const checks = {
        https: url.protocol === 'https:',
        host: url.hostname === 'www.patreon.com',
        path: url.pathname === '/oauth2/authorize',
        responseType: url.searchParams.get('response_type') === 'code',
        clientId: url.searchParams.get('client_id') === expected.clientId,
        redirectUri: url.searchParams.get('redirect_uri') === expected.redirectUri,
        statePresent: String(url.searchParams.get('state') ?? '').length >= 32,
        scopes: ['identity', 'identity[email]', 'identity.memberships'].every((scope) => scopes.has(scope)),
    };
    return { ok: Object.values(checks).every(Boolean), checks };
}

export function expectedEntitlementCaps(active) {
    return active
        ? { loadout: 15, pets: 5, bloodlines: 2, customAvatar: true }
        : { loadout: 12, pets: 3, bloodlines: 1, customAvatar: false };
}
