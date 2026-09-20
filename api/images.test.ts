import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isUnsafeImageUrlHost, isValidImageString, avatarImageReject, base64DecodedByteLength, categoryFromId, ownershipReject, isPlayerClaimableImageId, removeImagesBatch, batchDeleteIds, BATCH_DELETE_MAX } from './images.js';

// Pure validation logic for the shared-image upload endpoint (audit #23). No KV,
// no network — covers the internal-host / SSRF guard and the data-URL allowlist.

describe('isUnsafeImageUrlHost (internal-target guard)', () => {
    it('flags localhost and internal / mDNS TLDs', () => {
        for (const h of ['localhost', 'foo.localhost', 'box.local', 'svc.internal', 'host.lan', 'nas.home', 'app.corp', 'wiki.intranet']) {
            assert.equal(isUnsafeImageUrlHost(h), true, h);
        }
    });

    it('flags bare single-label hosts', () => {
        assert.equal(isUnsafeImageUrlHost('router'), true);
        assert.equal(isUnsafeImageUrlHost('intranet'), true);
    });

    it('flags private / loopback / link-local / CGNAT IPv4', () => {
        for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '100.64.0.1', '0.0.0.0']) {
            assert.equal(isUnsafeImageUrlHost(h), true, h);
        }
    });

    it('allows public IPv4 (incl. 172.x / 100.x outside the private ranges)', () => {
        for (const h of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1']) {
            assert.equal(isUnsafeImageUrlHost(h), false, h);
        }
    });

    it('flags numeric / hex IPv4 obfuscation', () => {
        assert.equal(isUnsafeImageUrlHost('2130706433'), true); // 127.0.0.1 decimal
        assert.equal(isUnsafeImageUrlHost('0x7f000001'), true); // 127.0.0.1 hex
    });

    it('flags IPv6 loopback / link-local / unique-local (with or without brackets)', () => {
        for (const h of ['::1', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
            assert.equal(isUnsafeImageUrlHost(h), true, h);
        }
    });

    it('allows global IPv6 and public domains (incl. ones that start with fc/fd)', () => {
        assert.equal(isUnsafeImageUrlHost('2606:4700::6810:85e5'), false);
        assert.equal(isUnsafeImageUrlHost('cdn.example.com'), false);
        assert.equal(isUnsafeImageUrlHost('fc-barcelona.com'), false);
        assert.equal(isUnsafeImageUrlHost('fd-example.net'), false);
    });
});

describe('isValidImageString', () => {
    it('accepts raster data URLs', () => {
        assert.equal(isValidImageString('data:image/png;base64,AAAA'), true);
        assert.equal(isValidImageString('data:image/jpeg;base64,AAAA'), true);
        assert.equal(isValidImageString('data:image/webp;base64,AAAA'), true);
        assert.equal(isValidImageString('data:image/gif;base64,AAAA'), true);
    });

    it('rejects SVG and non-image data URLs', () => {
        assert.equal(isValidImageString('data:image/svg+xml;base64,AAAA'), false);
        assert.equal(isValidImageString('data:text/html;base64,AAAA'), false);
    });

    it('accepts public http(s) image URLs', () => {
        assert.equal(isValidImageString('https://cdn.example.com/a.png'), true);
        assert.equal(isValidImageString('http://images.example.org/p.jpg'), true);
    });

    it('rejects internal / loopback / metadata http(s) URLs', () => {
        assert.equal(isValidImageString('http://localhost/a.png'), false);
        assert.equal(isValidImageString('http://127.0.0.1:9000/a.png'), false);
        assert.equal(isValidImageString('http://169.254.169.254/latest/meta-data/'), false);
        assert.equal(isValidImageString('http://[::1]/a.png'), false);
        assert.equal(isValidImageString('http://192.168.0.10/a.png'), false);
    });

    it('rejects malformed URLs and oversized strings', () => {
        assert.equal(isValidImageString('https://'), false);
        assert.equal(isValidImageString('ftp://example.com/a.png'), false);
        assert.equal(isValidImageString('x'.repeat(3_000_001)), false);
    });
});

describe('base64DecodedByteLength', () => {
    it('computes decoded size from the base64 part (handles padding)', () => {
        assert.equal(base64DecodedByteLength('data:image/png;base64,AAAA'), 3); // no pad
        assert.equal(base64DecodedByteLength('data:image/png;base64,AAA='), 2); // 1 pad
        assert.equal(base64DecodedByteLength('data:image/png;base64,AA=='), 1); // 2 pad
        assert.equal(base64DecodedByteLength(''), 0);
    });
});

