import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'image-entitlement-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;

function response() {
    const out: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(player: string, method: 'GET' | 'POST', body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
    return {
        method,
        body,
        query,
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    handler = (await import('./images.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('avatar POST is supporter-authoritative while a lapsed portrait remains readable', async () => {
    const base = 'avatarbaseentitlement';
    await kv.set(`save:${base}`, { character: { name: base, patreon: { active: false } } });
    const baseUpload = response();
    await handler(request(base, 'POST', {
        id: `avatar:${base}`,
        image: 'data:image/png;base64,AAAA',
    }), baseUpload.res);
    assert.equal(baseUpload.out.statusCode, 403);
    assert.match(String((baseUpload.out.body as { error?: string })?.error), /Shinobi Supporter/);

    const mixedCaseUpload = response();
    await handler(request(base, 'POST', {
        id: `Avatar:${base}`,
        image: 'data:image/png;base64,AAAA',
    }), mixedCaseUpload.res);
    assert.equal(mixedCaseUpload.out.statusCode, 403, 'mixed-case prefixes cannot bypass the avatar entitlement');

    const supporter = 'avatarsupporterentitlement';
    await kv.set(`save:${supporter}`, { character: { name: supporter, patreon: { active: true } } });
    const firstImage = 'data:image/png;base64,AAAB';
    const supporterUpload = response();
    await handler(request(supporter, 'POST', {
        id: `avatar:${supporter}`,
        image: firstImage,
    }), supporterUpload.res);
    assert.equal(supporterUpload.out.statusCode, 200);

    // Expiry blocks replacement only. The stored image and its public read path
    // remain untouched so grandfathering is non-destructive.
    await kv.set(`save:${supporter}`, { character: { name: supporter, patreon: { active: false } } });
    const lapsedReplace = response();
    await handler(request(supporter, 'POST', {
        id: `avatar:${supporter}`,
        image: 'data:image/png;base64,AAAC',
    }), lapsedReplace.res);
    assert.equal(lapsedReplace.out.statusCode, 403);

    const read = response();
    await handler(request(supporter, 'GET', {}, { category: 'avatar' }), read.res);
    assert.equal(read.out.statusCode, 200);
    assert.equal((read.out.body as Record<string, string>)[`avatar:${supporter}`], firstImage);
});

test('supporter avatar aliases collapse into the one canonical avatar storage key', async () => {
    const supporter = 'avataraliassupporter';
    const canonicalId = `avatar:${supporter}`;
    const aliasId = 'AvAtAr:Avatar Alias Supporter!!!';
    const firstImage = 'data:image/png;base64,AAAD';
    const replacementImage = 'data:image/png;base64,AAAE';
    await kv.set(`save:${supporter}`, { character: { name: supporter, patreon: { active: true } } });

    const firstUpload = response();
    await handler(request(supporter, 'POST', { id: canonicalId, image: firstImage }), firstUpload.res);
    assert.equal(firstUpload.out.statusCode, 200);

    const aliasReplacement = response();
    await handler(request(supporter, 'POST', { id: aliasId, image: replacementImage }), aliasReplacement.res);
    assert.equal(aliasReplacement.out.statusCode, 200);

    const read = response();
    await handler(request(supporter, 'GET', {}, { category: 'avatar' }), read.res);
    assert.equal(read.out.statusCode, 200);
    const avatars = read.out.body as Record<string, string>;
    assert.equal(avatars[canonicalId], replacementImage);
    assert.equal(avatars[aliasId], undefined, 'raw case/punctuation aliases must not create a second field');
});
