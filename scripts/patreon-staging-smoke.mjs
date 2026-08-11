/*
 * Patreon disposable-staging certification.
 *
 * Default mode is a read-only deployed preflight. --execute-fixtures adds a
 * guarded, self-cleaning fixture journey against staging storage and the
 * deployed webhook/status/save routes. Production targets are unsupported.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadProjectEnv } from './_load-env.mjs';
import {
    assertPatreonSmokeInvocation,
    presentCredentialNames,
    redactMaintenanceError,
} from './lib/maintenance-guards.mjs';
import {
    expectedEntitlementCaps,
    classifyFixtureLinkFields,
    fixtureIdentity,
    fixtureMemberRecordOwned,
    fixtureStorageNamespace,
    signedWebhookRequest,
    validateAuthorizeUrl,
    validateStagingBaseUrl,
} from './lib/patreon-staging-smoke-core.mjs';

await loadProjectEnv();

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
let config;
try {
    config = assertPatreonSmokeInvocation(rawArgs, process.env);
} catch (error) {
    console.error('[patreon-smoke] refused:', redactError(error));
    process.exit(2);
}
const EXECUTE = config.executeFixtures;
const AS_JSON = args.has('--json');
const stages = [];

const REQUIRED = [
    'STAGING_BASE_URL',
    'PATREON_STAGING_ADMIN_TOKEN',
    'PATREON_CLIENT_ID',
    'PATREON_CLIENT_SECRET',
    'PATREON_WEBHOOK_SECRET',
    'PATREON_REDIRECT_URI',
    'PATREON_APP_RETURN_URL',
    'PATREON_CAMPAIGN_ID',
    'SESSION_SECRET',
];
const present = new Set(presentCredentialNames(process.env, REQUIRED));
const missing = REQUIRED.filter((name) => !present.has(name));
if (missing.length > 0) {
    console.error(`[patreon-smoke] refused: Missing required staging configuration keys: ${missing.join(', ')}`);
    process.exit(2);
}

let baseUrl;
try {
    baseUrl = validateStagingBaseUrl(process.env.STAGING_BASE_URL);
    const redirectUrl = new URL(process.env.PATREON_REDIRECT_URI);
    const returnUrl = new URL(process.env.PATREON_APP_RETURN_URL);
    if (redirectUrl.origin !== baseUrl.origin
        || redirectUrl.pathname !== '/api/patreon/oauth-callback'
        || redirectUrl.search
        || redirectUrl.hash) {
        throw new Error('PATREON_REDIRECT_URI must point to /api/patreon/oauth-callback on STAGING_BASE_URL.');
    }
    if (returnUrl.origin !== baseUrl.origin || returnUrl.username || returnUrl.password) {
        throw new Error('PATREON_APP_RETURN_URL must remain on the acknowledged staging origin.');
    }
} catch (error) {
    console.error('[patreon-smoke] refused:', redactError(error));
    process.exit(2);
}

const adminHeaders = { 'x-admin-token': process.env.PATREON_STAGING_ADMIN_TOKEN };

function stage(name, detail) {
    stages.push({ name, pass: true, detail });
}

async function requestJson(path, init = {}) {
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl.origin) throw new Error('Refusing a cross-origin staging request.');
    const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: { ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body = null;
    if (text) {
        try { body = JSON.parse(text); } catch { body = null; }
    }
    return { response, body };
}

async function getStatus(playerName) {
    const { response, body } = await requestJson(`/api/patreon/status?playerName=${encodeURIComponent(playerName)}`, {
        headers: adminHeaders,
    });
    if (!response.ok || !body || body.ok !== true) throw new Error(`Patreon status preflight failed with HTTP ${response.status}.`);
    return body;
}

async function getSave(playerName) {
    const { response, body } = await requestJson(`/api/save/${encodeURIComponent(playerName)}`, { headers: adminHeaders });
    if (!response.ok || !body?.character) throw new Error(`Fixture save read failed with HTTP ${response.status}.`);
    return body;
}

async function poll(label, read, predicate, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await read();
        if (predicate(last)) return last;
        await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(`${label} did not converge before the staging timeout.`);
}

async function sendWebhook(userId, options) {
    const signed = signedWebhookRequest(process.env.PATREON_WEBHOOK_SECRET, userId, options);
    return requestJson('/api/patreon/webhook', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-patreon-event': signed.event,
            'x-patreon-signature': signed.signature,
        },
        body: signed.body,
    });
}

async function deployedPreflight(probeName) {
    const status = await getStatus(probeName);
    assert.equal(status.configured, true, 'deployed Patreon status must report configured');
    stage('deployed-status', 'Configured Patreon status route accepted full-admin staging authentication.');

    const { response, body } = await requestJson(`/api/patreon/oauth-start?playerName=${encodeURIComponent(probeName)}`, {
        headers: adminHeaders,
    });
    assert.equal(response.status, 200, `OAuth start returned HTTP ${response.status}`);
    assert.equal(body?.ok, true);
    const authorization = validateAuthorizeUrl(body?.url, {
        clientId: process.env.PATREON_CLIENT_ID,
        redirectUri: process.env.PATREON_REDIRECT_URI,
    });
    assert.equal(authorization.ok, true, `OAuth authorize URL checks failed: ${JSON.stringify(authorization.checks)}`);
    stage('oauth-start', 'Authorize host, callback, state, response type, client id, and membership scopes are correct.');
}

function makeFixtureSave(name, token, expired = false) {
    const now = Date.now();
    const character = {
        name,
        stats: { strength: 1, defense: 1, speed: 1, intelligence: 1, chakra: 1, stamina: 1 },
        jutsuMastery: Array.from({ length: 15 }, (_, index) => ({ jutsuId: `qa-jutsu-${index + 1}`, level: 1, xp: 0 })),
        equippedJutsuIds: Array.from({ length: 15 }, (_, index) => `qa-jutsu-${index + 1}`),
        pets: Array.from({ length: 5 }, (_, index) => ({ id: `qa-pet-${index + 1}`, hp: 10, attack: 10, defense: 10, speed: 10 })),
        activePetId: 'qa-pet-1',
        equipment: {},
        ...(expired ? {
            patreon: {
                userId: '',
                tier: 'shinobi-supporter',
                active: true,
                entitledCents: 0,
                source: 'admin',
                since: now - 86_400_000,
                updatedAt: now - 10_000,
                expiresAt: now - 1_000,
            },
        } : {}),
    };
    return {
        _maintenanceFixture: token,
        _saveVersion: 1,
        _saveAt: now,
        character,
        savedBloodlines: [{ id: 'qa-bloodline-1' }, { id: 'qa-bloodline-2' }],
    };
}

function assertCaps(character, entitlementApi, active) {
    const actual = {
        loadout: entitlementApi.maxLoadout(character),
        pets: entitlementApi.maxPets(character),
        bloodlines: entitlementApi.maxStoredBloodlines(character),
        customAvatar: entitlementApi.canCustomAvatar(character),
    };
    assert.deepEqual(actual, expectedEntitlementCaps(active));
}

async function executeFixtures(fixture) {
    const storage = await import('../api/_storage.js');
    const patreon = await import('../api/patreon/_patreon.js');
    const entitlementApi = await import('../api/_entitlements.js');
    const { kv } = storage;
    const token = randomUUID();
    const namespace = fixtureStorageNamespace(fixture);
    const createdSaveKeys = [];
    const createdMemberKeys = new Map();
    let markerOwned = false;

    function ownMemberKey(userId) {
        const entry = namespace.memberKeys.find((candidate) => candidate.userId === userId);
        if (!entry) throw new Error('Refusing a member write outside the reserved fixture namespace.');
        createdMemberKeys.set(entry.key, entry.userId);
    }

    async function sendOwnedWebhook(userId, options) {
        ownMemberKey(userId);
        return sendWebhook(userId, options);
    }

    async function cleanup() {
        const cleanupErrors = [];
        const attempt = async (label, action) => {
            try { await action(); }
            catch (error) { cleanupErrors.push(`${label}: ${String(error?.message ?? error)}`); }
        };

        await attempt('link-ledger cleanup', async () => {
            const ledger = (await kv.hgetall('patreon:links:v2')) ?? {};
            const classified = classifyFixtureLinkFields(ledger, namespace, fixture);
            if (classified.safe.length > 0) await kv.hdel('patreon:links:v2', ...classified.safe);
            if (classified.unsafe.length > 0) throw new Error('A fixture link field points outside this run and was preserved.');
        });

        for (const key of createdSaveKeys) {
            await attempt('fixture-save cleanup', async () => {
                const record = await kv.get(key);
                if (record?._maintenanceFixture !== token) throw new Error('A fixture save ownership marker changed; the record was preserved.');
                await kv.del(key);
            });
        }

        for (const [key, userId] of createdMemberKeys) {
            await attempt('member-ledger cleanup', async () => {
                const record = await kv.get(key);
                if (record === null || record === undefined) return;
                if (!fixtureMemberRecordOwned(record, userId)) {
                    throw new Error('A fixture member key points outside this run and was preserved.');
                }
                await kv.del(key);
            });
        }

        await attempt('legacy-link verification', async () => {
            const legacy = await Promise.all(namespace.legacyLinkKeys.map((key) => kv.get(key)));
            if (legacy.some((value) => value !== null && value !== undefined)) {
                throw new Error('An unexpected legacy fixture link appeared and was preserved for investigation.');
            }
        });

        if (markerOwned) await attempt('fixture-marker cleanup', async () => {
            if (!(await kv.delIfEqual(fixture.markerKey, token))) {
                throw new Error('Fixture run marker could not be released by its owner token.');
            }
        });

        await storage.closeStoragePool().catch(() => undefined);
        if (cleanupErrors.length > 0) throw new Error(`Fixture cleanup failed: ${cleanupErrors.join('; ')}`);
    }

    try {
        assert.equal(await kv.set(fixture.markerKey, token, { nx: true, ex: 3600 }), 'OK', 'fixture run marker already exists');
        markerOwned = true;

        const existingLedger = (await kv.hgetall('patreon:links:v2')) ?? {};
        const occupiedFields = namespace.linkFields.filter((field) => Object.prototype.hasOwnProperty.call(existingLedger, field));
        const [legacyValues, memberValues] = await Promise.all([
            Promise.all(namespace.legacyLinkKeys.map((key) => kv.get(key))),
            Promise.all(namespace.memberKeys.map(({ key }) => kv.get(key))),
        ]);
        if (occupiedFields.length > 0
            || legacyValues.some((value) => value !== null && value !== undefined)
            || memberValues.some((value) => value !== null && value !== undefined)) {
            throw new Error('The generated Patreon fixture namespace already exists; no fixture data was changed.');
        }

        for (const [role, name] of Object.entries(fixture.players)) {
            const key = `save:${name}`;
            const wrote = await kv.set(key, makeFixtureSave(name, token, role === 'expired'), { nx: true });
            assert.equal(wrote, 'OK', `fixture save already exists for role ${role}`);
            createdSaveKeys.push(key);
        }
        stage('fixture-reservation', 'Four collision-safe, marker-owned disposable staging saves were reserved.');

        const baseSave = await getSave(fixture.players.base);
        assertCaps(baseSave.character, entitlementApi, false);
        assert.equal(baseSave.character.pets.length, 5, 'Base overflow ownership must be retained');
        assert.equal(baseSave.savedBloodlines.length, 2, 'Base bloodline overflow must be retained');
        const expiredSave = await getSave(fixture.players.expired);
        assertCaps(expiredSave.character, entitlementApi, false);
        stage('base-and-expiry', 'Base caps and a past admin-comp expiry fail closed without deleting overflow ownership.');

        const tampered = signedWebhookRequest('definitely-wrong-secret', fixture.users.supporterA, { active: true });
        const rejected = await requestJson('/api/patreon/webhook', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-patreon-event': tampered.event,
                'x-patreon-signature': tampered.signature,
            },
            body: tampered.body,
        });
        assert.equal(rejected.response.status, 401);
        stage('webhook-authentication', 'The deployed webhook rejected a correctly shaped payload with the wrong signature.');

        const activeMembership = { patronStatus: 'active_patron', entitledCents: patreon.subMinCents(), lastChargeStatus: 'Paid' };
        const activeEntitlement = patreon.computeEntitlement(activeMembership);
        await patreon.linkPlayer(fixture.users.supporterA, fixture.players.activeA);
        ownMemberKey(fixture.users.supporterA);
        await patreon.setMemberRecord(fixture.users.supporterA, activeEntitlement, activeMembership.patronStatus);
        assert.equal(await patreon.applyEntitlementToSave(fixture.players.activeA, fixture.users.supporterA, activeEntitlement), true);

        const liveActive = await poll(
            'active Supporter link',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.active === true,
        );
        await poll(
            'active Supporter status projection',
            () => getStatus(fixture.players.activeA),
            (status) => status.linked === true && status.active === true,
        );
        assertCaps(liveActive.character, entitlementApi, true);
        const beforeIdempotent = Number((await kv.get(`save:${fixture.players.activeA}`))._saveVersion);
        assert.equal(await patreon.applyEntitlementToSave(fixture.players.activeA, fixture.users.supporterA, activeEntitlement), true);
        const afterIdempotent = Number((await kv.get(`save:${fixture.players.activeA}`))._saveVersion);
        assert.equal(afterIdempotent, beforeIdempotent, 'identical entitlement refresh must not bump the save version');
        stage('active-and-reconnect', 'Active caps apply and an identical reconnect/refresh is version-idempotent.');

        await patreon.applyAdminSubscription(fixture.players.activeA, { active: true, days: 1 });
        await poll(
            'admin comp visibility',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.source === 'admin' && Number(record.character?.patreon?.expiresAt) > Date.now(),
        );
        const paidRefresh = await sendOwnedWebhook(fixture.users.supporterA, { active: true, entitledCents: patreon.subMinCents() });
        assert.equal(paidRefresh.response.status, 200);
        const canonicalPaid = await poll(
            'paid refresh canonicalization',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.active === true
                && !Object.prototype.hasOwnProperty.call(record.character.patreon, 'source')
                && !Object.prototype.hasOwnProperty.call(record.character.patreon, 'expiresAt'),
        );
        assertCaps(canonicalPaid.character, entitlementApi, true);
        stage('paid-refresh', 'A signed paid refresh removes superseded admin source/expiry metadata.');

        const lapse = await sendOwnedWebhook(fixture.users.supporterA, { active: false, entitledCents: 0 });
        assert.equal(lapse.response.status, 200);
        const lapsed = await poll(
            'lapsed Supporter state',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.active === false,
        );
        assertCaps(lapsed.character, entitlementApi, false);
        assert.equal(lapsed.character.pets.length, 5);
        assert.equal(lapsed.character.jutsuMastery.length, 15);
        assert.equal(lapsed.savedBloodlines.length, 2);
        stage('lapse-preservation', 'A signed lapse restores Base use caps while retaining all paid-era pets, mastery, and bloodlines.');

        const reactivate = await sendOwnedWebhook(fixture.users.supporterA, { active: true, entitledCents: patreon.subMinCents() });
        assert.equal(reactivate.response.status, 200);
        await poll(
            'Supporter reactivation',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.active === true,
        );
        stage('reactivation', 'A signed reactivation restores Supporter access.');

        await patreon.linkPlayer(fixture.users.supporterA, fixture.players.activeB);
        await poll(
            'relink revocation',
            () => getSave(fixture.players.activeA),
            (record) => record.character?.patreon?.active === false,
        );
        await poll(
            'deployed relink visibility',
            () => getStatus(fixture.players.activeB),
            (status) => status.linked === true && status.active === true,
        );
        const relinkRefresh = await sendOwnedWebhook(fixture.users.supporterA, { active: true, entitledCents: patreon.subMinCents() });
        assert.equal(relinkRefresh.response.status, 200);
        await poll(
            'relink activation',
            () => getSave(fixture.players.activeB),
            (record) => record.character?.patreon?.active === true,
        );
        assert.equal(await patreon.getLinkedPatreonUserId(fixture.players.activeA), null);
        assert.equal(await patreon.getLinkedPatreonUserId(fixture.players.activeB), fixture.users.supporterA);
        stage('player-relink', 'Moving one Patreon identity revokes the old player before activating the new player.');

        await patreon.linkPlayer(fixture.users.supporterB, fixture.players.activeB);
        await poll(
            'replacement-user revocation',
            () => getSave(fixture.players.activeB),
            (record) => record.character?.patreon?.active === false,
        );
        await poll(
            'deployed replacement-link visibility',
            () => getStatus(fixture.players.activeB),
            (status) => status.linked === true && status.active === false,
        );
        const staleRefresh = await sendOwnedWebhook(fixture.users.supporterA, { active: true, entitledCents: patreon.subMinCents() });
        assert.equal(staleRefresh.response.status, 200);
        assert.equal(staleRefresh.body?.applied, false);
        assert.equal((await getSave(fixture.players.activeB)).character.patreon.active, false);
        const replacementRefresh = await sendOwnedWebhook(fixture.users.supporterB, { active: true, entitledCents: patreon.subMinCents() });
        assert.equal(replacementRefresh.response.status, 200);
        await poll(
            'replacement-user activation',
            () => getSave(fixture.players.activeB),
            (record) => record.character?.patreon?.active === true,
        );
        stage('identity-relink', 'Replacing a Patreon identity rejects stale webhooks and activates only the current bidirectional owner.');

        const deleted = await sendOwnedWebhook(fixture.users.supporterB, {
            active: false,
            entitledCents: 0,
            patronStatus: 'former_patron',
            event: 'members:delete',
        });
        assert.equal(deleted.response.status, 200);
        const former = await poll(
            'membership deletion',
            () => getSave(fixture.players.activeB),
            (record) => record.character?.patreon?.active === false,
        );
        assertCaps(former.character, entitlementApi, false);
        stage('membership-delete', 'A signed member deletion expires access and restores Base caps.');
    } finally {
        await cleanup();
        stage('fixture-cleanup', 'Only marker-owned saves and this run\'s exact link/member fields were removed.');
    }
}

function redactError(error) {
    return redactMaintenanceError(error, {
        sensitiveValues: [
            process.env.STAGING_BASE_URL,
            process.env.PATREON_STAGING_ADMIN_TOKEN,
            process.env.PATREON_CLIENT_SECRET,
            process.env.PATREON_WEBHOOK_SECRET,
            process.env.SESSION_SECRET,
            process.env.DATABASE_URL,
            process.env.SUPABASE_POSTGRES_URL,
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
        ],
    });
}

async function main() {
    const probe = fixtureIdentity(randomUUID());
    await deployedPreflight(probe.players.base);
    if (EXECUTE) await executeFixtures(probe);
    const result = {
        target: 'staging',
        mode: EXECUTE ? 'disposable-fixture-certification' : 'read-only-preflight',
        passed: stages.length,
        failed: 0,
        stages,
        manualOAuthAuthorizationRequired: true,
    };
    if (AS_JSON) console.log(JSON.stringify(result, null, 2));
    else {
        console.log(`[patreon-smoke] PASS ${result.passed}/${result.passed} (${result.mode})`);
        for (const item of stages) console.log(`[ ok ] ${item.name}: ${item.detail}`);
        console.log('[patreon-smoke] Real Patreon consent/code exchange remains a manual two-account staging proof; no patron credentials are stored by this harness.');
    }
}

main().catch((error) => {
    const result = {
        target: 'staging',
        mode: EXECUTE ? 'disposable-fixture-certification' : 'read-only-preflight',
        passed: stages.length,
        failed: 1,
        stages,
        error: redactError(error),
    };
    if (AS_JSON) console.error(JSON.stringify(result, null, 2));
    else console.error('[patreon-smoke] FAIL:', result.error);
    process.exit(2);
});