describe('avatarImageReject (avatar hardening, #15)', () => {
    it('accepts a small raster data-URL avatar (incl. animated gif/webp)', () => {
        assert.equal(avatarImageReject('data:image/png;base64,' + 'A'.repeat(100)), null);
        assert.equal(avatarImageReject('data:image/gif;base64,' + 'A'.repeat(100)), null);
        assert.equal(avatarImageReject('data:image/webp;base64,' + 'A'.repeat(100)), null);
    });
    it('rejects a remote http(s) URL avatar — must be inline', () => {
        const r = avatarImageReject('https://cdn.example.com/a.png');
        assert.ok(r && /data url|uploaded image/i.test(r), r ?? 'expected rejection');
    });
    it('rejects SVG avatars (XSS vector)', () => {
        assert.ok(avatarImageReject('data:image/svg+xml;base64,AAAA'));
    });
    it('rejects an avatar over the 2 MB decoded cap', () => {
        // 'A'.repeat(3,000,000) base64 → ~2.25 MB decoded, over the 2 MB cap.
        const big = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
        const r = avatarImageReject(big);
        assert.ok(r && /2 MB/i.test(r), r ?? 'expected size rejection');
    });
});

describe('ownershipReject — player-forged named-item image carve-out', () => {
    const player = { admin: false as const, name: 'rill' };
    const admin = { admin: true as const };

    it('lets a non-admin player image their own forged named weapon/armor', () => {
        assert.equal(ownershipReject('item:named-weapon-abc123', player), null);
        assert.equal(ownershipReject('item:named-armor-xyz789', player), null);
    });

    it('still blocks non-admins from writing generic catalog item images', () => {
        const r = ownershipReject('item:wooden-katana', player);
        assert.ok(r && r.status === 403, 'expected 403 for catalog item');
    });

    it('still blocks other admin-only prefixes for non-admins', () => {
        for (const id of ['jutsu:fireball', 'card:tile-1', 'event:boss', 'bloodline:x']) {
            const r = ownershipReject(id, player);
            assert.ok(r && r.status === 403, `expected 403 for ${id}`);
        }
    });

    it('does not treat a lookalike named- prefix on another category as an item', () => {
        // The carve-out is scoped to the 'item' prefix only.
        const r = ownershipReject('jutsu:named-weapon-spoof', player);
        assert.ok(r && r.status === 403, 'expected 403 — carve-out is item-only');
    });

    it('admins may write anything', () => {
        assert.equal(ownershipReject('item:wooden-katana', admin), null);
        assert.equal(ownershipReject('jutsu:fireball', admin), null);
    });
});

describe('ownershipReject — player bloodline + jutsu image carve-out', () => {
    const player = { admin: false as const, name: 'rill' };
    const uuid = 'b2e291f6-5b58-4bf3-a037-a983f716b121';

    it('lets a non-admin player image their own custom bloodline (random UUID id)', () => {
        assert.equal(ownershipReject(`bloodline:${uuid}`, player), null);
    });

    it('lets a non-admin player image their own bloodline jutsus (random UUID ids)', () => {
        assert.equal(ownershipReject(`jutsu:${uuid}`, player), null);
    });

    it('still blocks non-admins from the readable admin CATALOG bloodline/jutsu ids', () => {
        for (const id of ['bloodline:starter-bloodline-ashen-eyes', 'jutsu:starter-universal-blitz', 'bloodline:x', 'jutsu:fireball']) {
            const r = ownershipReject(id, player);
            assert.ok(r && r.status === 403, `expected 403 for ${id}`);
        }
    });

    it('does not let the UUID carve-out leak to other admin-only prefixes', () => {
        for (const prefix of ['card', 'event', 'ai', 'shrine', 'landmark', 'leader']) {
            const r = ownershipReject(`${prefix}:${uuid}`, player);
            assert.ok(r && r.status === 403, `expected 403 for ${prefix}:<uuid>`);
        }
    });
});

describe('isPlayerClaimableImageId — first-writer-wins scope', () => {
    const uuid = 'b2e291f6-5b58-4bf3-a037-a983f716b121';

    it('includes the player-created carve-out ids (named gear, custom bloodline/jutsu, pet art)', () => {
        for (const id of [
            `bloodline:${uuid}`, `jutsu:${uuid}`,
            'item:named-weapon-abc123', 'item:named-armor-xyz789',
            'pet:p1', 'petbody:p1', 'petsheet:p1', 'petlayers:p1:mid',
        ]) {
            assert.equal(isPlayerClaimableImageId(id), true, id);
        }
    });

    it('excludes admin catalog ids, avatars, misc, and malformed ids', () => {
        for (const id of [
            'bloodline:starter-bloodline-ashen-eyes', 'jutsu:fireball',
            'item:wooden-katana', 'avatar:rill', 'card:tile-1',
            'whatever:foo', 'noColon',
        ]) {
            assert.equal(isPlayerClaimableImageId(id), false, id);
        }
    });
});

