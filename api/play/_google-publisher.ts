import { createHash, createSign } from 'node:crypto';
import { PLAY_REWARD_ANDROID_PACKAGE } from '../../shared/play-games-rewards.js';
import type { PlayRewardPurchaseVerification } from './_rewards-core.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISHER_ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const FETCH_TIMEOUT_MS = 10_000;

type ServiceAccount = { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
type PublisherDependencies = {
    env?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
    now?: () => number;
};

let cachedAccessToken: { token: string; expiresAt: number; credentialKey: string } | null = null;

function credentialsFrom(env: NodeJS.ProcessEnv): { issuer: string; privateKey: string; tokenUri: string } {
    const raw = String(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? '').trim();
    if (!raw) throw new Error('Google Play service account credentials are not configured.');
    let account: ServiceAccount;
    try { account = JSON.parse(raw) as ServiceAccount; }
    catch { throw new Error('Google Play service account JSON is invalid.'); }
    const issuer = typeof account.client_email === 'string' ? account.client_email.trim() : '';
    const privateKey = typeof account.private_key === 'string' ? account.private_key : '';
    const tokenUri = typeof account.token_uri === 'string' && account.token_uri.startsWith('https://')
        ? account.token_uri
        : TOKEN_URL;
    if (!issuer || !privateKey.includes('PRIVATE KEY')) throw new Error('Google Play service account credentials are incomplete.');
    return { issuer, privateKey, tokenUri };
}

function base64Url(value: string | Buffer): string {
    return Buffer.from(value).toString('base64url');
}

async function accessToken(deps: PublisherDependencies): Promise<string> {
    const env = deps.env ?? process.env;
    const { issuer, privateKey, tokenUri } = credentialsFrom(env);
    const credentialKey = createHash('sha256').update(`${issuer}\n${tokenUri}\n${privateKey}`).digest('hex');
    const now = (deps.now ?? Date.now)();
    if (cachedAccessToken && cachedAccessToken.credentialKey === credentialKey && cachedAccessToken.expiresAt > now + 60_000) {
        return cachedAccessToken.token;
    }
    const issuedAt = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({ iss: issuer, scope: SCOPE, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600 }));
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
    const response = await (deps.fetcher ?? fetch)(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status}).`);
    const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Google OAuth returned no access token.');
    const expiresIn = Math.max(60, Math.min(3600, Number(body.expires_in) || 3600));
    cachedAccessToken = { token: body.access_token, expiresAt: now + expiresIn * 1000, credentialKey };
    return body.access_token;
}

function purchaseUrl(productId: string, purchaseToken: string): string {
    return `${PUBLISHER_ROOT}/applications/${PLAY_REWARD_ANDROID_PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
}

async function publisherRequest(url: string, init: RequestInit, deps: PublisherDependencies): Promise<Response> {
    const token = await accessToken(deps);
    return (deps.fetcher ?? fetch)(url, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
}

export async function verifyPlayRewardPurchase(
    productId: string,
    purchaseToken: string,
    deps: PublisherDependencies = {},
): Promise<PlayRewardPurchaseVerification> {
    const response = await publisherRequest(purchaseUrl(productId, purchaseToken), { method: 'GET' }, deps);
    if (!response.ok) throw new Error(`Google Play purchase verification failed (${response.status}).`);
    const purchase = await response.json() as { productId?: unknown; purchaseState?: unknown; acknowledgementState?: unknown; consumptionState?: unknown };
    if (purchase.productId !== productId) throw new Error('Google Play returned a different product ID.');
    return {
        purchaseState: Number(purchase.purchaseState),
        acknowledged: Number(purchase.acknowledgementState) === 1,
        consumed: Number(purchase.consumptionState) === 1,
    };
}

export async function acknowledgePlayRewardPurchase(
    productId: string,
    purchaseToken: string,
    deps: PublisherDependencies = {},
): Promise<void> {
    const response = await publisherRequest(`${purchaseUrl(productId, purchaseToken)}:acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    }, deps);
    if (!response.ok) throw new Error(`Google Play purchase acknowledgement failed (${response.status}).`);
}

export async function consumePlayRewardPurchase(
    productId: string,
    purchaseToken: string,
    deps: PublisherDependencies = {},
): Promise<void> {
    const response = await publisherRequest(`${purchaseUrl(productId, purchaseToken)}:consume`, {
        method: 'POST',
    }, deps);
    if (!response.ok) throw new Error(`Google Play purchase consumption failed (${response.status}).`);
}

export function __resetGooglePublisherTokenForTest(): void {
    cachedAccessToken = null;
}
