import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CreatorEvent } from '../types/vn';
import { RETIRED_VN_ART, retiredVnArtHash, retiredVnArtSources, omitRetiredVnArt, isRetiredVnArt } from './vn-retired-artwork';
import { RETIRED_VN_PORTRAITS } from './vn-retired-portraits';
import { RETIRED_VN_BACKGROUNDS } from './vn-retired-backgrounds';

const id = 'story-frostfang-village-85-7';
const source = (slot: string) => `/api/img?id=${encodeURIComponent(`vn:${id}:page:${slot}`)}`;
const event = {
    id, vnPages: [{ title: 'The White Silence', scene: 'Square', speaker: 'Narrator', dialogue: ['The rows.'],
        image: source('0'), rightImage: source('0:right') }],
} as CreatorEvent;

test('retirement recognizes only reviewed shared slots, including cache-versioned URLs', () => {
    assert.equal(retiredVnArtSources(event).length, 2);
    assert.equal(retiredVnArtHash(id, `${source('0')}&v=new-revision`), RETIRED_VN_ART[`vn:${id}:page:0`]);
    for (const url of ['/uploads/custom.webp', 'https://example.com/api/img?id=custom', source('3'), '/api/img?id=avatar%3Aplayer']) {
        assert.equal(retiredVnArtHash(id, url), undefined);
    }
    assert.equal(retiredVnArtHash('creator-custom', source('0')), undefined);
});

test('all 124 legacy backgrounds match archived bytes, including event-wide and alias fields', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        const key = new URLSearchParams(url.split('?')[1]).get('id')!;
        return new Response(readFileSync(new URL(`../../e2e/fixtures/vn-identity-audit/${RETIRED_VN_BACKGROUNDS[key]}.webp`, import.meta.url)));
    });
    assert.equal(Object.keys(RETIRED_VN_BACKGROUNDS).length, 124);
    for (const key of Object.keys(RETIRED_VN_BACKGROUNDS)) {
        const eventId = key.startsWith('event:') ? key.slice(6, -3) : /^vn:(.*):page:/.exec(key)![1];
        const url = `/api/img?id=${encodeURIComponent(key)}&v=background-recheck`;
        assert.equal(await isRetiredVnArt(eventId, url), true, key);
    }
    const eventImage = '/api/img?id=event%3Astory-frostfang-village-4-0%3Abg';
    const wide = { ...event, id: 'story-frostfang-village-4-0', image: eventImage, vnPages: [] };
    assert.deepEqual(retiredVnArtSources(wide), [eventImage]);
    assert.equal(omitRetiredVnArt(wide, new Set([eventImage])).image, undefined);
    assert.ok(retiredVnArtHash('sys-ancient-chest', '/api/img?id=vn%3Aancient-chest%3Apage%3A0'));
});

test('verified retirement clears only exact matching fields without changing story or other overrides', () => {
    const original = structuredClone(event);
    const next = omitRetiredVnArt(event, new Set([source('0:right')]));
    assert.equal(next.vnPages![0].rightImage, undefined);
    assert.equal(next.vnPages![0].image, source('0'));
    assert.deepEqual(next.vnPages![0].dialogue, event.vnPages![0].dialogue);
    assert.deepEqual(event, original);
    assert.equal(omitRetiredVnArt(event, new Set()), event);
    const custom = { ...event, vnPages: [{ ...event.vnPages![0], rightImage: '/uploads/new.webp' }] };
    assert.equal(omitRetiredVnArt(custom, new Set([source('0:right')])).vnPages![0].rightImage, '/uploads/new.webp');
});

test('new bytes in an old shared slot survive and failed checks can retry', async t => {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        if (requests === 1) return new Response('', { status: 503 });
        return new Response('a newly published admin image');
    });
    const url = `${source('1')}&v=test-new-art`;
    assert.equal(await isRetiredVnArt(id, url), false);
    assert.equal(await isRetiredVnArt(id, url), false);
    assert.equal(await isRetiredVnArt(id, url), false);
    assert.equal(requests, 2);
});

test('the six reviewed live exports match their fingerprints and retire successfully', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        const id = new URLSearchParams(url.split('?')[1]).get('id')!;
        const bytes = readFileSync(new URL(`../../e2e/fixtures/vn-identity-audit/${RETIRED_VN_ART[id]}.webp`, import.meta.url));
        return new Response(bytes);
    });
    for (const slot of ['0', '1', '2', '0:right', '1:right', '2:right']) {
        assert.equal(await isRetiredVnArt(id, `${source(slot)}&v=retired-fixture`), true, slot);
    }
});

test('all 120 reviewed legacy portrait slots match archived live bytes', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        const key = new URLSearchParams(url.split('?')[1]).get('id')!;
        return new Response(readFileSync(new URL(`../../e2e/fixtures/vn-identity-audit/${RETIRED_VN_PORTRAITS[key]}.webp`, import.meta.url)));
    });
    assert.equal(Object.keys(RETIRED_VN_PORTRAITS).length, 120);
    for (const key of Object.keys(RETIRED_VN_PORTRAITS)) {
        const eventId = /^vn:(.*):page:/.exec(key)![1];
        const url = `/api/img?id=${encodeURIComponent(key)}&v=full-audit`;
        assert.equal(await isRetiredVnArt(eventId, url), true, key);
        assert.equal(retiredVnArtHash('creator-unrelated', url), undefined);
    }
    assert.ok(retiredVnArtHash('sys-pet-encounter', '/api/img?id=vn%3Apet-encounter%3Apage%3A1%3Aright'));
});