describe('categoryFromId — leader category (#16)', () => {
    it('routes leader:* to its own category instead of misc', () => {
        assert.equal(categoryFromId('leader:ember:kage'), 'leader');
        assert.equal(categoryFromId('leader:suna:elder:1'), 'leader');
    });
    it('routes avatar:* and unknown prefixes correctly', () => {
        assert.equal(categoryFromId('avatar:rill'), 'avatar');
        assert.equal(categoryFromId('whatever:foo'), 'misc');
    });
});

describe('batch image removal (2026-09-19 disk incident)', () => {
    function fakeStore(initial: Record<string, unknown>) {
        const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
        const writes: string[] = [];
        const store = {
            async get<T>(key: string) { return (data.has(key) ? structuredClone(data.get(key)) : null) as T | null; },
            async set(key: string, value: unknown) { writes.push(`set ${key}`); data.set(key, structuredClone(value)); return 'OK' as const; },
            async del(...keys: string[]) { writes.push(`del ${keys.length}`); let n = 0; for (const k of keys) if (data.delete(k)) n++; return n; },
            async hdel(key: string, ...fields: string[]) {
                writes.push(`hdel ${key}`);
                const hash = data.get(key) as Record<string, unknown> | undefined;
                if (hash) for (const f of fields) delete hash[f];
                return fields.length;
            },
        };
        return { data, writes, store: store as unknown as Parameters<typeof removeImagesBatch>[1]['store'] };
    }
    const ids = Array.from({ length: 150 }, (_, i) => `vn:story-x-${i}:page:0`);
    const initial = {
        'shared:imgfields:event': Object.fromEntries([...ids.slice(0, 100), 'event:keep:warden'].map((id) => [id, 'data:x'])),
        'shared:images:event': Object.fromEntries(ids.slice(50).map((id) => [id, 'data:y'])),
        ...Object.fromEntries(ids.map((id) => [`shared:img:${id}`, 'data:z'])),
        'shared:img:event:keep:warden': 'data:w',
    };

    it('rewrites each shared record ONCE however many images it removes, and keeps unrelated art', async () => {
        const { data, writes, store } = fakeStore(initial);
        const audits: unknown[] = []; const bumps: string[] = [];
        const result = await removeImagesBatch([...ids, ids[0]], { store, bumpVersion: async (c) => { bumps.push(c); }, audit: async (e) => { audits.push(e); }, actor: 'admin' });
        assert.equal(result.removed.length, 150);
        assert.deepEqual(result.failed, []);
        assert.equal(writes.filter((w) => w === 'hdel shared:imgfields:event').length, 1, 'one hash rewrite');
        assert.equal(writes.filter((w) => w.includes('shared:images:event')).length, 0, 'bundle emptied: deleted, not rewritten');
        assert.equal(writes.length, 3, `writes: ${writes.join(', ')}`);
        assert.deepEqual(Object.keys(data.get('shared:imgfields:event') as object), ['event:keep:warden']);
        assert.equal(data.has('shared:images:event'), false);
        assert.ok(ids.every((id) => !data.has(`shared:img:${id}`)));
        assert.equal(data.get('shared:img:event:keep:warden'), 'data:w');
        assert.deepEqual(bumps, ['event']);
        assert.equal(audits.length, 1);
    });

    it('a bundle that keeps other images is rewritten once without the removed ones', async () => {
        const { data, writes, store } = fakeStore({ ...initial, 'shared:images:event': { [ids[60]]: 'a', 'event:keep:pet': 'b' } });
        await removeImagesBatch(ids, { store, bumpVersion: async () => {}, audit: async () => {}, actor: 'admin' });
        assert.deepEqual(data.get('shared:images:event'), { 'event:keep:pet': 'b' });
        assert.equal(writes.filter((w) => w === 'set shared:images:event').length, 1);
    });

    it('an image whose storage object could not be removed keeps its database record for a retry', async () => {
        const { data, store } = fakeStore(initial);
        const result = await removeImagesBatch(ids.slice(0, 3), {
            store, removeFromStorage: async (id) => id !== ids[1], bumpVersion: async () => {}, audit: async () => {}, actor: 'admin', concurrency: 2,
        });
        assert.deepEqual(result.removed.sort(), [ids[0], ids[2]].sort());
        assert.deepEqual(result.failed.map((f) => f.id), [ids[1]]);
        assert.ok(data.has(`shared:img:${ids[1]}`));
        assert.ok(ids[1] in (data.get('shared:imgfields:event') as object));
    });

    it('rejects malformed or oversized batches before any work', () => {
        assert.deepEqual(batchDeleteIds({ ids: ['vn:a:page:0', 'vn:a:page:0'] }), ['vn:a:page:0']);
        for (const bad of [{}, { ids: [] }, { ids: 'vn:a' }, { ids: ['no-category'] }, { ids: [42] }, { ids: Array(BATCH_DELETE_MAX + 1).fill('vn:a:page:0') }]) {
            assert.ok(!Array.isArray(batchDeleteIds(bad)), JSON.stringify(bad).slice(0, 40));
        }
    });
});
