import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import {
    __resetGooglePublisherTokenForTest,
    acknowledgePlayRewardPurchase,
    consumePlayRewardPurchase,
    verifyPlayRewardPurchase,
} from './_google-publisher.js';

function publisherFixture(publisherReply: Record<string, unknown> = {
    productId: 'sj_reward_title_dawn', purchaseState: 0, acknowledgementState: 0,
}) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = {
        ...process.env,
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
            client_email: 'play-api@example.iam.gserviceaccount.com',
            private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
            token_uri: 'https://oauth2.googleapis.com/token',
        }),
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url === 'https://oauth2.googleapis.com/token') {
            return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), { status: 200 });
        }
        return new Response(url.endsWith(':acknowledge') ? null : JSON.stringify(publisherReply), {
            status: url.endsWith(':acknowledge') ? 204 : 200,
        });
    };
    return { env, requests, fetcher };
}

test('Google Publisher verification signs server credentials and checks the exact package product', async () => {
    __resetGooglePublisherTokenForTest();
    const f = publisherFixture();
    const result = await verifyPlayRewardPurchase('sj_reward_title_dawn', 'opaque-purchase-token', f);
    assert.deepEqual(result, { purchaseState: 0, acknowledged: false, consumed: false });
    assert.equal(f.requests.length, 2);
    const [oauth, publisher] = f.requests;
    assert.match(String(oauth?.init?.body), /jwt-bearer/);
    const assertion = new URLSearchParams(String(oauth?.init?.body)).get('assertion');
    assert.ok(assertion);
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, string>;
    assert.equal(claims.iss, 'play-api@example.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
    assert.match(publisher?.url ?? '', /applications\/com\.shinobijourney\.app\/purchases\/products\/sj_reward_title_dawn\/tokens\/opaque-purchase-token$/);
    assert.equal(new Headers(publisher?.init?.headers).get('authorization'), 'Bearer test-access-token');
});

test('acknowledgement calls the Publisher acknowledgement endpoint with the verified server token', async () => {
    __resetGooglePublisherTokenForTest();
    const f = publisherFixture();
    await acknowledgePlayRewardPurchase('sj_reward_title_dawn', 'opaque-purchase-token', f);
    const request = f.requests.at(-1);
    assert.match(request?.url ?? '', /\/tokens\/opaque-purchase-token:acknowledge$/);
    assert.equal(request?.init?.method, 'POST');
    assert.equal(request?.init?.body, '{}');
});

test('consumption calls the Publisher consume endpoint so a Ryo cache can be purchased again', async () => {
    __resetGooglePublisherTokenForTest();
    const f = publisherFixture();
    await consumePlayRewardPurchase('sj_reward_ryo_cache_small', 'opaque-purchase-token', f);
    const request = f.requests.at(-1);
    assert.match(request?.url ?? '', /\/tokens\/opaque-purchase-token:consume$/);
    assert.equal(request?.init?.method, 'POST');
});

test('Publisher verification reports consumed products', async () => {
    __resetGooglePublisherTokenForTest();
    const f = publisherFixture({
        productId: 'sj_reward_ryo_cache_small',
        purchaseState: 0,
        acknowledgementState: 1,
        consumptionState: 1,
    });
    const result = await verifyPlayRewardPurchase('sj_reward_ryo_cache_small', 'opaque-purchase-token', f);
    assert.deepEqual(result, { purchaseState: 0, acknowledged: true, consumed: true });
});

test('Publisher verification rejects a token that belongs to a different product', async () => {
    __resetGooglePublisherTokenForTest();
    const f = publisherFixture({ productId: 'different_product', purchaseState: 0, acknowledgementState: 0 });
    await assert.rejects(verifyPlayRewardPurchase('sj_reward_title_dawn', 'opaque-purchase-token', f), /different product ID/);
});
